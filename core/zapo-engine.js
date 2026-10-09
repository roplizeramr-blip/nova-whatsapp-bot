import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WaClient, createStore, createPinoLogger } from 'zapo-js';
import { createSqliteStore } from '@zapo-js/store-sqlite';
import { voipPlugin, CallState, EndCallReason } from '@zapo-js/voip';
import { migrate, bufferJsonReviver } from 'wa-store-migrate';
import { GeminiLiveSession } from './gemini-live.js';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = join(__dirname, '..', 'session');
const ZAPO_AUTH_DIR = join(__dirname, '..', '.auth');
const ZAPO_SQLITE_PATH = join(ZAPO_AUTH_DIR, 'zapo_voip.sqlite');

const activeCallSessions = new Map();
let currentZapoClient = null;

/**
 * Reads multi-file Baileys auth folder and transforms it into a BaileysAuthSnapshot
 */
function readBaileysSnapshot(dir) {
  const credsPath = join(dir, 'creds.json');
  if (!existsSync(credsPath)) return null;

  try {
    const creds = JSON.parse(readFileSync(credsPath, 'utf-8'), bufferJsonReviver);
    const keys = {};

    for (const f of readdirSync(dir)) {
      if (f === 'creds.json' || !f.endsWith('.json')) continue;
      const m = /^([a-z-]+)-(.+)\.json$/i.exec(f);
      if (!m) continue;
      const id = m[2].replace(/__/g, '/').replace(/-/g, ':');
      (keys[m[1]] ??= {})[id] = JSON.parse(
        readFileSync(join(dir, f), 'utf-8'),
        bufferJsonReviver
      );
    }
    return { creds, keys };
  } catch (err) {
    console.warn('⚠️ فشل قراءة لقطة جلسة Baileys:', err.message);
    return null;
  }
}

/**
 * Migrates Baileys multi-file auth into Zapo SQLite store
 */
export async function migrateBaileysToZapo(baileysDir = SESSION_DIR, sqlitePath = ZAPO_SQLITE_PATH) {
  mkdirSync(dirname(sqlitePath), { recursive: true });

  const baileysSnapshot = readBaileysSnapshot(baileysDir);
  if (!baileysSnapshot) {
    console.log('ℹ️ لم يتم العثور على ملفات جلسة Baileys للترحيل إلى Zapo');
    return null;
  }

  console.log('🔄 جاري ترحيل جلسة واتساب إلى محرك Zapo VoIP...');
  const { data, losses } = migrate({ from: 'baileys', to: 'zapo', data: baileysSnapshot });

  const store = createStore({
    backends: { sqlite: createSqliteStore({ path: sqlitePath, driver: 'auto' }) },
    providers: {
      auth: 'sqlite', signal: 'sqlite', preKey: 'sqlite', session: 'sqlite',
      identity: 'sqlite', senderKey: 'sqlite', appState: 'sqlite',
      privacyToken: 'sqlite',
      messages: 'none', threads: 'none', contacts: 'none'
    }
  });

  const s = store.session('default');
  await s.auth.save(data.credentials);
  for (const k of data.preKeys ?? []) await s.preKey.putPreKey(k);
  if (data.identities?.length) {
    await s.identity.setRemoteIdentities(
      data.identities.map((i) => ({ address: i.address, identityKey: i.identityKey }))
    );
  }
  if (data.sessions?.length) {
    await s.session.setSessionsBatch(
      data.sessions.map((x) => ({ address: x.address, session: x.record }))
    );
  }
  for (const sk of data.senderKeys ?? []) await s.senderKey.upsertSenderKey(sk.record);
  if (data.appState?.keys?.length) await s.appState.upsertSyncKeys(data.appState.keys);
  if (data.privacyTokens?.length) await s.privacyToken.upsertBatch(data.privacyTokens);

  console.log('✅ تم ترحيل جلسة واتساب بنجاح إلى قاعدة بيانات Zapo VoIP');
  return store;
}

/**
 * Starts the Native In-App WhatsApp VoIP engine using Zapo & Gemini 3.8 Live
 */
