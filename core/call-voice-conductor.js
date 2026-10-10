import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config, CONTACTS } from '../config.js';
import { buildAstroCallPrompt } from './gemini-live.js';
import api from './api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GREETING_WAV = join(__dirname, '..', 'data', 'call_greeting.wav');
const GREETING_MP3 = join(__dirname, '..', 'data', 'call_greeting.mp3');
const SILENCE_PROMPT_WAV = join(__dirname, '..', 'data', 'call_prompt_silence.wav');
const SILENCE_PROMPT_MP3 = join(__dirname, '..', 'data', 'call_prompt_silence.mp3');

// Map of active call sessions by callId
const callSessions = new Map();
let groqKeyIndex = 0;

function getNextGroqKey() {
  const keys = config.groqApiKeys || [];
  if (!keys.length) return null;
  const key = keys[groqKeyIndex % keys.length];
  groqKeyIndex++;
  return key;
}

/**
 * تحويل مصفوفات عينات الصوت Float32 إلى ملف WAV بصيغة 16kHz mono 16-bit PCM
 */
export function float32ChunksToWav(chunks, sampleRate = 16000) {
  let totalSamples = 0;
  for (const c of chunks) totalSamples += c.length;

  const int16Buffer = Buffer.alloc(totalSamples * 2);
  let offset = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
      int16Buffer.writeInt16LE(Math.floor(val), offset);
      offset += 2;
    }
  }

  const byteRate = sampleRate * 2;
  const blockAlign = 2;
  const wavHeader = Buffer.alloc(44);

  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + int16Buffer.length, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20); // PCM
  wavHeader.writeUInt16LE(1, 22); // mono
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(16, 34); // 16-bit
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(int16Buffer.length, 40);

  return Buffer.concat([wavHeader, int16Buffer]);
}

/**
 * تنظيف النص المنطوق من أي علامات أو إيموجي لتفادي ارتباك محرك الصوت
 */
