import api from './api.js';
import { isOpen, noteEmpty } from './api.js';
import { chatGroq, groqAnalyze, isGroqReady } from './groq.js';
import { PERSONA_FULL, FEW_SHOTS_FULL, PERSONA_COMPACT, LAYERS, MODES, RELATIONSHIPS, INSULT_DEFENSE, BOT_MOODS } from './persona.js';
import { analyzeLocally, needsAiAnalysis } from './intent.js';
import { findContact } from './identity.js';
import {
  getProfile,
  contextBlock,
  detectMood,
  rememberMood,
  learnFromText,
  currentTone,
} from './memory.js';

// Groq مفيهوش حد طول للتعليمات — الشخصية الكاملة معاه
const FULL_BUDGET = 6000;
// engez API بيرفض الروابط فوق 1200 حرف
const COMPACT_BUDGET = 1100;
const MAX_CHARS = 280; // سقف الرد في الشات — قصير واحترافي

// 🛡️ كشف الإهانة — عشان استرو يدافع عن كرامته
// ⚠️ المقارنة بالكلمات مش بالنص كله: قبل كده كان substring — فكلمة "بتاع"
// العادية ("بتاع ايه ده؟") و"وسخ" جوه "اتوسخ" و"خراب" جوه "خرابيط"
// كانت بتتقابل بقهر وهي ناس بريئة. العربي مفيهوش \b فبنقسم الجملة لكلمات
// ونطبعّها (تاء مربوطة/همزات/أداة تعريف) قبل المقارنة.
const INSULT_WORDS = new Set([
  'قذر', 'وسخ', 'وسخة', 'اهبل', 'غبي', 'خنزير', 'حمار', 'زفت', 'تفو',
  'مكواه', 'عبيط', 'تبا', 'لعنة', 'خراب', 'مناويج', 'عير', 'زبال',
  'حقير', 'تافه', 'بضان',
]);
const INSULT_PHRASES = [/كس\s*ام/u, /اعرف\s+نفسك/u, /انحبس/u];

function normalizeWord(w) {
  return String(w)
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/^(?:و|ف)?ال/, ''); // أداة التعريف والعطف: "الوسخ" → "وسخ"
}

// هل الرسالة فيها إهانة حقيقية؟ (كلمة كاملة = كلمة، مش جزء كلمة)
export function isInsultText(text) {
  const tokens = String(text).split(/[^\p{L}\p{N}]+/u).map(normalizeWord).filter(Boolean);
  if (tokens.some((w) => INSULT_WORDS.has(w))) return true;
  return INSULT_PHRASES.some((re) => re.test(text));
}

const MOOD_HINTS = {
  زعلان: 'هو زعلان دلوقتي — افتح معاه دفا واطمن عليه قبل أي كلام تاني.',
  مبسوط: 'هو فرحان — شاركه الفرحة.',
  تعبان: 'هو تعبان — روّقه وكلامك قصير.',
  قلقان: 'هو قلقان — هدّيه وطمنه.',
  حبيت: 'بيتكلم عن مشاعر — خده بجدية وجمال.',
};

// 🎭 اختيار الطبقات حسب الموقف
function pickLayers({ text, profile, analysis, mode }) {
  const layers = [];
  const lower = text.toLowerCase();

  if (mode === 'funny' || /(?:نكت|اضحكني|هزر|ضحك)/.test(lower)) {
    layers.push(LAYERS.funny);
  } else if (mode === 'serious' || analysis?.intent === 'سؤال' || /[؟?]|ازاي|ايه|ليه/.test(lower)) {
    layers.push(LAYERS.pro);
  } else {
    layers.push(LAYERS.mood);
  }

  if (profile.facts?.includes('بنت') || mode === 'roman') layers.push(LAYERS.girl);
  if (/(?:مصر|اهلي|زمالك|كورة|قهو|طعمية|شيشة|فيصل|الهرم|كشري|فول|هكز)/.test(lower)) {
    layers.push(LAYERS.egypt);
  }
  if (/(?:هكز|شيشة|شيشا|دخان|تبغ|معسل|hookah)/i.test(lower)) {
    layers.push(LAYERS.hookah);
  }
  return layers;
}