export async function startZapoVoipEngine(customStore = null) {
  try {
    const logger = await createPinoLogger({ level: 'silent' });
    let store = customStore;

    if (!store) {
      if (existsSync(SESSION_DIR) && existsSync(join(SESSION_DIR, 'creds.json'))) {
        store = await migrateBaileysToZapo(SESSION_DIR, ZAPO_SQLITE_PATH);
      } else if (existsSync(ZAPO_SQLITE_PATH)) {
        store = createStore({
          backends: { sqlite: createSqliteStore({ path: ZAPO_SQLITE_PATH, driver: 'auto' }) },
          providers: {
            auth: 'sqlite', signal: 'sqlite', preKey: 'sqlite', session: 'sqlite',
            identity: 'sqlite', senderKey: 'sqlite', appState: 'sqlite',
            privacyToken: 'sqlite',
            messages: 'none', threads: 'none', contacts: 'none'
          }
        });
      }
    }

    if (!store) {
      console.log('ℹ️ محرك Zapo VoIP في وضع الانتظار حتى اكتمال تسجيل جلسة واتساب');
      return null;
    }

    const client = new WaClient(
      {
        store,
        sessionId: 'default',
        connectTimeoutMs: 20000,
        deviceBrowser: 'Chrome',
        deviceOsDisplayName: 'Windows',
        plugins: [voipPlugin({ maxConcurrentCalls: 1, logLevel: 'warn' })]
      },
      logger
    );

    currentZapoClient = client;

    // 📞 1. التقاط المكالمة الواردة من تطبيق واتساب نفسه والرد الفوري
    client.on('voip_call_incoming', async (call) => {
      console.log(`\n📞 [NATIVE-VOIP] مكالمة واردة من داخل واتساب! من: ${call.peerJid} (ID: ${call.callId})`);
      if (!call.canAccept) {
        console.warn(`[NATIVE-VOIP] تعذر قبول المكالمة ${call.callId} — الخط مشغول`);
        return;
      }

      try {
        console.log(`⚡ [NATIVE-VOIP] جاري الرد وقبول المكالمة داخل واتساب...`);
        await client.voip.acceptCall(call.callId);
        console.log(`🟢 [NATIVE-VOIP] تم الرد على المكالمة بنجاح! المكالمة نشطة الآن في هاتف المستخدم`);

        // تفعيل وضع التغذية الصوتية المباشرة
        client.voip.setExternalAudioMode(call.callId, true);

        // تجهيز جلسة الذكاء الاصطناعي مع شخصية أسترو المصرية الأصلية
        const callerPn = call.callerPn ? `${call.callerPn}@s.whatsapp.net` : call.peerJid;
        const liveSession = new GeminiLiveSession({ callerJid: callerPn });

        activeCallSessions.set(call.callId, liveSession);

        liveSession.on('ready', () => {
          console.log(`🎙️ [NATIVE-VOIP] جلسة Gemini 3.8 Live جاهزة للمكالمة ${call.callId}`);
          // استرو يبدأ المكالمة بترحيب فوري
          liveSession.sendText('المكالمة فتحت الآن.. رحب بالمتصل باللهجة المصرية كأنك فتحت الخط وبترد في التليفون: ألو يا فنان! ألو يا غالي! أسترو معاك، سامعك يا باشا قولّي إيه الأخبار؟');
        });

        // 🔊 صوت استرو يخرج مباشرة في سماعة هاتف المتصل داخل واتساب
        liveSession.on('audio16kFloat32', (samples) => {
          try {
            client.voip.feedLiveAudio(call.callId, samples);
          } catch (e) {
            console.warn('[NATIVE-VOIP] تعذر بث الصوت في المكالمة:', e.message);
          }
        });

        liveSession.on('turnComplete', () => {
          // جاهز للاستماع للرد التالي
        });

        liveSession.on('error', (err) => {
          console.error('[NATIVE-VOIP] خطأ في جلسة Gemini Live:', err.message);
        });

        await liveSession.connect();

      } catch (err) {
        console.error('❌ [NATIVE-VOIP] فشل في قبول المكالمة:', err.message);
      }
    });

    // 🎤 2. استلام صوت المتصل من المايكروفون في واتساب وإرساله فوراً لـ Gemini 3.8 Live
    client.on('voip_call_inbound_audio', ({ call, pcm }) => {
      const liveSession = activeCallSessions.get(call.callId);
      if (liveSession && liveSession.ready) {
        // pcm هو Float32Array بتردد 16kHz
        liveSession.sendAudio(pcm);
      }
    });

    // 📴 3. إغلاق المكالمة وتنظيف الذاكرة
    client.on('voip_call_ended', (call) => {
      const reason = call.stateData.endReason || 'unknown';
      console.log(`📴 [NATIVE-VOIP] انتهت المكالمة: ${call.callId} (السبب: ${reason})`);
      const liveSession = activeCallSessions.get(call.callId);
      if (liveSession) {
        liveSession.close();
        activeCallSessions.delete(call.callId);
      }
    });

    client.on('connection', (event) => {
      console.log(`[NATIVE-VOIP:CONN] حالة الاتصال: ${event.status}`);
    });

    console.log('🚀 [NATIVE-VOIP] تم إعداد محرك المكالمات الأصلية بنجاح — جاهز للاتصال');
    return client;

  } catch (err) {
    console.error('❌ [NATIVE-VOIP] فشل تشغيل محرك المكالمات الأصلية:', err.message);
    return null;
  }
}

export function getZapoClient() {
  return currentZapoClient;
}

export default {
  migrateBaileysToZapo,
  startZapoVoipEngine,
  getZapoClient
};
