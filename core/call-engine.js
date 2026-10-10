import { GeminiLiveSession, buildAstroCallPrompt } from './gemini-live.js';
import resampler from './audio-resampler.js';
import { config, CONTACTS } from '../config.js';
import { sendVoice, sendText } from './send.js';
import {
  startZapoVoipEngine,
  isZapoReady,
  getLatestPairingCode,
  requestPairingCodeNow
} from './zapo-engine.js';

let zapoClient = null;
const activeLiveSessions = new Map();

/**
 * Initializes Call Engine on the active WhatsApp socket (Baileys)
 * Listens for incoming WhatsApp call offers and coordinates with Zapo VoIP
 */
export function initCallEngine(sock) {
  if (!sock || !sock.ev) return;

  // تشغيل محرك Zapo VoIP للرد المباشر داخل شاشة واتساب
  setTimeout(() => {
    startZapoVoipEngine(null, sock)
      .then((client) => {
        if (client) {
          zapoClient = client;
          console.log('⚡ [VOIP] محرك المكالمات الحية داخل واتساب (Zapo Native) قيد التشغيل والمراقبة');
        }
      })
      .catch((err) => {
        console.warn('ℹ️ [VOIP] محرك Zapo في انتظار جاهزية الجلسة:', err.message);
      });
  }, 2000);

  sock.ev.on('call', async (calls) => {
    for (const call of calls) {
      if (call.status === 'offer') {
        const callerJid = call.from;
        const callId = call.id;
        console.log(`\n📞 [VOIP] مكالمة واردة من: ${callerJid} (Call ID: ${callId})`);

        try {
          // 1. إذا كان محرك Zapo VoIP مقترناً وشغال، Zapo هو اللي هيقبل المكالمة ويبث الصوت مباشرة
          if (isZapoReady()) {
            console.log(`[VOIP] محرك Zapo نشط ومقترن — يتم الرد ومعالجة المكالمة داخل واتساب تلقائياً عبر Zapo VoIP`);
            continue;
          }

          // 2. إذا لم يكن جهاز المكالمات مقترناً بعد:
          console.log(`⚠️ [VOIP] جهاز المكالمات غير مقترن حتى الآن! جاري رفض الرنة بلباقة وتوليد رد فوري للمتصل وإرسال كود الربط...`);

          // إنهاء الرنة بلباقة حتى لا تظل ترن بلا نهاية
          await sock.rejectCall(callId, callerJid).catch(() => {});

          // توليد رد صوتي فوري عبر الذكاء الاصطناعي وبثه كـ Voice Note (PTT) مصري أصيل دون أي روابط نهائياً
          generateInstantLiveGreeting(sock, callerJid);

          // إرسال كود التفعيل إذا كان المتصل هو المالك أو المطور
          const isOwnerOrDev =
            callerJid.includes('201044626335') ||
            callerJid.includes('263488291246130') ||
            callerJid.includes('201273990719');

          if (isOwnerOrDev) {
            let code = getLatestPairingCode();
            if (!code) {
              try { code = await requestPairingCodeNow(); } catch (_) {}
            }

            if (code) {
              const pairingHelp =
                `╭───『 📞 تفعيل مكالمات واتساب الصوتية ⚡ 』───╮\n` +
                `│ لاحظت رنتك يا كبير! عشان أفتح الخط عليك مباشرة:\n` +
                `│ 🔢 الكود: *${code}*\n` +
                `│\n` +
                `│ اربطه مرة واحدة من:\n` +
                `│ واتساب > الأجهزة المرتبطة > ربط جهاز > الربط برقم الهاتف\n` +
                `╰─────────────────────────╯`;
              await sock.sendMessage(callerJid, { text: pairingHelp }).catch(() => {});
            }
          }

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

    await liveSession.connect().catch(() => {});
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

export default {
  initCallEngine
};
