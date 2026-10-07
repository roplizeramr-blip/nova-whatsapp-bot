import api from './api.js';
import { sendVoice } from './send.js';
import { config } from '../config.js';

/**
 * تنظيف وتهيئة النص للصوت البشري المشحون بالمشاعر واللهجة المصرية
 * يزيل الإيموجيات والماركداون التي تربك محرك الصوت ويضيف وقفات صوتية طبيعية
 */
export function emotiveVoiceText(text) {
  let s = String(text || '').trim();
  // إزالة الماركداون والرموز
  s = s.replace(/[*_~`#]/g, '');
  // إزالة الروابط
  s = s.replace(/https?:\/\/\S+/g, '');
  // إزالة استدعاءات الأوامر
  s = s.replace(/\.[a-zA-Z0-9_\u0600-\u06FF]+/g, '');
  // استبدال الإيموجيات بوقفات صوتية للتنفس والتعبير
  s = s.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '، ');
  // ضبط الفواصل وعلامات الوقف لتحسين نغمة ومشاعر الصوت في ElevenLabs
  s = s.replace(/\s*،\s*/g, '، ');
  s = s.replace(/\s*!\s*/g, '! ');
  s = s.replace(/\s*\?\s*/g, '؟ ');
  s = s.replace(/\s*…\s*/g, '... ');
  s = s.replace(/\s{2,}/g, ' ');
  return s.trim().slice(0, 450);
}

// 🎙️ طبقة الصوت الذكية — رسالة صوتية ناطقة بلهجة عربية ومصرية واقعية وطبيعية
// الصوت الافتراضي الأساسي: adam (ElevenLabs عبر VEX) - يفهم ويتكلم عربي ومصري بطلاقة تامة
export async function speak(sock, jid, text, { voice = null } = {}) {
  const clean = emotiveVoiceText(text);
  if (!clean) throw new Error('مفيش كلام');

  // اختيار الصوت: آدم (ElevenLabs) افتراضياً للبوت لأنه أفضل صوت يفهم ويتكلم مصري وعربي
  const rawRequested = voice ?? config.ttsVoice ?? 'adam';
  const selectedVoice = VOICES[rawRequested] ?? rawRequested;

  // 1. الأساسي: VEX ElevenLabs / VoxBox (استجابة فائقة في ~1.2 ثانية وطبيعية 100%)
  try {
    const url = api.vexTtsUrl(clean, selectedVoice);
    if (url) return await sendVoice(sock, jid, url);
  } catch (err) {
    console.warn('⚠️ تعذر VEX TTS، جاري تجربة المحرك الاحتياطي:', err.message);
  }

  // 2. الاحتياطي: Anime TTS
  try {
    const fallbackUrl = await api.animeTts(clean, selectedVoice === 'adam' ? 'غوكو' : selectedVoice);
    if (fallbackUrl) return await sendVoice(sock, jid, fallbackUrl);
  } catch {}

  // 3. الاحتياطي الثالث: Engez ElevenLabs (فارس 12)
  const url = await api.tts(clean, { voice: '12', dialect: 'fusha' });
  if (!url) throw new Error('مفيش رابط صوت');
  return sendVoice(sock, jid, url);
}

export async function speakAs(sock, jid, text, character = 'adam') {
  return speak(sock, jid, text, { voice: character });
}

// أصوات الشخصيات والـ ElevenLabs المتاحة
export const CHARACTERS = [
  'adam', 'liam', 'antoni', 'bella', 'matilda',
  'messi', 'goku', 'eminem', 'therock', 'snoop', 'drake', 'kanye', 'morgan'
];

export const VOICES = {
  // 🌟 أصوات ElevenLabs الطبيعية فائقة الدقة (عربي ومصري بطلاقة)
  آدم: 'adam',
  adam: 'adam',
  ليام: 'liam',
  liam: 'liam',
  أنطوني: 'antoni',
  antoni: 'antoni',
  بيلا: 'bella',
  bella: 'bella',
  ماتيلدا: 'matilda',
  matilda: 'matilda',
  أرنولد: 'arnold',
  arnold: 'arnold',
  هاري: 'harry',
  harry: 'harry',

  // ⚽🎭 أصوات المشاهير والرياضيين (VoxBox)
  ميسي: 'messi',
  messi: 'messi',
  غوكو: 'goku',
  goku: 'goku',
  إيمينيم: 'eminem',
  ايمينيم: 'eminem',
  eminem: 'eminem',
  ذا_روك: 'therock',
  روك: 'therock',
  therock: 'therock',
  سنوب_دوغ: 'snoop',
  سنوب: 'snoop',
  snoop: 'snoop',
  دريك: 'drake',
  drake: 'drake',
  كانيه: 'kanye',
  kanye: 'kanye',
  مورغان: 'morgan',
  morgan: 'morgan',
  نيمار: 'neymar',
  neymar: 'neymar',
  مبابي: 'mbappe',
  mbappe: 'mbappe',
};
