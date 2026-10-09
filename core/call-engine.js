import { GeminiLiveSession, buildAstroCallPrompt } from './gemini-live.js';
import resampler from './audio-resampler.js';
import { config, CONTACTS } from '../config.js';
import { sendVoice, sendText } from './send.js';
import { startZapoVoipEngine } from './zapo-engine.js';

let zapoClient = null;
let zapoActive = false;
const activeLiveSessions = new Map();

/**
 * Initializes Call Engine on the active WhatsApp socket (Baileys)
 * Listens for incoming WhatsApp call offers and initializes Zapo VoIP
 */
export function initCallEngine(sock) {
  if (!sock || !sock.ev) return;

  // محاولة تشغيل محرك Zapo VoIP للرد المباشر داخل شاشة واتساب
  setTimeout(() => {
    startZapoVoipEngine(null, sock)
      .then((client) => {
        if (client) {
          attachZapoClient(client);
          console.log('⚡ [VOIP] محرك المكالمات الحية داخل واتساب (Zapo Native) جاهز ويعمل');
        }
      })
      .catch((err) => {
        console.warn('ℹ️ [VOIP] محرك Zapo في انتظار جاهزية الجلسة:', err.message);
      });
  }, 3000);

  sock.ev.on('call', async (calls) => {
    for (const call of calls) {
      if (call.status === 'offer') {
        const callerJid = call.from;
        const callId = call.id;
        console.log(`\n📞 [VOIP] مكالمة واردة من: ${callerJid} (Call ID: ${callId})`);

        try {
          // 1. لو محرك Zapo VoIP شغال ومسجل، Zapo هو اللي هيقبل المكالمة ويبث الصوت داخل واتساب
          if (zapoActive && zapoClient) {
            console.log(`[VOIP] محرك Zapo نشط — جاري التقاط المكالمة داخل واتساب...`);
            continue;
          }

          // 2. إذا لم تكن جلسة Zapo مكتملة بعد:
          // توليد رد صوتي فوري عبر Gemini Live وبثه كـ Voice Note (PTT) مصري أصيل دون أي روابط نهائياً
          generateInstantLiveGreeting(sock, callerJid);

        } catch (err) {
          console.error('⚠️ خطأ في معالجة المكالمة الواردة:', err.message);
        }
      }
    }
  });

  console.log('✅ تم تفعيل مراقب المكالمات الصوتية (Call Engine) بنجاح');
}

/**
 * Generates an instant spoken voice response from Gemini 3.8 Live with Astro Persona and sends it as PTT
 */
async function generateInstantLiveGreeting(sock, toJid) {
  try {
    const liveSession = new GeminiLiveSession({
      callerJid: toJid
    });

    const audioChunks = [];
    liveSession.on('audio24k', (buf) => audioChunks.push(buf));

    liveSession.on('turnComplete', async () => {
      liveSession.close();
      if (audioChunks.length === 0) return;

      const full24k = Buffer.concat(audioChunks);
      const wavHeader = createWavHeader(full24k.length, 24000, 1, 16);
      const wavBuffer = Buffer.concat([wavHeader, full24k]);

      await sock.sendMessage(toJid, {
        audio: wavBuffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true
      }).catch(async () => {
        await sock.sendMessage(toJid, {
          audio: wavBuffer,
          mimetype: 'audio/mp4',
          ptt: true
        }).catch(() => {});
      });
    });

    await liveSession.connect();
    liveSession.sendText('أنت استرو، المتصل رن عليك حالا في واتساب. افتح الكلام فوراً بترحيب مصري عامي سريع وخفيف الظل كأنك فتحت الخط وبترد في التليفون: ألو يا فنان! ألو يا غالي! أنا استرو.. استلمت رنتك يا باشا وسامعك يا كبير! ابعتلي فويس باللي في بالك وأنا معاك أرد عليك في ثانية!');
  } catch (err) {
    console.warn('⚠️ تعذر إرسال الفويس الفوري للمتصل:', err.message);
  }
}

/**
 * Creates WAV header for 16-bit PCM
 */
function createWavHeader(dataLength, sampleRate = 24000, channels = 1, bitDepth = 16) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bitDepth / 8), 28);
  header.writeUInt16LE(channels * (bitDepth / 8), 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

/**
 * Attaches Zapo VoIP Client if started
 */
export function attachZapoClient(client) {
  zapoClient = client;
  zapoActive = true;

  // Incoming call event on Zapo (Native in WhatsApp)
  client.on('voip_call_incoming', async (call) => {
    console.log(`\n📞 [ZAPO-VOIP] مكالمة واردة من داخل واتساب! من: ${call.peerJid} (ID: ${call.callId})`);
    if (call.canAccept) {
      try {
        console.log(`⚡ [ZAPO-VOIP] جاري الرد وقبول المكالمة داخل واتساب: ${call.callId}...`);
        await client.voip.acceptCall(call.callId);

        // إنشاء جلسة بث حي مع Gemini 3.8 Live بشخصية استرو الأصلية
        const callerPn = call.callerPn ? `${call.callerPn}@s.whatsapp.net` : call.peerJid;
        const liveSession = new GeminiLiveSession({ callerJid: callerPn });
        activeLiveSessions.set(call.callId, liveSession);

        liveSession.on('ready', () => {
          console.log(`🎙️ [ZAPO-VOIP] جاهزية جلسة Gemini Live للمكالمة ${call.callId}`);
          client.voip.setExternalAudioMode(call.callId, true);
          liveSession.sendText('المكالمة فتحت الآن.. رحب بالمتصل باللهجة المصرية كأنك فتحت الخط وبترد في التليفون: ألو يا فنان! ألو يا غالي! أسترو معاك، سامعك يا باشا قولّي إيه الأخبار؟');
        });

        // صوت Gemini يذهب للمتصل في واتساب
        liveSession.on('audio16kFloat32', (f32Chunk) => {
          try {
            client.voip.feedLiveAudio(call.callId, f32Chunk);
          } catch (e) {
            console.warn('[ZAPO-VOIP] خطأ في تغذية الصوت:', e.message);
          }
        });

        await liveSession.connect();

      } catch (err) {
        console.error('❌ فشل قبول المكالمة في Zapo:', err.message);
      }
    }
  });

  // User speaks in WhatsApp VoIP -> forward to Gemini Live
  client.on('voip_call_inbound_audio', ({ call, pcm }) => {
    const liveSession = activeLiveSessions.get(call.callId);
    if (liveSession && liveSession.ready) {
      liveSession.sendAudio(pcm);
    }
  });

  client.on('voip_call_ended', (call) => {
    console.log(`📴 [ZAPO-VOIP] انتهت المكالمة: ${call.callId}`);
    const liveSession = activeLiveSessions.get(call.callId);
    if (liveSession) {
      liveSession.close();
      activeLiveSessions.delete(call.callId);
    }
  });
}

export default {
  initCallEngine,
  attachZapoClient
};
