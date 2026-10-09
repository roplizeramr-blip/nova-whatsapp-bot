import { GeminiLiveSession } from './gemini-live.js';
import resampler from './audio-resampler.js';
import { config } from '../config.js';
import { sendVoice, sendText } from './send.js';

let zapoClient = null;
let zapoActive = false;
const activeLiveSessions = new Map();

/**
 * Initializes Call Engine on the active WhatsApp socket (Baileys)
 * Listens for incoming WhatsApp call offers
 */
export function initCallEngine(sock) {
  if (!sock || !sock.ev) return;

  sock.ev.on('call', async (calls) => {
    for (const call of calls) {
      if (call.status === 'offer') {
        const callerJid = call.from;
        const callId = call.id;
        console.log(`\n📞 [VOIP] مكالمة واردة من: ${callerJid} (Call ID: ${callId})`);

        try {
          // 1. لو محرك Zapo VoIP شغال ومسجل، Zapo هو اللي هيقبل المكالمة ويبث الصوت
          if (zapoActive && zapoClient) {
            console.log(`[VOIP] محرك Zapo نشط — جاري محاولة التقاط المكالمة عبر Zapo...`);
            // Zapo handles it via its own voip_call_incoming event
            continue;
          }

          // 2. إذا كانت المكالمة على سوكيت Baileys مباشرة:
          // بما أن بروتوكول Baileys الأصلي لا يحتوي على مسار الوسائط المشفر لـ WebRTC،
          // نقوم بإشعار المتصل فوراً والرد عليه صوتياً ونرسل له رابط غرفة المكالمة الحية
          const callUrl = `https://nova-bot-x3unfm.cranl.net/call`;
          const callerNumber = callerJid.split('@')[0].split(':')[0];

          // رسالة ترحيبية فورية بالاتصال
          const greetingText = 
            `╭───『 📞 مـكـالـمـة صـوتـيـة حـيـة ⚡ 』───╮\n` +
            `│\n` +
            `│ أهلاً بك يا غالي! استلمت رنتك حالا ⚡\n` +
            `│\n` +
            `│ 🎙️ *عايز تتكلم صوت مباشر مع أسترو عبر المايك؟*\n` +
            `│ اضغط على الرابط ده وافتح المايك وابدأ الكلام فوراً:\n` +
            `│ 🔗 ${callUrl}\n` +
            `│\n` +
            `│ ⚡ شغال بنموذج: *Gemini 3.8 Live Extended Thinking*\n` +
            `│ أو ابعتلي أي رسالة صوتية (فويس) هنا وهرد عليك فويس في ثانية! 🎧\n` +
            `╰─────────────────────────╯`;

          await sock.sendMessage(callerJid, { text: greetingText }).catch(() => {});

          // توليد رد صوتي فوري عبر Gemini Live وبثه كـ Voice Note (PTT)
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
 * Generates an instant spoken voice response from Gemini 3.8 Live and sends it as PTT
 */
async function generateInstantLiveGreeting(sock, toJid) {
  try {
    const liveSession = new GeminiLiveSession({
      systemInstruction: 'أنت أسترو، رن عليك مستخدم على واتساب. رد عليه الآن بلهجة مصرية عامية مرحة وسريعة في ثانيتين: قله "ألو يا فنان! أنا استلمت رنتك.. اضغط على الرابط اللي بعتهولك فوق ونتكلم مباشر بالمايك أو ابعتلي فويس شات وأنا معاك يا غالي!".'
    });

    const audioChunks = [];
    liveSession.on('audio24k', (buf) => audioChunks.push(buf));

    liveSession.on('turnComplete', async () => {
      liveSession.close();
      if (audioChunks.length === 0) return;

      const full24k = Buffer.concat(audioChunks);
      // Send as voice note to the user
      // Convert raw PCM to sendable audio buffer using wav encoder
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
    liveSession.sendText('ابدأ بالرد على المتصل الآن فوراً');
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
  header.writeUInt16LE(1, 20); // PCM format
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

  // Incoming call event on Zapo
  client.on('voip_call_incoming', async (call) => {
    console.log(`\n📞 [ZAPO-VOIP] مكالمة واردة من: ${call.peerJid} (ID: ${call.callId})`);
    if (call.canAccept) {
      try {
        console.log(`[ZAPO-VOIP] جاري الرد وقبول المكالمة: ${call.callId}...`);
        await client.voip.acceptCall(call.callId);

        // إنشاء جلسة بث حي مع Gemini 3.8 Live
        const liveSession = new GeminiLiveSession();
        activeLiveSessions.set(call.callId, liveSession);

        liveSession.on('ready', () => {
          console.log(`[ZAPO-VOIP] جاهزية جلسة Gemini Live للمكالمة ${call.callId}`);
          client.voip.setExternalAudioMode(call.callId, true);
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