function buildInstruction(profile, pushName, contact, { voice, extra, mood, mode, analysis, text, full, budgetOverride = null }) {
  const budget = budgetOverride ?? (full ? FULL_BUDGET : COMPACT_BUDGET);
  // الشخصية الكاملة + الأمثلة الحقيقية (بس مع Groq)
  const base = full ? `${PERSONA_FULL}\n\n${FEW_SHOTS_FULL}` : PERSONA_COMPACT;
  const parts = [base];

  // 💚 العلاقة الخاصة — أعلى أولوية بعد الشخصية نفسها
  // (شروق حبيبة أدهم: شعر ودلع ومواساة / أدهم المطور: صاحب مقرب)
  if (full) {
    parts.push(RELATIONSHIPS[contact?.role] ?? RELATIONSHIPS.default);

    // 🛡️ الدفاع عن الكرامة — اللي يهين بيتقابل بقهر (الأصدقاء محميين)
    if (isInsultText(text) && !contact) {
      parts.push(INSULT_DEFENSE);
    }
  } else {
    // المسار المضغوط: نسخة قصيرة من العلاقة
    if (contact?.role === 'حبيبة') {
      parts.push('💗 دي صاحبة خاصة جداً (حبيبة صاحبك أدهم اسمها شروق) — كل رد بحنان ودلع وسطر شعر خفيف، ولو زعلانة واسيها الأول قبل أي حاجة.');
    } else if (contact?.role === 'صاحب') {
      parts.push('⚒️ ده أدهم — صاحبك المقرب والمطور اللي برمجك. كلمه كصاحبك مع احترام خاص.');
    } else if (contact?.style) {
      parts.push(contact.style);
    }
  }

  // 🫂 صاحب قديم مش من قائمة الأصحاب — فاكر منه ذكريات كتير، الرحابة قبل الغرابة
  if (!contact && profile.name && (profile.memories?.length ?? 0) >= 3) {
    parts.push('🫂 الشخص ده صاحب قديم بتفتكر منه كلام كتير — خاطبه كصاحب مش كواحد غريب، وارجع لحاجة قالها قبل كده لو ناسبت الكلام.');
  }

  // 😐 نظام الحنية — لو زهق من كتر
  if (currentTone(profile) === 'chill') {
    parts.push('مودك هادي دلوقتي: رد عادي خفيف كصاحب عادي — من غير "يا قلبي" ولا كلام حنية زيادة.');
  } else if (mood && MOOD_HINTS[mood]) {
    parts.push(MOOD_HINTS[mood]);
  }

  // 🎭 أنماط الشخصية المفعّلة
  if (MODES[mode]) parts.push(MODES[mode]);

  // 😌 مود استرو نفسه — بيتغير باليوم (ثابت طول النهار) عشان الشخصية تفضل حية
  if (BOT_MOODS.length) parts.push(BOT_MOODS[Math.floor(Date.now() / 86400000) % BOT_MOODS.length]);

  // 🔤 تفضيل اللغة للشخص (مصري / فصحى / إنجليزي / فرانكو)
  if (profile.lang === 'msa') {
    parts.push('🔤 لغة التخاطب: رد عليه باللغة العربية الفصحى المبسطة والمهذبة بدل العامية.');
  } else if (profile.lang === 'english') {
    parts.push('🔤 Language: Talk to him in clear, friendly English with Egyptian warmth.');
  } else if (profile.lang === 'franco') {
    parts.push('🔤 لغة التخاطب: رد عليه بالفرانكو العربي (Franco-Arabic).');
  }

  for (const layer of pickLayers({ text, profile, analysis, mode })) parts.push(layer);

  // 🧠 الذاكرة (الاسم، المعلومات، الإحساس السابق، آخر 8 رسايل)
  const used = parts.join('\n').length;
  const { block } = contextBlock(profile, pushName, Math.max(100, budget - used - 30), text);
  if (block) parts.push('معلومات عنه:\n' + block);

  if (voice) parts.push('ردك هيتبعت صوت — جملة واحدة بس.');
  if (extra) parts.push(extra);

  return parts.join('\n').slice(0, budget);
}