export function cleanVoiceText(text) {
  let s = String(text || '').trim();
  s = s.replace(/[*_~`#]/g, '');
  s = s.replace(/https?:\/\/\S+/g, '');
  s = s.replace(/\.[a-zA-Z0-9_\u0600-\u06FF]+/g, '');
  s = s.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
  s = s.replace(/\s+/g, ' ');
  return s.trim();
}

/**
 * استبعاد الهلاوس والضوضاء الناتجة عن فترات الصمت في Whisper
 */
export function isNoiseTranscript(text) {
  const clean = String(text || '').trim().toLowerCase();
  if (clean.length < 2) return true;
  if (/^[\s.،!؟]+$/.test(clean)) return true;
  if (/(اشترك|القناة|سبسكرايب|شكرا للمشاهدة|amara\.org|subtitles|translated by)/i.test(clean)) return true;
  return false;
}

/**
 * تحويل الصوت المسجل إلى نص عربي باستخدام Groq Whisper
 */
export async function transcribeAudio(wavBuffer) {
  const keys = config.groqApiKeys || [];
  if (!keys.length) return null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = getNextGroqKey();
    if (!key) break;
    try {
      const form = new FormData();
      form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
      form.append('model', 'whisper-large-v3-turbo');
      form.append('language', 'ar');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const text = String(data.text || '').trim();
        return text;
      }
    } catch (err) {
      console.warn(`[VOIP:STT] خطأ في مفتاح Groq ${attempt + 1}:`, err.message);
    }
  }

  return null;
}

/**
 * توليد رد أسترو الهاتفي المصري عبر نموذج Google Gemini السريع
 * مع دعم جلسات التحدث متعددة الجولات والاحتياطي الذكي
 */
export async function generateReply(history, callerJid = '', callerName = '', session = null) {
  const lastUserMsg = history.filter((m) => m.role === 'user').pop()?.content || 'ألو يا أسترو';
  const basePrompt = buildAstroCallPrompt(callerJid, callerName);
  const strictPhoneGuidelines = `
⚠️ تعليمات صوتية صارمة لا تقبل الجدال:
- أنت تتحدث هاتفياً في مكالمة مباشرة وحية الآن.
- رد بجملة واحدة أو جملتين بالكتير جداً بمصري أصيل ورايق ورقيق كأنك في التليفون.
- ممنوع أي إيموجي وممنوع أي ماركداون وممنوع الروابط لأن كلامك سيتحول لصوت مباشر في أذن المتصل فوراً.
- خلي ردك سريع وهادئ وخفيف الدم ومباشر.`;

  // 1. المحرك الأول: نموذج Google Gemini Flash فائق السرعة عبر VEX (~1.7s)
  try {
    const combinedPrompt = `${basePrompt}\n${strictPhoneGuidelines}\n\nالمتصل بيقول في التليفون: "${lastUserMsg}"\nرد أسترو المصري:`;
    const geminiRes = await api.vexGemini(combinedPrompt);
    const cleaned = cleanVoiceText(geminiRes);
    if (cleaned && cleaned.length > 2) {
      console.log(`⚡ [VOIP:GEMINI] تم توليد الرد عبر Google Gemini Flash السريع`);
      return cleaned;
    }
  } catch (err) {
    console.warn(`[VOIP:GEMINI] تعذر VEX Gemini:`, err.message);
  }

  // 2. المحرك الثاني: Google Gemini عبر Engez مع الحفاظ على SessionId متعدد الجولات
  try {
    const geminiRes = await api.gemini(lastUserMsg, {
      instruction: `${basePrompt}\n${strictPhoneGuidelines}`,
      sessionId: session?.geminiSessionId || null,
    });
    if (session && geminiRes?.sessionId) {
      session.geminiSessionId = geminiRes.sessionId;
    }
    const cleaned = cleanVoiceText(geminiRes?.reply);
    if (cleaned && cleaned.length > 2) {
      console.log(`⚡ [VOIP:GEMINI] تم توليد الرد عبر Engez Google Gemini`);
      return cleaned;
    }
  } catch (err) {
    console.warn(`[VOIP:GEMINI] تعذر Engez Gemini:`, err.message);
  }

  // 3. المحرك الاحتياطي الفوري: Groq Key Pool (Qwen 3.8-27B) في حال بطء الشبكة
  const keys = config.groqApiKeys || [];
  const messages = [
    { role: 'system', content: basePrompt + strictPhoneGuidelines },
    ...history.slice(-6),
  ];

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = getNextGroqKey();
    if (!key) break;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'qwen/qwen3.8-27b',
          messages,
          max_tokens: 60,
          temperature: 0.75,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const raw = data.choices?.[0]?.message?.content || '';
        const cleaned = cleanVoiceText(raw);
        if (cleaned) return cleaned;
      }
    } catch (err) {
      console.warn(`[VOIP:LLM-FALLBACK] خطأ في مفتاح Groq ${attempt + 1}:`, err.message);
    }
  }

  return 'حبيبي يا فنان سامعك والله قول لي إيه الأخبار';
}

/**
 * تحويل النص إلى صوت وحفظه في ملف مؤقت لتشغيله في المكالمة
 * المحرك الأساسي: ElevenLabs Antoni (صوت رجل رقيق وناعم وطبيعي 100%)
 * مع دعم فك التشفير المباشر لـ base64 لتسريع الاستجابة بأقل من ثانية واحدة
 * المحرك الاحتياطي: Google Translate TTS الفوري
 */
export async function synthesizeSpeech(text, callId, voice = 'antoni') {
  const clean = cleanVoiceText(text);
  if (!clean) return null;

  const tempBase = join(tmpdir(), `call_${callId.slice(0, 8)}_${Date.now()}`);

  // 1. المحرك الأساسي: ElevenLabs Antoni (صوت رجل رقيق وناعم وطبيعي)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const vexUrl = `https://johan-vex-apis.vercel.app/api/ai/tts?text=${encodeURIComponent(clean.slice(0, 300))}&voice=${encodeURIComponent(voice)}&format=json`;
    const res = await fetch(vexUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      // أ) لو راجع Base64 فوري (بيوفر ~800ms بدون تنزيل ملف من سيرفر خارجي)
      if (data.audio_base64) {
        const buf = Buffer.from(data.audio_base64, 'base64');
        const outPath = `${tempBase}.mp3`;
        writeFileSync(outPath, buf);
        console.log(`🎙️ [VOIP:TTS] تم توليد الصوت بصوت الرجل الرقيق (${voice}) بنجاح عبر Base64`);
        return outPath;
      }
      // ب) لو راجع كـ URL
      const audioUrl = data.audio_url || data.url || data.data?.audio_url;
      if (audioUrl) {
        const dlRes = await fetch(audioUrl);
        if (dlRes.ok) {
          const buf = Buffer.from(await dlRes.arrayBuffer());
          const outPath = `${tempBase}.wav`;
          writeFileSync(outPath, buf);
          console.log(`🎙️ [VOIP:TTS] تم تنزيل الصوت بصوت الرجل الرقيق (${voice}) بنجاح`);
          return outPath;
        }
      }
    }
  } catch (err) {
    console.warn(`[VOIP:TTS] تعذر صوت ${voice} (${err.message})، جاري التبديل للمحرك الاحتياطي الفوري...`);
  }

  // 2. المحرك الاحتياطي الأول: تجربة صوت Adam (صوت رجل هادئ ودافئ)
  if (voice !== 'adam') {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const vexUrl = `https://johan-vex-apis.vercel.app/api/ai/tts?text=${encodeURIComponent(clean.slice(0, 300))}&voice=adam&format=json`;
      const res = await fetch(vexUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (data.audio_base64) {
          const buf = Buffer.from(data.audio_base64, 'base64');
          const outPath = `${tempBase}.mp3`;
          writeFileSync(outPath, buf);
          return outPath;
        }
      }
    } catch {}
  }

  // 3. المحرك الاحتياطي فائق السرعة: Google Translate TTS
  try {
    const gUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ar&client=tw-ob&q=${encodeURIComponent(clean.slice(0, 200))}`;
    const res = await fetch(gUrl);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const outPath = `${tempBase}.mp3`;
      writeFileSync(outPath, buf);
      return outPath;
    }
  } catch (err) {
    console.error(`[VOIP:TTS] فشل المحرك الاحتياطي أيضاً:`, err.message);
  }

  return null;
}

/**
 * مؤقت مراقبة الصمت: لو المتصل فضل ساكت 12 ثانية بدون كلام
 */
function armSilenceWatchdog(client, session) {
  clearTimeout(session.silenceTimer);
  if (session.ended) return;

  session.silenceTimer = setTimeout(async () => {
    if (session.ended || session.isSpeaking || session.isProcessing) return;

    if (session.silencePromptCount === 0) {
      session.silencePromptCount++;
      const promptFile = existsSync(SILENCE_PROMPT_WAV) ? SILENCE_PROMPT_WAV : SILENCE_PROMPT_MP3;
      if (existsSync(promptFile)) {
        console.log(`💬 [VOIP] تنبيه الصمت الأول للمتصل (${session.callId})...`);
        session.isSpeaking = true;
        try {
          await client.voip.loadAudio(session.callId, promptFile);
        } catch {
          session.isSpeaking = false;
        }
      }
    } else if (session.silencePromptCount >= 1) {
      console.log(`⏱️ [VOIP] المتصل ساكت لفترة طويلة، إنهاء المكالمة بلباقة (${session.callId})`);
      try {
        await client.voip.endCall(session.callId, 'normal');
      } catch {}
    }
  }, 12000);
}

/**
 * معالجة كلام المتصل بعد انتهاء جمله وسكوته
 */
async function processCallerSpeech(client, session) {
  clearTimeout(session.silenceTimer);
  session.isProcessing = true;
  session.isSpeaking = true;

  const chunks = session.inboundChunks;
  session.inboundChunks = [];
  session.hasSpeech = false;

  let totalSamples = 0;
  for (const c of chunks) totalSamples += c.length;
  const durSec = totalSamples / 16000;

  // استبعاد النقرات العشوائية الأقل من نصف ثانية
  if (durSec < 0.45) {
    session.isProcessing = false;
    session.isSpeaking = false;
    armSilenceWatchdog(client, session);
    return;
  }

  console.log(`🎙️ [VOIP] تم تسجيل ${durSec.toFixed(1)} ثانية من كلام المتصل. جاري التحويل لنص STT...`);
  const wavBuffer = float32ChunksToWav(chunks, 16000);
  const transcript = await transcribeAudio(wavBuffer);

  if (!transcript || isNoiseTranscript(transcript)) {
    console.log(`[VOIP] كلام غير واضح أو ضوضاء ("${transcript || ''}"). استئناف الاستماع...`);
    session.isProcessing = false;
    session.isSpeaking = false;
    armSilenceWatchdog(client, session);
    return;
  }

  console.log(`🗣️ [VOIP] المتصل (${session.callId}): "${transcript}"`);
  session.history.push({ role: 'user', content: transcript });

  const replyText = await generateReply(session.history, session.peerJid, session.callerPn, session);
  console.log(`🤖 [VOIP] أسترو سيرد صوتياً (Google Gemini): "${replyText}"`);
  session.history.push({ role: 'assistant', content: replyText });

  const audioFile = await synthesizeSpeech(replyText, session.callId, 'antoni');
  if (audioFile && !session.ended) {
    session.tempFiles.push(audioFile);
    session.turns++;
    console.log(`🔊 [VOIP] جاري بث رد أسترو في سماعة المكالمة (${session.callId})...`);
    try {
      await client.voip.loadAudio(session.callId, audioFile);
    } catch (err) {
      console.warn('[VOIP] فشل بث الصوت:', err.message);
      session.isProcessing = false;
      session.isSpeaking = false;
      armSilenceWatchdog(client, session);
    }
  } else {
    session.isProcessing = false;
    session.isSpeaking = false;
    armSilenceWatchdog(client, session);
  }
}

/**
 * 1. استلام مكالمة واردة وقبولها وتشغيل الترحيب الفوري
 */
export async function handleIncomingCall(client, call) {
  console.log(`\n📞 [NATIVE-VOIP] مكالمة واردة من داخل واتساب! من: ${call.peerJid} (ID: ${call.callId})`);
  if (!call.canAccept) {
    console.warn(`[NATIVE-VOIP] تعذر قبول المكالمة ${call.callId} — الخط غير متاح`);
    return;
  }

  try {
    console.log(`⚡ [NATIVE-VOIP] جاري الرد وقبول المكالمة داخل واتساب مباشرة...`);
    await client.voip.acceptCall(call.callId);
    console.log(`🟢 [NATIVE-VOIP] تم الرد على المكالمة بنجاح! المكالمة نشطة الآن في هاتف المتصل`);

    const session = {
      callId: call.callId,
      peerJid: call.peerJid,
      callerPn: call.callerPn ? `${call.callerPn}@s.whatsapp.net` : call.peerJid,
      isSpeaking: true, // أسترو يبدأ بالكلام (الترحيب)
      isProcessing: false,
      inboundChunks: [],
      lastSpeechTime: 0,
      hasSpeech: false,
      history: [],
      turns: 0,
      silencePromptCount: 0,
      silenceTimer: null,
      tempFiles: [],
      startedAt: Date.now(),
      ended: false,
    };

    callSessions.set(call.callId, session);

    // تشغيل ترحيب أسترو الفوري الجاهز مسبقاً
    const greetingFile = existsSync(GREETING_WAV) ? GREETING_WAV : GREETING_MP3;
    if (existsSync(greetingFile)) {
      console.log(`🎙️ [NATIVE-VOIP] جاري بث ترحيب أسترو الفوري في هاتف المتصل...`);
      try {
        await client.voip.loadAudio(call.callId, greetingFile);
      } catch (err) {
        console.warn(`[NATIVE-VOIP] تعذر تشغيل ملف الترحيب:`, err.message);
        session.isSpeaking = false;
        armSilenceWatchdog(client, session);
      }
    } else {
      console.warn(`[NATIVE-VOIP] ملف الترحيب غير موجود، بدء الاستماع مباشرة`);
      session.isSpeaking = false;
      armSilenceWatchdog(client, session);
    }
  } catch (err) {
    console.error('❌ [NATIVE-VOIP] فشل في قبول المكالمة:', err.message);
  }
}

/**
 * 2. عند انتهاء الصوت الصادر (الترحيب أو رد أسترو)، يبدأ أسترو في الاستماع للمتصل
 */
export function handleOutboundAudioFinished(client, call) {
  const session = callSessions.get(call.callId);
  if (!session || session.ended) return;

  session.isSpeaking = false;
  session.isProcessing = false;
  session.inboundChunks = [];
  session.hasSpeech = false;
  session.lastSpeechTime = 0;

  console.log(`👂 [NATIVE-VOIP] أسترو يستمع الآن للمتصل (${call.callId})...`);
  armSilenceWatchdog(client, session);
}

/**
 * 3. استلام عينات الصوت الواردة من مايكروفون المتصل وتحديد وقت الكلام والسكوت
 */
export function handleInboundAudio(client, { call, pcm }) {
  const session = callSessions.get(call.callId);
  if (!session || session.ended || session.isSpeaking || session.isProcessing) return;

  // حساب طاقة الصوت (RMS)
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    sum += pcm[i] * pcm[i];
  }
  const rms = Math.sqrt(sum / pcm.length);

  // عتبة التقاط الصوت البشري (Voice Activity Detection)
  if (rms > 0.012) {
    clearTimeout(session.silenceTimer);
    session.hasSpeech = true;
    session.lastSpeechTime = Date.now();
    session.inboundChunks.push(pcm);
  } else if (session.hasSpeech) {
    const elapsed = Date.now() - session.lastSpeechTime;
    if (elapsed < 850) {
      session.inboundChunks.push(pcm);
    } else {
      // المتصل انتهى من جملته وسكت أكثر من 850ms
      void processCallerSpeech(client, session);
    }
  }
}

/**
 * 4. انتهاء المكالمة وتنظيف الذاكرة والملفات المؤقتة
 */
export function handleCallEnded(client, call) {
  const session = callSessions.get(call.callId);
  const reason = call.stateData?.endReason || 'unknown';

  if (session) {
    session.ended = true;
    clearTimeout(session.silenceTimer);
    for (const f of session.tempFiles) {
      try {
        unlinkSync(f);
      } catch {}
    }
    callSessions.delete(call.callId);
    const duration = ((Date.now() - session.startedAt) / 1000).toFixed(0);
    console.log(`📴 [NATIVE-VOIP] انتهت المكالمة: ${call.callId} (السبب: ${reason}) — الجولات: ${session.turns} — المدة: ${duration}s`);
  } else {
    console.log(`📴 [NATIVE-VOIP] انتهت المكالمة: ${call.callId} (السبب: ${reason})`);
  }
}

export default {
  handleIncomingCall,
  handleOutboundAudioFinished,
  handleInboundAudio,
  handleCallEnded,
  float32ChunksToWav,
  transcribeAudio,
  generateReply,
  synthesizeSpeech,
};
