import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, watch } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket;
}

import { WaClient, createStore, createNoopLogger, ConsoleLogger } from 'zapo-js';
import { createSqliteStore } from '@zapo-js/store-sqlite';
import { voipPlugin } from '@zapo-js/voip';
import { WaCallMediaPlane, WaSctpRelay } from '@zapo-js/voip-media';
import { GeminiLiveSession } from './gemini-live.js';
import { config, CONTACTS } from '../config.js';
import { getDbPool, isDbConfigured } from './postgres.js';

/**
 * 🔧 باتش إجبار IPv4 على محرك VoIP و WebRTC
 * يمنع تماماً محاولات الاتصال بخوادم IPv6 غير المدعومة في بيئة السحابة (CranL / Docker)
 * مما يضمن نجاح تدفق الصوت الحي (Media Flow) فور قبول المكالمة
 */
function applyVoipIpv4Patch() {
  if (globalThis.__voipIpv4Patched) return;
  globalThis.__voipIpv4Patched = true;

  try {
    const origConnectRelays = WaCallMediaPlane.prototype.connectRelays;
    WaCallMediaPlane.prototype.connectRelays = async function (relays) {
      if (relays && Array.isArray(relays.endpoints)) {
        const v4Only = relays.endpoints.filter((ep) => ep.ip && !ep.ip.includes(':'));
        if (v4Only.length > 0) {
          relays = { ...relays, endpoints: v4Only };
        }
      }
      return origConnectRelays.call(this, relays);
    };

    const origApplyRelays = WaCallMediaPlane.prototype.applyRelays;
    if (origApplyRelays) {
      WaCallMediaPlane.prototype.applyRelays = async function (relays) {
        if (relays && Array.isArray(relays.endpoints)) {
          const v4Only = relays.endpoints.filter((ep) => ep.ip && !ep.ip.includes(':'));
          if (v4Only.length > 0) {
            relays = { ...relays, endpoints: v4Only };
          }
        }
        return origApplyRelays.call(this, relays);
      };
    }

    const origConfigureRelays = WaSctpRelay.prototype.configureRelays;
    WaSctpRelay.prototype.configureRelays = async function (relays) {
      if (Array.isArray(relays)) {
        const v4Only = relays.filter((r) => r.ip && !r.ip.includes(':'));
        if (v4Only.length > 0) {
          relays = v4Only;
        }
      }
      return origConfigureRelays.call(this, relays);
    };

    console.log('✅ [VOIP-PATCH] تم تفعيل حماية IPv4 لمحرك المكالمات الحية بنجاح 100%');
  } catch (err) {
    console.warn('⚠️ [VOIP-PATCH] تعذر تطبيق باتش IPv4:', err.message);
  }
}
applyVoipIpv4Patch();

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOIP_SESSION_DIR = join(__dirname, '..', 'session_voip');

const activeCallSessions = new Map();
let currentZapoClient = null;
let currentBaileysSock = null;
let zapoConnecting = false;
let zapoPaired = false;
let latestPairingCode = null;
let pairingCodeRequestedAt = 0;
let latestVoipQr = null;
let voipQrTimestamp = 0;
let qrRefreshLock = null;
let voipSyncTimer = null;
let voipWatcherInitialized = false;

/**
 * تأجيل ومزامنة ملفات الجلسة مع قاعدة البيانات بدون إرهاق السيرفر
 */
export function scheduleVoipSessionSync(delayMs = 2500) {
  if (voipSyncTimer) clearTimeout(voipSyncTimer);
  voipSyncTimer = setTimeout(() => {
    voipSyncTimer = null;
    syncVoipSessionToDb().catch(() => {});
  }, delayMs);
}

/**
 * مراقبة التغييرات على مجلد الجلسة للحفظ التلقائي الفوري
 */
function setupVoipDirWatcher() {
  if (voipWatcherInitialized) return;
  try {
    mkdirSync(VOIP_SESSION_DIR, { recursive: true });
    watch(VOIP_SESSION_DIR, (eventType, filename) => {
      scheduleVoipSessionSync(2000);
    });
    voipWatcherInitialized = true;
  } catch (err) {
    console.warn('⚠️ [VOIP] تعذر تفعيل مراقب مجلد جلسة المكالمات:', err.message);
  }
}