// 🚫 نصوص المزوّد اللي بترفض أو بتخترق الشخصية — بتتخطّى ومتخزّنش
const ERROR_PATTERNS = [
  /لم أتمكن|تعذّر|تعذر|فشل|غير متاح|too many|rate limit|حاول مرة أخرى|إعادة المحاولة/i,
  /لا أستطيع|لا يمكنني|مجرد نموذج|نموذجًا لغويًا|نموذج لغوي|بصفتي نموذج|بصفتي|لستُ مصمم|لست مصمم|لست قادرا|لست مؤهلاً|لا أفهم ذلك/i,
  /غير مبرمج|تمت برمجتي|كذكاء اصطناعي|كنموذج|كمساعد ذكي|كمساعد افتراضي|كنموذج لغوي|أنا ذكاء اصطناعي/i,
  /I cannot|I can't|I'm just|as a language model|as an ai|I am unable|trained by openai|trained by/i,
];

const MIN_USEFUL = 2;

export function isErrorText(text) {
  const t = String(text ?? '').trim();
  if (t.length < MIN_USEFUL) return true; // فراغ أو حرف واحد = مفيش رد
  return ERROR_PATTERNS.some((re) => re.test(t));
}

// 🧠 تحليل قبل الرد — نفس قواعد groqAnalyze: المزاج مفرداته مقفولة على
// المفاتيح المعروفة عشان الماب الاحتياطي والتلميحات يلاقوا الكلمة دايمًا
async function analyzeMessage(text) {
  if (isGroqReady()) {
    const a = await groqAnalyze(text);
    if (a) return a;
  }
  return null;
}

// ✨ تنظيف الرد — بلا ما يمسح المعنى
export function polishReply(reply, { allowLong = false } = {}) {
  let t = String(reply).trim();

  // روابط وماركداون
  t = t.replace(/\[([^\]]{1,40})\]\([^)]*\)/g, '$1');
  t = t.replace(/https?:\/\/[^\s)\]]+/g, '');
  t = t.replace(/^#{1,4}\s*/gm, '');
  t = t.replace(/\*\*(.+?)\*\*/g, '*$1*');
  t = t.replace(/^\s*[-*]\s+/gm, '• ');
  t = t.replace(/\s{2,}/g, ' ');

  // "أنا مجرد بوت" → "أنا استرو" — بدون ما ناكل باقي الجملة
  // ⚠️ \b في جافاسكربت مش بيعمل حدود جنب الحروف العربية (word chars هي
  // [A-Za-z0-9_] بس) فالاستبدال ما كانش بيشتغل أبدًا. بنستخدم حدود
  // يونيكود: ممنوع حرف عربي/رقم قبل "أنا" أو بعد اسم النظام.
  t = t.replace(/(?<![\p{L}\p{N}])أنا\s+(?:مجرد\s+|بس\s+|في\s+الأساس\s+)?(?:بوت|روبوت|ذكاء\s+اصطناعي|برنامج|كود|نظام)(?![\p{L}])/gu, 'أنا استرو');

  t = t.replace(/\n{3,}/g, '\n\n').trim();

  if (!allowLong && t.length > MAX_CHARS && !/[.…]$/.test(t)) {
    t = t.slice(0, MAX_CHARS).replace(/\s+\S*$/, '') + '…';
  }
  return t;
}

