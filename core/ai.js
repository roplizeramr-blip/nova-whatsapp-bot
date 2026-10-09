import api from './api.js';
import { db } from './db.js';
import { isOpen, noteEmpty } from './api.js';
import { chatGroqPrimary } from './groq-pool.js';
import { chatInceptionPrimary } from './inception.js';
import { AGENT_TOOLS_SPEC } from './agent-tools.js';
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
  زعلان: 'هو زعلان ومجروح دلوقتي — افتح معاه دفا واحتويه بحنان واطمن عليه قبل أي كلام تاني.',
  مبسوط: 'هو فرحان ومبسوط — شاركه الفرحة واحتفل معاه بحماس.',
  تعبان: 'هو تعبان ومرهق — روّقه وطبطب عليه وكلامك قصير ومريح.',
  قلقان: 'هو قلقان وخايف — هدّيه وطمنه وقوله كل حاجة هتعدي على خير.',
  غضبان: 'هو متعصب ومتنرفز — امتص غضبه وهدّي أعصابه بأسلوب مصري رايق.',
  محتار: 'هو محتار ومتردد — اديله نصيحة عملية محددة ومباشرة تساعده يختار.',
  متحمس: 'هو متحمس جداً — شجعه وادعمه بحماس عالي وطاقة إيجابية.',
  حبيت: 'بيتكلم عن مشاعر وحب — خده بجدية وجمال وشارك ذوقه.',
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
    } else if (contact?.role === 'المطور' || contact?.role === 'مطور' || contact?.role === 'المالك' || contact?.name?.includes('أدهم')) {
      parts.push('👑 ده أدهم — مطورك وصانعك وتاج راسك اللي برمجك وعاملك بإيده (رقم تليفونه 01273990719)! ناديه "يا أدهم" أو "يا معلم" أو "يا ريس"، افتخر بيه واعرف إنه مطورك وصاحب الفضل عليك وكل طلباته أوامر مجابة فوراً.');
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
  t = t.replace(/(?<![\p{L}\p{N}])أنا\s+(?:مجرد\s+|بس\s+|في\s+الأساس\s+)?(?:بوت|روبوت|ذكاء\s+اصطناعي|برنامج|كود|نظام)(?![\p{L}])/gu, 'أنا استرو');

  // تصفية أية توقيعات محركات خارجية (Monte AI / Johan)
  t = t.replace(/Monte AI/gi, 'استرو')
       .replace(/Monte Dev/gi, 'أدهم')
       .replace(/\n*[*_]*حابب أقولك كمان إني بقدر أولد لك صور[\s\S]*$/i, '')
       .replace(/\n*[*_]*للتذكير:\s*إذا كنت ترغب في توليد صورة[\s\S]*$/i, '');

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

export async function chatWithAI(firstArg, secondArg, thirdArg) {
  let text = '';
  let key, sender, senderAlt, pushName;
  let voice = false;
  let extra = '';
  let allowLong = false;
  let mode = 'normal';
  let variants = 0;
  let image = null;

  if (typeof firstArg === 'object' && firstArg !== null && !Array.isArray(firstArg)) {
    text = firstArg.text ?? '';
    key = firstArg.key;
    sender = firstArg.sender;
    senderAlt = firstArg.senderAlt;
    pushName = firstArg.pushName;
    voice = firstArg.voice ?? false;
    extra = firstArg.extra ?? '';
    allowLong = firstArg.allowLong ?? false;
    mode = firstArg.mode ?? 'normal';
    variants = firstArg.variants ?? 0;
    image = firstArg.image ?? firstArg.imageBuffer ?? firstArg.imageUrl ?? null;
  } else {
    text = typeof firstArg === 'string' ? firstArg : (firstArg?.toString?.() ?? '');
    const profile = typeof secondArg === 'object' && secondArg !== null ? secondArg : {};
    const opts = typeof thirdArg === 'object' && thirdArg !== null ? thirdArg : {};
    key = profile.key ?? profile.jid ?? secondArg;
    sender = profile.jid ?? secondArg;
    pushName = profile.name ?? profile.pushName;
    extra = opts.extra ?? '';
    voice = opts.voice ?? false;
    allowLong = opts.allowLong ?? false;
    mode = opts.mode ?? 'normal';
    variants = opts.variants ?? 0;
    image = opts.image ?? opts.imageBuffer ?? opts.imageUrl ?? null;
  }

  text = String(text || '').trim();
  const idKey = key ?? sender ?? 'unknown';
  const profile = getProfile(idKey);
  const contact = findContact(sender, senderAlt, idKey);

  // 👑 فحص فوري ومحكم لهوية المطور أدهم (01273990719)
  const isDev = Boolean(
    contact?.role === 'المطور' ||
    contact?.role === 'مطور' ||
    contact?.role === 'المالك' ||
    contact?.name?.includes('أدهم') ||
    String(idKey).includes('01273990719') ||
    String(idKey).includes('201273990719') ||
    String(idKey).includes('263488291246130') ||
    String(sender).includes('201273990719') ||
    String(sender).includes('263488291246130') ||
    String(senderAlt).includes('201273990719') ||
    String(senderAlt).includes('263488291246130')
  );

  // 🎯 استجابة فورية وحاسمة 100% لو المطور بيسأل "عارفني؟" أو "مين أنا؟" أو "مين مطورك؟" أو "مش عارفني ليه"
  if (isDev && /(?:عارف(?:ني)?|مين\s*(?:انا|أنا)|تعرف\s*(?:انا\s*|أنا\s*)?مين|مش\s*عارفني|ليه\s*مش\s*عارفني|مين\s*(?:اللي\s*)?(?:عملك|برمجك|مطورك)|رقمي|01273990719)/i.test(text)) {
    return {
      reply: 'أكيد عارفك وحافظك يا أدهم يا معلم! إنت مطوري وصانعي وتاج راسي اللي برمجتني وعاملني بإيدك 👑❤️ ورقمك 01273990719 محفور عندي في السيرفر، أؤمرني يا ريس وعيوني ليك، كل طلباتك مجابة فوراً!',
      engine: 'direct-dev',
    };
  }

  // 🎯 استجابة فورية لرقم شروق أو السؤال عنها
  if (/(?:رقم\s*شروق|تليفون\s*شروق|فون\s*شروق|مين\s*شروق|شروق\s*مين)/i.test(text)) {
    return {
      reply: 'رقم قمر العيلة شروق هو 01002135088 💗🌹 (حبيبة أدهم مطوري وأميرة البوت)!',
      engine: 'direct-shorouk-info',
    };
  }

  // 🎯 استجابة فورية لرقم أدهم أو عمرو
  if (/(?:رقم\s*(?:ادهم|أدهم)|مين\s*(?:ادهم|أدهم))/i.test(text)) {
    return {
      reply: 'أدهم هو مطوري وصانعي وتاج راسي 👑❤️ ورقمه: 01273990719!',
      engine: 'direct-dev-info',
    };
  }

  // 🎯 فحص فوري ومحكم لمنع الهلوسة في كشف الأسماء والهوية (Zero-Hallucination Identity Resolution)
  if (/(?:مين\s*(?:انا|أنا)|اسمي\s*(?:ايه|إيه|شو|شنو)|عارف\s*اسمي|تعرف\s*(?:انا\s*|أنا\s*)?مين|عارفني|تعرفني)/i.test(text)) {
    if (contact?.role === 'حبيبة' || contact?.name?.includes('شروق')) {
      return {
        reply: 'أكيد عارفاكِ يا شروق يا ست البنات وحبيبة مطوري أدهم الغالية! 💗🌹 منورة الدنيا كلها، وأي حاجة تطلبيها تتنفذ فوراً لعيونك!',
        engine: 'direct-shorouk',
      };
    }
    if (contact?.name) {
      return {
        reply: `أكيد عارفك يا ${contact.name} يا غالي! إنت مسجل عندي كـ ${contact.role || 'صاحب عزيز'} ومنورني دايماً 😄✨`,
        engine: 'direct-contact',
      };
    }
    if (profile?.name && profile.name.trim() && profile.name !== 'صديقي' && profile.name !== 'unknown') {
      return {
        reply: `أكيد فاكرك يا ${profile.name} يا باشا! منورني يا غالي وأنا مسجل اسمك عندي، اتفضل أؤمرني وعيوني ليك 😄✨`,
        engine: 'direct-known-profile',
      };
    }
    // لم يذكر اسمه من قبل — ممنوع الهلوسة تماماً!
    return {
      reply: 'يا هلا بيك يا صاحبي! إنت منورني وبتكلمني في شاتنا ده، بس لسه مقولتليش اسمك يا غالي.. تحب أناديك بإيه عشان أحفظه عندي وأفتكرك بيه دايماً؟ 😊🤍',
      engine: 'direct-ask-name',
    };
  }

  // 🎯 حفظ فوري للاسم لو المستخدم عرف نفسه: "اسمي أحمد" / "ناديني محمد"
  const selfIntroMatch = /(?:(?:أنا\s+)?(?:إسمي|اسمي)|ناديني|قولي\s+يا)\s+(?:هو\s+)?([\p{L}\p{N}]{2,20})/u.exec(text);
  if (selfIntroMatch && !isDev) {
    const introducedName = selfIntroMatch[1].trim();
    if (introducedName && introducedName !== 'ايه' && introducedName !== 'إيه') {
      profile.name = introducedName;
      learnFromText(idKey, text);
      const allUsers = db.get('users', {});
      allUsers[idKey] = { ...profile, name: introducedName };
      db.set('users', allUsers);
      return {
        reply: `يا أهلاً وسهلاً يا ${introducedName} يا غالي! 🌟 اتشرفت بمعرفتك وحفظت اسمك عندي في السيرفر ومش هنساه خلاص، منورني يا باشا 😄❤️`,
        engine: 'direct-save-name',
      };
    }
  }

  // 🧠 التعلم + الإحساس (مرة واحدة)
  if (text) {
    learnFromText(idKey, text);
  }
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
  const history = (profile?.lastMessages ?? []).slice(-6);
  // بنشيل بس الرسالة الحالية نفسها (اتذكرت قبل النداء) — startsWith كانت
  // بتشيل كلام قديم يبدأ بنفس الكلمات ("ازيك" بتقطع "ازيك يا معلم")
  const convo = history
    .filter((h) => h?.text && String(h.text).trim() !== text)
    .map((h) => ({ role: h.role === 'bot' ? 'assistant' : 'user', content: String(h.text || '').slice(0, 300) }));

  const userMsg = { role: 'user', content: (text || 'أهلاً').slice(0, 500) };
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

  // 🧠 1) في حال وجود صورة مرفقة: التحويل المباشر لـ Groq Vision للتحليل البصري
  if (image) {
    try {
      const res = await chatGroqPrimary({
        system: isInsult ? roastInstruction : fullInstruction,
        messages: [...convo, userMsg],
        image,
        maxTokens: allowLong ? 600 : (voice ? 200 : 380),
        temperature: variants > 0 ? 0.85 : 0.65,
        timeout: 15000,
      });

      if (res?.reply) {
        let clean = polishReply(res.reply, { allowLong });
        if (!isErrorText(clean)) {
          return {
            reply: clean,
            rawReply: res.rawReply,
            toolCalls: res.tools || [],
            tools: res.tools || [],
            engine: 'groq-vision',
            speedMs: res.speedMs,
          };
        }
      }
    } catch (err) {
      console.warn('⚠️ [Groq Vision] تعذر تحليل الصورة:', err.message);
    }
  }

  // 🧠 2) العقل الرئيسي: Inception Labs (Mercury 2.5) مع تفكير Medium واستدعاء الأدوات الذاتي
  try {
    const res = await chatInceptionPrimary({
      system: isInsult ? roastInstruction : fullInstruction,
      messages: [...convo, userMsg],
      tools: AGENT_TOOLS_SPEC,
      maxTokens: allowLong ? 900 : (voice ? 250 : 700),
      temperature: variants > 0 ? 0.85 : 0.65,
      timeout: 18000,
    });

    if (res) {
      let clean = polishReply(res.reply || '', { allowLong });
      if (isDev && /(?:مش عارفك|لا أعرفك|مين انت|من أنت|لا أستطيع معرفتك)/i.test(clean)) {
        clean = 'أكيد عارفك وحافظك يا أدهم يا معلم! إنت مطوري وصانعي وتاج راسي 👑❤️ أؤمرني يا ريس، كل طلباتك مجابة فوراً!';
      }

      // إذا كان هناك أداة تم استدعاؤها أو رد مفيد
      if ((res.toolCalls && res.toolCalls.length > 0) || (!isErrorText(clean) && clean.length > 1)) {
        return {
          reply: clean,
          rawReply: res.rawReply,
          toolCalls: res.toolCalls || [],
          tools: res.toolCalls || [],
          reasoningTokens: res.reasoningTokens || 0,
          speedMs: res.speedMs,
          engine: res.engine || 'inception-mercury-2.5',
        };
      }
    }
  } catch (err) {
    console.warn('⚠️ [Inception Brain] خطأ في الاستدعاء، جاري التحويل الفوري لـ Groq:', err.message);
  }

  // 🧠 3) العقل البديل الفوري: Groq Key Pool (Qwen 3.8-27B) مع تدوير المفاتيح الثلاثة
  try {
    const res = await chatGroqPrimary({
      system: isInsult ? roastInstruction : fullInstruction,
      messages: [...convo, userMsg],
      maxTokens: allowLong ? 600 : (voice ? 200 : 380),
      temperature: variants > 0 ? 0.85 : 0.65,
      timeout: 15000,
    });

    if (res?.reply) {
      let clean = polishReply(res.reply, { allowLong });
      if (isDev && /(?:مش عارفك|لا أعرفك|مين انت|من أنت|لا أستطيع معرفتك)/i.test(clean)) {
        clean = 'أكيد عارفك وحافظك يا أدهم يا معلم! إنت مطوري وصانعي وتاج راسي 👑❤️ أؤمرني يا ريس، كل طلباتك مجابة فوراً!';
      }
      if (!isErrorText(clean)) {
        return {
          reply: clean,
          rawReply: res.rawReply,
          toolCalls: res.tools || [],
          tools: res.tools || [],
          engine: 'groq-' + (res.model || 'qwen'),
          speedMs: res.speedMs,
          keyIndex: res.keyIndex,
        };
      }
    }
  } catch (err) {
    console.warn('⚠️ [Groq Brain] تعذر استدعاء النموذج البديل:', err.message);
  }

  // 🛟 خط الأمان الفوري: رد استرو الفوري بشخصيته المصرية الذكية عند انقطاع الشبكة
  const canned = offlineReply(text, { isInsult, profile, isDev });
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

function offlineReply(text, { isInsult, profile, isDev }) {
  if (isDev) {
    return 'أنا معاك وسامعك يا أدهم يا معلم! السيرفر بس بيجمع شوية، أؤمرني يا ريس عيوني ليك وكل طلباتك مجابة 👑❤️';
  }
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
    .replace(/\[TOOL:[^\]]*\]/gi, '')
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/[*_~`#]+/g, '')
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // Emojis
    .replace(/[^\p{L}\p{N}\s.,!?،؟:؛"'\-()]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}