/**
 * بناء مخزن SQLite دائم لجلسة المكالمات
 */
function buildVoipStore() {
  const sqlitePath = join(VOIP_SESSION_DIR, 'voip.sqlite');
  try {
    mkdirSync(VOIP_SESSION_DIR, { recursive: true });
    const sqliteBackend = createSqliteStore({
      path: sqlitePath,
      pragmas: { journal_mode: 'DELETE', busy_timeout: 5000 }
    });
    return createStore({
      backends: { sqlite: sqliteBackend },
      providers: {
        auth: 'sqlite',
        signal: 'sqlite',
        preKey: 'sqlite',
        session: 'sqlite',
        identity: 'sqlite',
        senderKey: 'sqlite',
        appState: 'sqlite',
        messages: 'sqlite',
        threads: 'sqlite',
        contacts: 'sqlite',
        privacyToken: 'sqlite'
      },
      cacheProviders: {
        retry: 'sqlite',
        groupMetadata: 'sqlite',
        chatMetadata: 'sqlite',
        deviceList: 'sqlite',
        messageSecret: 'sqlite'
      }
    });
  } catch (err) {
    console.warn('⚠️ [VOIP] فشل تهيئة مخزن SQLite للـ VoIP، جاري استخدام الذاكرة:', err.message);
    return createStore();
  }
}

/**
 * استرجاع ملفات جلسة VoIP من قاعدة بيانات PostgreSQL مع دعم الملفات الثنائية (SQLite)
 */