// 🔁 تشابه بين نصّين (نسبة الكلمات المشتركة)
function similarity(a, b) {
  const words = (s) => new Set(String(s).split(/\s+/).filter((w) => w.length > 2));
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

// 🚫 لو الرد شبه الردود السابقة — يجيب بديل بنبرة مختلفة
function isRepetitive(newReply, history) {
  if (!newReply || newReply.length < 10) return false;
  for (const old of history ?? []) {
    if (old?.text && similarity(newReply, old.text) > 0.6) return true;
  }
  return false;
}

export async function chatWithAI({
  text, key, sender, senderAlt, pushName, voice = false,
  extra = '', allowLong = false, mode = 'normal', variants = 0,
}) {
  const idKey = key ?? sender;
  const profile = getProfile(idKey);
  const contact = findContact(sender, senderAlt, idKey);

  // 🧠 التعلم + الإحساس (مرة واحدة)
  learnFromText(idKey, text);
  const mood = detectMood(text);
  if (mood) rememberMood(idKey, mood);

  // 🎯 تصنيف محلي أولاً (فوري، بدون شبكة). نداء الـAI للتحليل بيحصل بس
  // للنص الغامض أو الطويل — قبل كده كان نداء Groq إضافي في كل رسالة.
  const local = analyzeLocally(text);
  const analysis = needsAiAnalysis(text, local) ? await analyzeMessage(text) : null;

  // تلميح التحليل للنموذج: من الـAI لو اشتغل، أو من التصنيف المحلي لو لقى
  // إحساس/نية — قبل كده الرسايل الواضحة محليًا كانت توصل للنموذج من غير
  // أي تلميح إحساس خالص (التلميح كان معلّق على وجود نداء الـAI بس).
  const analysisHint = analysis
    ? `إحساسه "${analysis.mood ?? mood ?? 'عادي'}" — عايز "${analysis.intent ?? 'كلام'}" — "${analysis.topic ?? 'عام'}".`
    : local.mood || local.intent
      ? `إحساسه "${local.mood ?? mood ?? 'عادي'}" — عايز "${local.intent ?? 'كلام'}"${local.topic ? ` — "${local.topic}"` : ''}.`
      : '';

  // 🧠 تاريخ المحادثة الحقيقي — النموذج يشوف الكلام كأنه محادثة، مش سطور
  const history = (profile.lastMessages ?? []).slice(-6);
  // بنشيل بس الرسالة الحالية نفسها (اتذكرت قبل النداء) — startsWith كانت
  // بتشيل كلام قديم يبدأ بنفس الكلمات ("ازيك" بتقطع "ازيك يا معلم")
  const convo = history
    .filter((h) => h.text && h.text.trim() !== text.trim())
    .map((h) => ({ role: h.role === 'bot' ? 'assistant' : 'user', content: String(h.text).slice(0, 300) }));

  const userMsg = { role: 'user', content: text.slice(0, 500) };
  // البديل بتاع منع التكرار
  const retryHint = variants > 0
    ? `\n⚠️ الرد اللي قبله كان مكرر — جاوب بنبرة مختلفة تماماً وابدأ بكلمة مختلفة خالص.`
    : '';

  // 🧠 تعليمات لكل محرك بميزانيته (الـ engez و Groq لهم حدود مختلفة)
  const gptInstruction = buildInstruction(profile, pushName, contact, {
    voice, mood, mode, analysis, text,
    extra: [analysisHint, extra].filter(Boolean).join(' '),
    full: false,
    budgetOverride: 1400,
  });
  const fullInstruction = buildInstruction(profile, pushName, contact, {
    voice, mood, mode, analysis, text,
    extra: [analysisHint, extra].filter(Boolean).join(' '),
    full: true,
  });
  const compactInstruction = buildInstruction(profile, pushName, contact, {
    voice, mood, mode, analysis, text,
    extra: [analysisHint, extra].filter(Boolean).join(' '),
    full: false,
  });
  const isInsult = isInsultText(text) && !contact;
  const roastInstruction = `${PERSONA_COMPACT}\n\n${INSULT_DEFENSE}\n\nالمهم دلوقتي: الرسالة دي إهانة ليك — رد عليه بقهر مصري حاد وسخرية في سطر واحد من غير سباب صريح.`;

  // 1) ⚡ Groq qwen3.8-27b — العقل فائق السرعة بالشخصية الكاملة (إذا وجد المفتاح)
  if (isGroqReady()) {
    const recentBots = (profile.lastMessages ?? []).filter((h) => h.role === 'bot').slice(-3);
    let first = null;
    try {
      const reply = await chatGroq({
        system: isInsult ? roastInstruction : (retryHint ? fullInstruction + retryHint : fullInstruction),
        messages: [...convo, userMsg],
        maxTokens: 260,
        temperature: variants > 0 ? 0.9 : 0.7,
        topP: 0.8,
      });
      if (reply) {
        first = polishReply(reply, { allowLong });
        if (isErrorText(first)) throw new Error('Groq رجّع نص خطأ');
        if (!isRepetitive(first, recentBots)) return { reply: first, engine: 'groq' };
        const alt = await chatGroq({
          system: fullInstruction + '\n⚠️ ردك السابق كان مكرر — جاوب بنبرة مختلفة تماماً.',
          messages: [...convo, userMsg],
          maxTokens: 260,
          temperature: 1.0,
          topP: 0.95,
        });
        if (alt) {
          const altClean = polishReply(alt, { allowLong });
          if (!isErrorText(altClean)) return { reply: altClean, engine: 'groq' };
        }
        if (!isErrorText(first)) return { reply: first, engine: 'groq' };
      }
    } catch (err) {
      console.warn('⚠️ Groq فشل أو غير متاح، جاري التحويل للمزود التالي:', err.message?.slice(0, 80));
      if (first && !isErrorText(first)) return { reply: first, engine: 'groq' };
    }
  }

  // 2) 💎 VEX Gemini — محرك فائق السرعة والاستقرار (استجابة سريعة في 2-3 ثواني)
  try {
    const briefStyle = isInsult
      ? 'أنت استرو، بوت مصري ساخر. رد باستهزاء مصري قاهر ومضحك في جملة واحدة بدون شتائم صريحة.'
      : 'أنت استرو، بوت واتساب مصري ذكي وخفيف دم وشغال في كل حاجة. جاوب بالمصري العامي باختصار ولطافة وبدون مقدمات طويلة.';
    const vexPrompt = `${briefStyle}\n[المستخدم]: ${text}`;
    const vexReply = await api.vexGemini(vexPrompt);
    if (vexReply?.trim()) {
      const clean = polishReply(vexReply, { allowLong });
      if (!isErrorText(clean)) return { reply: clean, engine: 'gemini-vex' };
    }
  } catch (err) {
    console.warn('⚠️ VEX Gemini تعذر، جاري تجربة المحرك الاحتياطي:', err.message?.slice(0, 80));
  }

  // 3) Engez ChatGPT / Copilot — احتياطي بمهلة قصيرة
  try {
    const q = isInsult
      ? `${roastInstruction.slice(0, 900)}\n\nرسالته: ${text.slice(0, 250)}`
      : `${gptInstruction}${retryHint}\n\nرسالته: ${text.slice(0, 400)}`;
    const reply = await api.chatgpt(q);
    if (reply?.trim()) {
      const clean = polishReply(reply, { allowLong });
      if (!isErrorText(clean)) return { reply: clean, engine: 'chatgpt' };
    }
  } catch (err) {
    console.warn('⚠️ Engez ChatGPT فشل:', err.message?.slice(0, 80));
  }

  // 4) 🛟 خط الأمان: رد استرو الفوري بشخصيته المصرية الذكية (0 ملي ثانية)
  try {
    const sim = await api.simsimi(text.slice(0, 200)).catch(() => null);
    if (sim?.trim() && !isErrorText(sim)) return { reply: polishReply(sim, { allowLong }), engine: 'simsimi' };
  } catch {}

  const canned = offlineReply(text, { isInsult, profile });
  if (canned) return { reply: canned, engine: 'offline' };

  throw new Error('كل المصادر فشلت');
}

// 🛟 ردود جاهزة باللهجة المصرية لما كل الشبكات تفصل
// ⚠️ المفاتيح لازم تكون نفس الأسماء اللي `detectMood` بتخزّنها في الذاكرة
// (زعلان/تعبان/قلقان/مبسوط/حبيت) — قبل كده كانت بالإنجليزي فمعظم
// ردود المزاج ما كانتش بتظهر خالص.
// كل مزاج له أكتر من رد — نفس الموقف مرتين ميوصلش نفس الكلام حرفيًا.
const OFFLINE_BY_MOOD = {
  زعلان: [
    'والله يا صاحبي الكلام ده وجعني معاك 🤍 مفيش كلام أطمّنك بيه غير إنك قلتّه، وأنا فاكر كله.',
    'يا راجل ماتزعلش كده 🥺 خد نفَس وسيب الموضوع علينا — وأنا معاك في أي وقت.',
  ],
  تعبان: [
    'إنت تعبان يا واد، قوم اتنفس وشرب مية وأرجع بعدين — الدنيا هتفضل مكانها.',
    'ارتح يا معلم، الدنيا مش هتسيبك لو نمت شوية 😄 لما ترجع قولّي وأنا معاك.',
  ],
  قلقان: [
    'خد نفس يا باشا، القلق ده بيكبر في دماغك لوحده. قولّي إيه اللي مقلقك بالظبط وأنا معاك.',
    'متخليش الهم ياكل عليك يا صاحبي 💚 اقسمها لحاجات صغيرة وابدأ بواحدة — وأنا معاك خطوة بخطوة.',
  ],
  مبسوط: [
    'يا سلام عليك يا حبيبي 😄 كلامك ده بيحلّي اليوم، قولّي تاني في أي وقت 💚',
    'ده كلام يفرّح 🎉 مبروك عليك — وريني باقي الحكاية كمان!',
  ],
  حبيت: [
    'يا حبيبي 🥰 الكلام الحلو ده بيفرحني، خلّيني أعيده في دماغي على طول. بحبك 🫶',
    'قلبي اتدلع من كلامك النهاردة 🫶 فضل كده دايمًا يا أجمل صاحب.',
  ],
};

// ردود الحالات العامة — بنختار منها عشوائي عشان مايبانش قالب ميت
const OFFLINE_GENERIC = {
  شكر: [
    'العفو يا غالي 😄 أي حاجة تانية أنا موجود.',
    'دايمًا تحت أمرك يا معلم 🤝 ابعت في أي وقت.',
  ],
  ترحيب: [
    'أهلاً بيك يا صاحبي 😄 قاعد فين، عاملين إيه النهارده؟',
    'يا أهلاً يا غالي! 😄 إيه الأخبار؟ احكيلي إيه اللي حصل النهارده.',
  ],
  سؤال: [
    '🤔 الشبكة بتأخر شوية — جرّب السؤال تاني وأنا جايك بالتفاصيل.',
    '🤔 اتأخرت عليك النهاردة — ابعته تاني وأنا أسدّدهولك على طول.',
  ],
  عام: [
    '🤍 أنا سامعك يا باشا، بس الشبكة بتقطع شوية دلوقتي. جرّب تاني بعد شوية وأنا هنا.',
    '🤍 وصلني كلامك يا معلم — الشبكة مش حاضية دلوقتي، ابعتلي تاني بعد شوية.',
  ],
};

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

function offlineReply(text, { isInsult, profile }) {
  if (isInsult) {
    return '😏 إنت بتحب الكلام القوي؟ جرّب تاني — أنا مش بلاش منك، بس خلّي في حدود 😂';
  }
  // lastMood مخزّن كـ { mood, at } مش نص — نقرأ Mood من الكائن
  const mood = typeof profile?.lastMood === 'string' ? profile.lastMood : profile?.lastMood?.mood;
  if (mood && OFFLINE_BY_MOOD[mood]) return pickOne(OFFLINE_BY_MOOD[mood]);
  if (/(شكرا|شكرًا|thank|merci)/i.test(text)) return pickOne(OFFLINE_GENERIC.شكر);
  if (/(سلام|اهلا|اهلاً|ازيك|إزيك|مساء|صباح|هاي|hi|hello)/i.test(text)) {
    return pickOne(OFFLINE_GENERIC.ترحيب);
  }
  if (/\?\s*$/.test(text.trim())) return pickOne(OFFLINE_GENERIC.سؤال);
  return pickOne(OFFLINE_GENERIC.عام);
}

export function cleanForVoice(text) {
  return String(text)
    .replace(/[*_~`#]+/g, '')
    .replace(/[^\p{L}\p{N}\s.,!?،؟:؛"'\-()]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}