async function restoreVoipSessionFromDb() {
  if (!isDbConfigured()) return 0;
  try {
    const pool = await getDbPool();
    if (!pool) return 0;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS session_voip_storage (
        key VARCHAR(512) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const res = await pool.query('SELECT key, value FROM session_voip_storage');
    if (!res.rows || !res.rows.length) {
      console.log('ℹ️ [VOIP] لم يتم العثور على جلسة VoIP سابقة في PostgreSQL');
      return 0;
    }

    mkdirSync(VOIP_SESSION_DIR, { recursive: true });
    let count = 0;
    for (const row of res.rows) {
      if (!row.key || typeof row.value !== 'string') continue;
      const target = join(VOIP_SESSION_DIR, row.key);
      mkdirSync(dirname(target), { recursive: true });
      if (row.value.startsWith('b64:')) {
        writeFileSync(target, Buffer.from(row.value.slice(4), 'base64'));
      } else {
        writeFileSync(target, row.value, 'utf8');
      }
      count++;
    }

    console.log(`📦 [VOIP] تم استرجاع ${count} ملف لجلسة VoIP من PostgreSQL`);
    return count;
  } catch (err) {
    console.warn('⚠️ [VOIP] تعذر استرجاع جلسة VoIP من PostgreSQL:', err.message?.slice(0, 100));
    return 0;
  }
}

/**
 * حفظ ملفات جلسة VoIP إلى PostgreSQL مع تشفير Base64 لملفات SQLite
 */
async function syncVoipSessionToDb() {
  if (!isDbConfigured() || !existsSync(VOIP_SESSION_DIR)) return 0;
  try {
    const pool = await getDbPool();
    if (!pool) return 0;

    const files = [];
    function scanDir(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) scanDir(full);
        else files.push({ full, rel: relative(VOIP_SESSION_DIR, full).replace(/\\/g, '/') });
      }
    }
    scanDir(VOIP_SESSION_DIR);

    if (!files.length) return 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const f of files) {
        let content;
        try {
          const buf = readFileSync(f.full);
          content = 'b64:' + buf.toString('base64');
        } catch {
          continue;
        }
        await client.query(
          `INSERT INTO session_voip_storage (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [f.rel, content]
        );
      }
      await client.query('COMMIT');
      console.log(`💾 [VOIP] تم حفظ ومزامنة ${files.length} ملف لجلسة VoIP في PostgreSQL`);
      return files.length;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('⚠️ [VOIP] فشل حفظ جلسة VoIP في PostgreSQL:', err.message?.slice(0, 100));
    return 0;
  }
}

/**
 * إرسال إشعار بكود ربط جهاز المكالمات للمالك والمطور عبر واتساب
 */
async function notifyOwnerWithPairingCode(code) {
  if (!currentBaileysSock || !code) return;

  const pairingMsg =
    `╭───『 📞 تـفـعـيـل مـكـالـمـات واتـسـاب الـحـيـة ⚡ 』───╮\n` +
    `│\n` +
    `│ 🎙️ *كود ربط جهاز المكالمات الصوتية المباشرة:*\n` +
    `│ 🔢 *${code}*\n` +
    `│\n` +
    `│ 📲 خطوات التفعيل السريعة (مرة واحدة فقط):\n` +
    `│ 1. افتح واتساب على هاتفك 📱\n` +
    `│ 2. الإعدادات ⚙️ ⬅️ الأجهزة المرتبطة\n` +
    `│ 3. اضغط "ربط جهاز" ⬅️ "الربط برقم الهاتف"\n` +
    `│ 4. اكتب الكود: *${code}*\n` +
    `│\n` +
    `│ ⚡ شغال بنموذج: *Gemini 3.8 Live Extended Thinking*\n` +
    `│ 🗣️ نفس شخصية استرو المصرية الجدعة وخفيفة الظل!\n` +
    `│ بمجرد إدخال الكود، البوت هيرد مباشرة على أي رنة تليفون!\n` +
    `╰─────────────────────────╯`;

  const recipients = ['201044626335@s.whatsapp.net', '263488291246130@lid'];
  for (const jid of recipients) {
    await currentBaileysSock.sendMessage(jid, { text: pairingMsg }).catch(() => {});
  }
}

/**
 * تشغيل محرك مكالمات واتساب الأصلية داخل التطبيق (Native In-App VoIP Call)
 */
export async function startZapoVoipEngine(customStore = null, baileysSock = null) {
  if (baileysSock) currentBaileysSock = baileysSock;
  if (currentZapoClient) return currentZapoClient;

  try {
    console.log('⚡ [VOIP] جاري بدء تهيئة محرك المكالمات الحية داخل واتساب (Zapo VoIP Engine)...');

    // استرجاع جلسة VoIP السحابية إن وُجدت
    await restoreVoipSessionFromDb().catch(() => {});
    mkdirSync(VOIP_SESSION_DIR, { recursive: true });
    setupVoipDirWatcher();

    const logger = new ConsoleLogger('warn');
    const store = customStore || buildVoipStore();
    const client = new WaClient(
      {
        store,
        sessionId: 'voip',
        connectTimeoutMs: 30000,
        deviceBrowser: 'Chrome',
        deviceOsDisplayName: 'Windows',
        plugins: [
          voipPlugin({
            maxConcurrentCalls: 1,
            logLevel: 'warn'
          })
        ]
      },
      logger
    );
    console.log('⚡ [VOIP] تم تشغيل محرك مكالمات واتساب السريع بنجاح');

    currentZapoClient = client;

    // معالج طلب كود الربط عند الحاجة
    const handlePairingFlow = async () => {
      const state = client.auth?.getState();
      if (state?.registered) {
        zapoPaired = true;
        return;
      }
      if (latestPairingCode) return;

      console.log('\n======================================================');
      console.log('🔢 [NATIVE-VOIP] جاري طلب كود تفعيل المكالمات الصوتية المباشرة...');
      try {
        const phone = String(config.pairingPhone || '201226110887').replace(/\D/g, '');
        const rawCode = await client.auth.requestPairingCode(phone);
        const prettyCode = rawCode?.match(/.{1,4}/g)?.join('-') ?? rawCode;
        latestPairingCode = prettyCode;
        pairingCodeRequestedAt = Date.now();

        console.log(`📞 [NATIVE-VOIP] كود تفعيل المكالمات الصوتية الحية: ${prettyCode}`);
        console.log('======================================================\n');

        await notifyOwnerWithPairingCode(prettyCode);
      } catch (err) {
        console.warn('⚠️ [NATIVE-VOIP] تعذر طلب كود الربط:', err.message);
      }
    };

    // 🔢 1. استلام باركود الربط المباشر (QR Code) عند ظهور حدث auth_qr
    client.on('auth_qr', ({ qr, ttlMs }) => {
      latestVoipQr = qr;
      voipQrTimestamp = Date.now();
      console.log(`⚡ [NATIVE-VOIP] تم استلام باركود جديد لمكالمات واتساب (TTL: ${ttlMs || 60000}ms)`);
    });

    client.on('auth_pairing_required', () => {
      console.log('ℹ️ [NATIVE-VOIP] السيرفر جاهز لربط جهاز المكالمات');
    });

    // 🎉 2. عند اكتمال الربط بنجاح
    client.on('auth_paired', async () => {
      zapoPaired = true;
      latestVoipQr = null;
      latestPairingCode = null;
      console.log('🎉 [NATIVE-VOIP] تم ربط جهاز المكالمات الصوتية بنجاح بنظام الأجهزة المتعددة!');
      await syncVoipSessionToDb().catch(() => {});

      if (currentBaileysSock) {
        const successMsg =
          `🎉 *تم تفعيل مكالمات واتساب الصوتية الحية بنجاح 100%!* ⚡\n\n` +
          `أصبح جهاز المكالمات مقترناً بحساب البوت.\n` +
          `أسترو جاهز الآن للرد المباشر داخل واتساب والتحدث بالصوت المصري الذكي عند الاتصال في أي وقت! 📞🎙️`;
        currentBaileysSock.sendMessage('201044626335@s.whatsapp.net', { text: successMsg }).catch(() => {});
        currentBaileysSock.sendMessage('263488291246130@lid', { text: successMsg }).catch(() => {});
      }
    });

    // 📞 3. الرد التلقائي المباشر على المكالمة الواردة داخل شاشة واتساب
    client.on('voip_call_incoming', async (call) => {
      console.log(`\n📞 [NATIVE-VOIP] مكالمة واردة من داخل واتساب! من: ${call.peerJid} (ID: ${call.callId})`);
      if (!call.canAccept) {
        console.warn(`[NATIVE-VOIP] تعذر قبول المكالمة ${call.callId} — الخط مشغول أو الحالة غير متاحة`);
        return;
      }

      try {
        console.log(`⚡ [NATIVE-VOIP] جاري الرد وقبول المكالمة داخل واتساب مباشرة...`);
        await client.voip.acceptCall(call.callId);
        console.log(`🟢 [NATIVE-VOIP] تم الرد على المكالمة بنجاح! المكالمة نشطة الآن في هاتف المتصل`);

        // تفعيل وضع التغذية الصوتية المباشرة
        client.voip.setExternalAudioMode(call.callId, true);

        // تجهيز جلسة Gemini 3.8 Live مع شخصية أسترو المصرية الأصلية
        const callerPn = call.callerPn ? `${call.callerPn}@s.whatsapp.net` : call.peerJid;
        const liveSession = new GeminiLiveSession({ callerJid: callerPn, model: 'gemini-3.8-live' });

        activeCallSessions.set(call.callId, liveSession);

        liveSession.on('ready', () => {
          console.log(`🎙️ [NATIVE-VOIP] جلسة Gemini 3.8 Live جاهزة للمكالمة ${call.callId}`);
          liveSession.sendText('المكالمة فتحت الآن في هاتف المتصل.. رحب بالمتصل باللهجة المصرية كأنك فتحت الخط وبترد في التليفون: ألو يا فنان! ألو يا غالي! أسترو معاك، سامعك يا باشا قولّي إيه الأخبار؟');
        });

        // 🔊 صوت استرو يخرج مباشرة في سماعة هاتف المتصل داخل واتساب
        liveSession.on('audio16kFloat32', (samples) => {
          try {
            client.voip.feedLiveAudio(call.callId, samples);
          } catch (e) {
            console.warn('[NATIVE-VOIP] تعذر بث الصوت في المكالمة:', e.message);
          }
        });

        liveSession.on('interrupted', () => {
          console.log(`⚡ [NATIVE-VOIP] المتصل قاطع الكلام — جاري الاستماع للمتصل فوراً`);
        });

        liveSession.on('error', (err) => {
          console.error('[NATIVE-VOIP] خطأ في جلسة Gemini Live:', err.message);
        });

        await liveSession.connect().catch((err) => {
          console.warn('⚠️ [NATIVE-VOIP] تعذر اتصال جلسة Gemini Live:', err.message);
        });

      } catch (err) {
        console.error('❌ [NATIVE-VOIP] فشل في قبول المكالمة:', err.message);
      }
    });

    // 🎤 4. استلام صوت المتصل من مايكروفون واتساب وإرساله فوراً إلى الذكاء الاصطناعي
    client.on('voip_call_inbound_audio', ({ call, pcm }) => {
      const liveSession = activeCallSessions.get(call.callId);
      if (liveSession && liveSession.ready) {
        liveSession.sendAudio(pcm);
      }
    });

    // 📡 5. متابعة حالة المكالمة وتدفق الوسائط
    client.on('voip_call_state', (call) => {
      const st = call?.stateData?.state || 'unknown';
      console.log(`📡 [NATIVE-VOIP] تحديث حالة المكالمة ${call.callId}: ${st}`);
    });

    client.on('voip_call_error', (err) => {
      console.warn('⚠️ [NATIVE-VOIP:ERR]', err?.message || err);
    });

    // 📴 6. إغلاق المكالمة وتنظيف الذاكرة
    client.on('voip_call_ended', (call) => {
      const reason = call.stateData?.endReason || 'unknown';
      console.log(`📴 [NATIVE-VOIP] انتهت المكالمة: ${call.callId} (السبب: ${reason})`);
      const liveSession = activeCallSessions.get(call.callId);
      if (liveSession) {
        liveSession.close();
        activeCallSessions.delete(call.callId);
      }
    });

    client.on('connection', (event) => {
      console.log(`[NATIVE-VOIP:CONN] حالة اتصال Zapo: ${event.status}`);
      if (event.status === 'open') {
        zapoPaired = true;
        latestVoipQr = null;
        latestPairingCode = null;
        syncVoipSessionToDb().catch(() => {});
      } else if (event.status === 'close' && !isZapoReady()) {
        // إذا انقطع الاتصال والجهاز لم يقترن بعد، نعيد الاتصال تلقائياً لتوليد باركود جديد
        setTimeout(() => {
          if (!isZapoReady() && !zapoConnecting && currentZapoClient) {
            zapoConnecting = true;
            currentZapoClient.connect().catch(() => {}).finally(() => {
              zapoConnecting = false;
            });
          }
        }, 3000);
      }
    });

    // بدء الاتصال بواتساب في الخلفية
    if (!zapoConnecting) {
      zapoConnecting = true;
      void client.connect().catch((err) => {
        console.warn('ℹ️ [NATIVE-VOIP] حالة اتصال Zapo:', err.message);
      }).finally(() => {
        zapoConnecting = false;
      });
    }

    console.log('🚀 [NATIVE-VOIP] تم إعداد وتشغيل محرك المكالمات الأصلية بنجاح');
    return client;

  } catch (err) {
    console.error('❌ [NATIVE-VOIP] فشل تشغيل محرك المكالمات الأصلية:', err.message);
    return null;
  }
}

/**
 * هل محرك Zapo مقترن وجاهز لاستقبال المكالمات فعلياً؟
 */
export function isZapoReady() {
  if (!currentZapoClient) return false;
  const state = currentZapoClient.auth?.getState();
  return !!(state?.registered && (state?.connected || zapoPaired));
}

export function getLatestPairingCode() {
  return latestPairingCode;
}

/**
 * جلب أو تجديد باركود واتساب الحقيقي فوريًا وبشكل مباشر
 * يضمن إعادة طلب الرمز من خوادم واتساب فور انتهاء صلاحيته
 */
export async function getOrRefreshVoipQr(force = false) {
  if (isZapoReady()) return null;

  const now = Date.now();
  if (!force && latestVoipQr && (now - voipQrTimestamp < 45000)) {
    return latestVoipQr;
  }

  if (qrRefreshLock) {
    return await qrRefreshLock;
  }

  qrRefreshLock = (async () => {
    try {
      if (!currentZapoClient) {
        await startZapoVoipEngine(null, currentBaileysSock);
      }
      if (!currentZapoClient) return latestVoipQr;

      // فحص سريع إذا تم استلام كود أثناء التهيئة
      if (!force && latestVoipQr && (Date.now() - voipQrTimestamp < 40000)) {
        return latestVoipQr;
      }

      console.log('🔄 [NATIVE-VOIP] جاري تحديث باركود واتساب وطلب رمز ربط جديد من السيرفر...');
      try {
        await currentZapoClient.disconnect().catch(() => {});
      } catch {}

      const qrPromise = new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            resolve(latestVoipQr);
          }
        }, 7000);

        const handler = ({ qr, ttlMs }) => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            latestVoipQr = qr;
            voipQrTimestamp = Date.now();
            console.log(`⚡ [NATIVE-VOIP] تم استلام باركود جديد لمكالمات واتساب (TTL: ${ttlMs || 60000}ms)`);
            resolve(qr);
          }
        };
        currentZapoClient.once('auth_qr', handler);
      });

      zapoConnecting = true;
      void currentZapoClient.connect().catch((e) => {
        console.warn('ℹ️ [NATIVE-VOIP] خطأ أثناء إعادة الاتصال للباركود:', e.message);
      }).finally(() => {
        zapoConnecting = false;
      });

      const freshQr = await qrPromise;
      if (freshQr) {
        latestVoipQr = freshQr;
        voipQrTimestamp = Date.now();
      }
      return freshQr || latestVoipQr;
    } finally {
      qrRefreshLock = null;
    }
  })();

  return await qrRefreshLock;
}

/**
 * طلب أو استرجاع كود ربط جهاز المكالمات فوراً
 */
export async function requestPairingCodeNow() {
  if (latestPairingCode && Date.now() - pairingCodeRequestedAt < 120000) {
    return latestPairingCode;
  }

  if (!currentZapoClient) {
    await startZapoVoipEngine(null, currentBaileysSock);
  }

  // انتظر حتى يتم توليد الكود عبر مستمع auth_qr (حتى 20 ثانية)
  for (let i = 0; i < 40; i++) {
    if (latestPairingCode) return latestPairingCode;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (latestPairingCode) return latestPairingCode;

  // محاولة أخيرة لو لم يكن الكود قد طُلب بعد
  try {
    const phone = String(config.pairingPhone || '201226110887').replace(/\D/g, '');
    const raw = await currentZapoClient.auth.requestPairingCode(phone);
    const pretty = raw?.match(/.{1,4}/g)?.join('-') ?? raw;
    latestPairingCode = pretty;
    pairingCodeRequestedAt = Date.now();
    return pretty;
  } catch (err) {
    console.warn('⚠️ [NATIVE-VOIP] خطأ أثناء طلب كود الربط:', err.message);
    return latestPairingCode || null;
  }
}

// حفظ فوري لجلسة المكالمات عند إيقاف السيرفر أو إعادة التشغيل على السحابة
for (const sig of ['SIGTERM', 'SIGINT', 'beforeExit']) {
  process.on(sig, () => {
    syncVoipSessionToDb().catch(() => {});
  });
}

// مزامنة دورية كل 30 ثانية في الخلفية لضمان عدم ضياع أي مفاتيح تشفير جديدة
setInterval(() => {
  if (isZapoReady()) {
    syncVoipSessionToDb().catch(() => {});
  }
}, 30000);

// بدء تشغيل محرك Zapo تلقائياً في الخلفية فور إقلاع السيرفر
setTimeout(() => {
  if (!currentZapoClient) {
    startZapoVoipEngine(null, currentBaileysSock).catch(() => {});
  }
}, 1000);

export function getZapoClient() {
  return currentZapoClient;
}

export function getLatestVoipQr() {
  return latestVoipQr;
}

export function getVoipStatus() {
  const ready = isZapoReady();
  const now = Date.now();
  const hasValidQr = !!(latestVoipQr && (now - voipQrTimestamp < 50000));

  if (!ready && !hasValidQr && !qrRefreshLock) {
    getOrRefreshVoipQr().catch(() => {});
  }

  return {
    ready,
    hasQr: !!latestVoipQr,
    qrTimestamp: voipQrTimestamp,
    latestPairingCode,
    expiresInSec: latestVoipQr ? Math.max(0, Math.floor((50000 - (now - voipQrTimestamp)) / 1000)) : 0
  };
}

export default {
  startZapoVoipEngine,
  getZapoClient,
  isZapoReady,
  getLatestPairingCode,
  requestPairingCodeNow,
  getLatestVoipQr,
  getOrRefreshVoipQr,
  getVoipStatus,
  syncVoipSessionToDb,
  scheduleVoipSessionSync,
};

