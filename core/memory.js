import { db } from './db.js';
import api from './api.js';
import { CONTACTS } from '../config.js';
import { findContact, normalize } from './identity.js';
import { groqQuick, isGroqReady } from './groq.js';

// 🧠 ذاكرة استرو طويلة المدى — مينساش حد ولا اسم ولا ذكرى
// البروفايل: { name, facts[], memories[{at,text}], lastMessages[], mood, tone, lastSeen, msgCount }

const MAX_MEMORIES = 15;
const MEMORY_FORGET_DAYS = 45; // الذكرى الخفيفة القديمة بتتنسى خالص بعد كده
export const EXTRACT_EVERY = 8; // كل 8 رسايل من المستخدم نستخرج ذكرى

// ⚖️ وزن الذكرى — أساس النسيان التدريجي:
// الذكرى بتفقد قيمتها مع الوقت (بتقلّص نص قوتها كل ~14 يوم تقريبًا) وبتتقوى
// كل ما تتذكر تاني (hits) — والمثبّتة (حظوظ كبيرة: جواز/امتحان/شغل جديد)
// عمرها ما تتشال مهما قدمت. قبل كده كان القطع slice(-15) بيلغي الأقدم
// دايمًا حتى لو أهم حاجة قالتها الشخص في حياته.
function memoryWeight(m) {
  const ageDays = Math.max(0, (Date.now() - (m.at ?? Date.now())) / 86400000);
  const recency = 50 * Math.exp(-ageDays / 14);
  const pins = m.pin ? 1000 : 0;
  const uses = (m.hits ?? 0) * 40;
  return pins + uses + recency;
}

// 🧹 النسيان التدريجي: القديمة الخفيفة بتتسى وتتنسى، وفوق السقف الأضعف
// وزنًا هو اللي يمشي (مش الأقدم بالضرورة) — والترتيب الزمني بيفضل محفوظ.
function pruneMemories(memories) {
  const kept = memories.filter((m) => {
    if (!m?.text) return false;
    if (m.pin) return true;
    const ageDays = Math.max(0, (Date.now() - (m.at ?? Date.now())) / 86400000);
    if (ageDays > MEMORY_FORGET_DAYS && memoryWeight(m) < 10) return false; // اتنست
    return true;
  });
  if (kept.length <= MAX_MEMORIES) return kept;
  return kept
    .map((m, i) => ({ m, i }))
    .sort((a, b) => memoryWeight(b.m) - memoryWeight(a.m) || a.i - b.i)
    .slice(0, MAX_MEMORIES)
    .sort((a, b) => a.i - b.i)
    .map(({ m }) => m);
}

// 🔤 كلمات وظيفية ما تنفعش للربط بين الذكرى والكلام الحالي
const STOP_WORDS = /^(?:الي|من|في|على|عن|ده|دي|دا|ان|انا|احنا|انت|بتاع|يعني|اهو|فوق|تحت|او|ولا|اللي|كده|كدا|خلاص|تمام|ايوه|أيوه|ليه|ازاي|فين|امتى|مين|ايه|بس|علشان|عشان|بقى|دلوقتي)$/;

function wordsOf(t) {
  return new Set(
    String(t ?? '')
      .toLowerCase()
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2 && !STOP_WORDS.test(w)),
  );
}

// 🔁 هل النصين قريبين لحد ما يبقوا نفس الذكرى بغلافين؟ (نسبة كلمات مشتركة)
function nearDuplicate(a, b) {
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (!wa.size || !wb.size) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size) >= 0.7;
}

// 🎯 الذكريات الأنسب للكلام الحالي — التقاطع مع الرسالة لوّنها، والحداثة يكسر التعادل.
// من غيرها كنا بنحقن "أحدث 3" دايماً: لو المستخدم رجع عن موضوع قديم، البوت
// كان بيفكر في آخر ذكرى بلا علاقة باللي بيتكلم عنه.
export function pickRelevantMemories(profile, currentText = '', n = 3) {
  const mems = profile?.memories ?? [];
  if (!mems.length) return [];
  const cur = wordsOf(currentText);
  const now = Date.now();
  const scored = mems.map((m) => {
    const mw = wordsOf(m.text);
    let overlap = 0;
    for (const w of mw) if (cur.has(w)) overlap++;
    const relevance = cur.size ? overlap / cur.size : 0;
    const ageDays = (now - (m.at ?? now)) / 86400000;
    const recency = 1 / (1 + ageDays / 14); // الأسبوعين حدث واضح، القديمة ما تختفيش
    // التثبيت والتكرار بيرفعوا وزن الذكرى (نفس منطق النسيان التدريجي)
    const strength = (m.pin ? 0.5 : 0) + Math.min(m.hits ?? 0, 5) * 0.1;
    return { m, score: relevance * 2 + recency * 0.4 + strength };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((s) => s.m);
}

function users() {
  return db.get('users', {});
}

export function getProfile(key) {
  const all = users();
  const profile = all[key] ?? {
    name: null,
    facts: [],
    memories: [],
    lastMessages: [],
    joinedAt: Date.now(),
    lastSeen: null,
    msgCount: 0,
    lastMood: null,
    tone: null,
  };
  // 💚 الأصدقاء المقربين — اسمهم من config عمره ما يضيع
  // (بأي صيغة مفتاح: رقم دولي أو LID — findContact بتحل أي صيغة للمفتاح الأساسي)
  const contact = CONTACTS[key] ?? findContact(key);
  if (contact && !profile.name) profile.name = contact.name;
  return profile;
}

export function saveProfile(key, profile) {
  const all = users();
  profile.lastSeen = Date.now();
  all[key] = profile;
  db.set('users', all);
}

// ⏳ تحديث آخر ظهور + آخر شات + عداد الرسايل (لجدولة استخراج الذكريات)
export function touchProfile(key, chatJid = null) {
  const p = getProfile(key);
  p.lastSeen = Date.now();
  if (chatJid) p.lastChat = chatJid;
  p.msgCount = (p.msgCount ?? 0) + 1;
  saveProfile(key, p);
  return p;
}

export function rememberMessage(key, role, text) {
  const p = getProfile(key);
  p.lastMessages = [...(p.lastMessages ?? []), { role, text: String(text).slice(0, 300) }].slice(-8);
  saveProfile(key, p);
}

// 🧠 تثبيت ذكرى — pinned = حظوظ كبيرة (جواز/امتحان/شغل جديد) عمرها ما تتنسى
export function rememberMemory(key, text, { pinned = false } = {}) {
  const p = getProfile(key);
  const memories = p.memories ?? [];
  const clean = String(text).trim().slice(0, 150);
  if (!clean) return false;
  // التطابق الحرفي + القريب منه: "شغالة في شركة تصاميم" و"بتشتغل في شركة تصاميم"
  // مش ذكرى مختلفة — والإعادة بتقوّي الذكرى الموجودة (hits) بدل ما نتجاهلها
  const existing = memories.find((m) => m.text === clean || nearDuplicate(m.text, clean));
  if (existing) {
    existing.hits = (existing.hits ?? 0) + 1;
    existing.at = Date.now(); // آخر مرة اتذكرت — بتحسب في وزن النسيان
    if (pinned) existing.pin = true;
    p.memories = pruneMemories(memories);
    saveProfile(key, p);
    return false;
  }
  // ⚠️ مهم: بنكتب على نفس الـ object عشان مايضيعش بالتحديث المتأخر من saveProfile
  const entry = { at: Date.now(), text: clean, hits: 0 };
  if (pinned) entry.pin = true;
  p.memories = pruneMemories([...memories, entry]);
  saveProfile(key, p);
  return true;
}

export function rememberFact(key, fact) {
  const p = getProfile(key);
  p.facts = p.facts ?? [];
  if (!p.facts.includes(fact)) {
    p.facts = [...p.facts, fact].slice(-10);
    saveProfile(key, p);
    return true;
  }
  return false;
}

export function rememberMood(key, mood) {
  const p = getProfile(key);
  p.lastMood = { mood, at: Date.now() };
  saveProfile(key, p);
}

// 😊 كشف الإحساس من كلام المستخدم — مع قراءة النفي صح
// (المشكلة القديمة: "أنا مش مبسوط" كانت بتتفسّر فرحان!)
const NEGATION = /(?:مش|مست|ما\s*ب?ش|ما\s*ب?عرفش|بخصوص|مش\s*خالص)/;
const MOODS = [
  { mood: 'زعلان', re: /زعلان|مجروح|حزين|مكسور|ضايق|بكيت|زهقان|تعبت من الدنيا|مصعّب|مضايق|مخنوق/, neg: /مش\s*(?:زعلان|مكسور|حزين)|محدش\s*زعلان/ },
  { mood: 'تعبان', re: /تعبان|مرهق|مجهد|مضغوط|مش قادر|منهار|مانمتش|هلكان/, neg: /مش\s*(?:تعبان|مرهق|مجهد)/ },
  { mood: 'قلقان', re: /قلقان|خايف|مرعوب|متوتر|قلقي|همي|قلق|مش مطمن/, neg: /مش\s*(?:قلقان|خايف|متوتر)/ },
  { mood: 'غضبان', re: /متنرفز|متغاظ|متعصب|دمي فاير|هفرقع|غضبان|اتخانقت|ولعت/, neg: /مش\s*(?:متنرفز|متعصب|غضبان)/ },
  { mood: 'محتار', re: /محتار|متردد|مش عارف اعمل ايه|تنصحني بايه|بين أمرين|حيران/, neg: /مش\s*محتار/ },
  { mood: 'متحمس', re: /متحمس|شغف|فكرة جامدة|طاير من الفرح|مش مصدق من الفرحة/, neg: /مش\s*متحمس/ },
  { mood: 'حبيت', re: /بحب|حبيت|عاشق|غرمت|في قلبي|حبيبتي|حبيبي|روحي/, neg: null },
  { mood: 'مبسوط', re: /مبسوط|سعيد|فرحان|أجمد|رابح|الحمد لله|فتحت|مبروك|فرحتي/, neg: /مش\s*(?:مبسوط|سعيد|فرحان)/ },
];

export function detectMood(text) {
  for (const { mood, re, neg } of MOODS) {
    if (!re.test(text)) continue;
    // لو فيه نفي قبل الكلمة مباشرة → مشMood ده (يعكسه)
    if (neg && neg.test(text)) continue;
    return mood;
  }
  return null;
}

// 😐 مقياس الحنية — لو زهق من كتر الحنية يتراجع لفترة
export function setTone(key, mode) {
  const p = getProfile(key);
  p.tone = mode === 'chill' ? { mode, until: Date.now() + 2 * 3600000, msgsLeft: 10 } : null;
  saveProfile(key, p);
}

export function currentTone(profile) {
  const t = profile?.tone;
  if (!t) return 'warm';
  if (t.mode === 'chill') {
    if (Date.now() > t.until || t.msgsLeft <= 0) {
      return 'warm'; // المنادي مش هيتحدث هنا — اتحدث في saveProfile اللاحقة
    }
    return 'chill';
  }
  return t.mode ?? 'warm';
}

export function chillTick(key) {
  const p = getProfile(key);
  if (p.tone?.mode === 'chill') {
    p.tone.msgsLeft--;
    if (p.tone.msgsLeft <= 0) p.tone = null;
    saveProfile(key, p);
  }
}

// 🗑️ حذف ذكرى محددة بالرقم
export function deleteMemory(key, index) {
  const p = getProfile(key);
  if (!p.memories || index < 0 || index >= p.memories.length) return null;
  const removed = p.memories.splice(index, 1)[0];
  saveProfile(key, p);
  return removed;
}

// 🧹 تصفير كل الذكريات للمستخدم
export function clearMemories(key) {
  const p = getProfile(key);
  const count = p.memories?.length ?? 0;
  p.memories = [];
  saveProfile(key, p);
  return count;
}

// 🔤 حفظ تفضيل اللغة (مصري / فصحى / إنجليزي / فرانكو)
export function setLanguage(key, lang) {
  const p = getProfile(key);
  p.lang = lang;
  saveProfile(key, p);
  return lang;
}

// اسم الشخص لا يُنسى: الأولوية للأصدقاء (بأي صيغة هوية)، ثم "اسمي فلان"، ثم pushName
export function ensureName(key, profile, pushName, sender, senderAlt) {
  // 💚 الأصدقاء المقربين — اسمهم ثابت من config (بأي صيغة هوية: رقم أو LID)
  const contact = findContact(key, sender, senderAlt);
  if (contact) {
    if (profile.name !== contact.name) {
      profile.name = contact.name;
      // نسجل جهازه عشان المرات الجاية
      profile.phoneJid = sender;
      saveProfile(key, profile);
      return true;
    }
    return false;
  }
  if (profile.name) return false;
  const candidate = pushName && pushName !== 'صديقي' && pushName.length >= 2 ? pushName : null;
  if (candidate) {
    profile.name = candidate;
    saveProfile(key, profile);
    return true;
  }
  return false;
}

// استخراج معلومات ذاتية من كلام المستخدم: "اسمي أحمد" / "أنا بنت" / "أنا ولد"
export function learnFromText(key, text) {
  const p = getProfile(key);
  const facts = p.facts ?? [];
  let changed = false;

  // الاسم — بكل صيغه (اسمي، أنا اسمي، ناديني، قولي يا)
  const nameMatch = /(?:(?:أنا\s+)?(?:إسمي|اسمي)|ناديني|قولي\s+يا)\s+(?:هو\s+)?([\p{L}\p{N}]{2,20})/u.exec(text);
  if (nameMatch && nameMatch[1] !== p.name) {
    const candidate = nameMatch[1].trim();
    if (!/^(?:ايه|إيه|شو|شنو|مين|كده|كدا)$/i.test(candidate)) {
      p.name = candidate;
      changed = true;
    }
  }

  // النوع — مع احترام النفي ("أنا مش بنت" = ولد)
  if (/(?:^|\s)(?:أنا|انا)\s*(?:مش|مست)?\s*(بنت|صبية|ست|بنتة)/.test(text)) {
    const isNegated = /(?:أنا|انا)\s*(?:مش|مست)\s*(بنت|صبية|ست)/.test(text);
    const want = isNegated ? 'ولد' : 'بنت';
    if (!facts.includes(want)) {
      const other = want === 'بنت' ? 'ولد' : 'بنت';
      const i = facts.indexOf(other);
      if (i >= 0) facts.splice(i, 1);
      facts.push(want);
      changed = true;
    }
  }
  if (/(?:^|\s)(?:أنا|انا)\s*(?:مش|مست)?\s*(ولد|راجل|رجالة)/.test(text)) {
    const isNegated = /(?:أنا|انا)\s*(?:مش|مست)\s*(ولد|راجل)/.test(text);
    const want = isNegated ? 'بنت' : 'ولد';
    if (!facts.includes(want)) {
      const other = want === 'بنت' ? 'ولد' : 'بنت';
      const i = facts.indexOf(other);
      if (i >= 0) facts.splice(i, 1);
      facts.push(want);
      changed = true;
    }
  }

  // 🔍 لحظات مهمة تستاهل ذكرى — بتتثبّت (pin) عشان النسيان التدريجي ما يمسهاش
  const bigMoment = /(?:سافرت|عندي (?:امتحان|مقابلة|شغل جديد)|اتخرجت|بشتغل دلوقتي|سكنت|جوازي|خطوبتي|مريض|دخلت (?:الجامعة|الجيش)|خلصت مشروع)/.test(text);
  if (bigMoment) {
    rememberMemory(key, text.slice(0, 120), { pinned: true });
  }

  if (changed) {
    p.facts = facts;
    saveProfile(key, p);
  }
  return changed;
}

// 💭 استخراج ذكرى من آخر محادثة — نداء AI سريع، بيتنادى كل EXTRACT_EVERY رسالة
// ⚡ أولاً groqQuick (مفتاحنا — أرخص وأسرع من engez) وapi.gpt احتياط لو مفيش مفتاح
export async function extractMemory(key) {
  const p = getProfile(key);
  const convo = (p.lastMessages ?? [])
    .filter((m) => m.role === 'user')
    .map((m) => m.text)
    .join(' | ')
    .slice(0, 700);
  if (!convo || convo.length < 20) return false;

  // كلام من غير جوهر (تحيات وقصير) ما يستحقش نداء استخراج أصلاً
  const meaningful = convo.split(/\s+/).filter((w) => wordsOf(w).size).length;
  if (meaningful < 4) return false;

  const prompt =
    `من الكلام ده استخرج معلومة شخصية واحدة مهمة عن "${p.name ?? 'الشخص'}" — ` +
    `حاجة تستاهل تتفتكر بعدين (عمله أو دراسته، خبر حصلله، حاجة بتحبها أو يكرهها، هدف أو مشكلة عنده). ` +
    `ذكّر بالتفاصيل الملموسة (أسماء وأماكن وأرقام) من غير ما تنقل كلامه حرفياً. ` +
    `رد بالمعلومة بس في سطر واحد قصير بالعامية المصرية، ولو مفيش حاجة مهمة رد بالحرفين: مفيش\n\nالكلام: ${convo}`;

  const extract = async () => {
    if (isGroqReady()) {
      try {
        return await groqQuick('انت مساعد استخراج بيانات — رد بس بالمطلوب بدون أي شرح.', prompt, 90);
      } catch {}
    }
    return api.gpt(prompt);
  };

  try {
    const raw = await extract();
    const clean = String(raw ?? '').trim().replace(/^["'-]+|["'-]+$/g, '');
    if (clean && clean.length > 5 && clean.length < 150 && !/مفيش|لا يوجد|لا توجد/i.test(clean)) {
      return rememberMemory(key, clean);
    }
  } catch {}
  return false;
}

// هل ده "رجوع" بعد غياب؟ وكم ساعة؟
export function absenceHours(profile) {
  if (!profile?.lastSeen) return 0;
  return (Date.now() - profile.lastSeen) / 3600000;
}

// نص سياق جاهز للحقن في تعليمات الـ AI — بيحترم ميزانية طول الرابط
// currentText اختياري: بيرتب الذكريات بالأنسب للكلام الحالي مش بالأحدث بس
export function contextBlock(profile, pushName, budget = 300, currentText = '') {
  const lines = [];
  const name = profile.name ?? (pushName !== 'صديقي' ? pushName : null);
  if (name) lines.push(`- اسمه: "${name}"`);
  for (const f of profile.facts ?? []) lines.push(`- معلومة: ${f}`);

  // آخر إحساس معروف — البوت يفتح بيه
  const moodInfo = profile.lastMood;
  if (moodInfo?.mood) {
    const hoursAgo = (Date.now() - moodInfo.at) / 3600000;
    if (hoursAgo < 24) {
      const ago = hoursAgo < 1 ? 'من شوية' : `من ${Math.round(hoursAgo)} ساعة`;
      lines.push(`- آخر إحساس له: "${moodInfo.mood}" (${ago}) — افتح بالسؤال عن إحساسه`);
    }
  }

  // 💭 الذكريات الأنسب للسياق (٣ بحد أقصى)
  const mems = pickRelevantMemories(profile, currentText, 3);
  const memLine = mems.length ? '- ذكريات من كلامه قبل كده: ' + mems.map((m) => m.text).join(' • ') : '';

  let block = [lines.join('\n'), memLine].filter(Boolean).join('\n');
  if (block.length > budget) block = block.slice(0, budget);

  // آخر الكلام — بنلحق اللي يملا الميزانية
  const convoParts = [];
  const msgs = profile.lastMessages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const line = `${msgs[i].role === 'user' ? 'هو قال' : 'إنت ردت'}: ${msgs[i].text.slice(0, 120)}`;
    if (block.length + line.length + 1 > budget) break;
    convoParts.unshift(line);
    block = [lines.join('\n'), memLine, convoParts.length ? 'آخر الكلام:\n' + convoParts.join('\n') : '']
      .filter(Boolean)
      .join('\n');
  }

  return { block };
}

// 🧹 ترحيل بيانات قديمة — بيتنده مرة عند الإقلاع
export function migrateOldData() {
  const all = users();
  if (!all['']) return;

  // مين كان آخر واحد مستخدم البروفايل المكسور (الفاضي)؟ — الأحدث بالتوقيت
  const aiStates = db.get('aiState', {});
  const lastUser = Object.entries(aiStates)
    .filter(([, v]) => (v?.by ?? '') === '' || v?.at)
    .sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0))
    .map(([lid]) => lid)[0];

  if (lastUser && !all[lastUser]) {
    all[lastUser] = { ...all[''], joinedAt: all[''].joinedAt ?? Date.now() };
    delete all[''];
    db.set('users', all);
    console.log(`🧠 ترحيل الذاكرة: البروفايل القديم اتربط بالهوية ${lastUser}`);
  }
}

// 🔀 دمج بروفايلين لنفس الشخص — الأساس a (الأغنى) والبروفايل b بيتصب فيه
function mergeProfiles(a, b) {
  const out = JSON.parse(JSON.stringify(a));
  // المعلومات: اتحاد بدون تكرار
  out.facts = [...new Set([...(a.facts ?? []), ...(b.facts ?? [])])].slice(-10);
  // الذكريات: اتحاد بدون تكرار مرتب بالزمن — والمكررة بتدمج قوتها (hits/pin)
  const byText = new Map();
  for (const m of [...(a.memories ?? []), ...(b.memories ?? [])]) {
    if (!m?.text) continue;
    const cur = byText.get(m.text);
    if (!cur) {
      byText.set(m.text, { ...m });
      continue;
    }
    cur.hits = Math.max(cur.hits ?? 0, m.hits ?? 0);
    if (m.pin) cur.pin = true;
    if ((m.at ?? 0) > (cur.at ?? 0)) cur.at = m.at;
  }
  out.memories = pruneMemories([...byText.values()].sort((x, y) => (x.at ?? 0) - (y.at ?? 0)));
  // آخر الكلام: بدون تكرار — آخر ظهور للجملة يكسب مكانه
  const convo = new Map();
  for (const msg of [...(a.lastMessages ?? []), ...(b.lastMessages ?? [])]) {
    if (msg?.text) convo.set(`${msg.role}|${msg.text}`, msg);
  }
  out.lastMessages = [...convo.values()].slice(-8);
  // العدادات والتواريخ بتتجمع
  out.msgCount = (a.msgCount ?? 0) + (b.msgCount ?? 0);
  out.joinedAt = Math.min(a.joinedAt ?? Date.now(), b.joinedAt ?? Date.now());
  out.lastSeen = Math.max(a.lastSeen ?? 0, b.lastSeen ?? 0);
  // آخر إحساس: الأحدث زمنًا يكسب
  if ((b.lastMood?.at ?? 0) > (out.lastMood?.at ?? 0)) out.lastMood = b.lastMood;
  // التبريد: لو الأساس مفيش منه خد بتاع التاني
  if (!out.tone && b.tone) out.tone = b.tone;
  // أي حقول ناقصة في الأساس كمّلها من التاني
  for (const [k, v] of Object.entries(b)) if (out[k] === undefined) out[k] = v;
  out.name = a.name ?? b.name ?? null;
  return out;
}

// 🧬 إصلاح جذري للبروفايلات المكررة: "شروق" بمفتاحين (LID ورقم) = بروفايل واحد
// بتتنده من bootCleanup عند الإقلاع:
//   1. بتلاقي كل مفاتيح نفس الشخص (الرقم + LIDs من config + الأسماء البديلة في identities)
//   2. بتدمجهم في بروفايل واحد تحت المفتاح الأساسي (الرقم الدولي) —
//      الأغنى ذكريات (وعند التعادل الأحدث ظهور) هو اللي بياخد الأساس
//   3. بتربط كل المفاتيح القديمة في identities بالمفتاح الأساسي
// بترجع عدد البروفايلات اللي اتمسحت بالدمج
export function mergeDuplicateProfiles() {
  const all = users();
  const aliases = db.get('identities', {});

  // كل صاحب ومفاتيحه المعروفة (رقم + LIDs من config + أسماء بديلة بيشاوروا عليهم)
  const groups = [];
  for (const [pn, meta] of Object.entries(CONTACTS)) {
    const ids = new Set([pn, ...(meta.lids ?? []).map(normalize).filter(Boolean)]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [alias, target] of Object.entries(aliases)) {
        if (ids.has(target) && !ids.has(alias)) {
          ids.add(alias);
          grew = true;
        }
      }
    }
    groups.push({ pn, meta, ids });
  }

  // بروفايلات اسمها نفس اسم صاحب من CONTACTS؟ دي لنفس الشخص برضه
  // — بس من غير ما نلمس مفتاح محجوز لصاحب تاني (مفيش دمج شخصين مختلفين بالغلط)
  for (const g of groups) {
    for (const [key, p] of Object.entries(all)) {
      if (g.ids.has(key) || p?.name !== g.meta.name) continue;
      if (groups.some((o) => o !== g && o.ids.has(key))) continue;
      g.ids.add(key);
    }
  }

  let mergedCount = 0;
  for (const { pn, meta, ids } of groups) {
    const keys = [...ids].filter((k) => all[k]);
    if (!keys.length) continue; // مفيش بروفايلات للشخص ده أصلًا
    if (keys.length === 1 && keys[0] === pn) continue; // مفيش تكرار

    // البروفايل الأغنى يكسب: الأكبر ذكريات، وعند التعادل الأحدث ظهور
    const winner = [...keys].sort((a, b) => {
      const byMem = (all[b].memories?.length ?? 0) - (all[a].memories?.length ?? 0);
      if (byMem) return byMem;
      return (all[b].lastSeen ?? 0) - (all[a].lastSeen ?? 0);
    })[0];

    let merged = JSON.parse(JSON.stringify(all[winner]));
    for (const k of keys) {
      if (k === winner) continue;
      merged = mergeProfiles(merged, all[k]);
      delete all[k];
      mergedCount++;
    }
    // 💚 اسم الأصدقاء من config هو المصدر الرسمي دايمًا
    merged.name = meta.name;
    all[pn] = merged;
    if (winner !== pn) {
      delete all[winner];
      mergedCount++;
    }

    // 🔗 كل المفاتيح القديمة بتبص على المفتاح الأساسي من دلوقتي
    for (const id of ids) aliases[id] = pn;
    aliases[pn] = pn;

    console.log(`🧬 دمج بروفايلات "${meta.name}": ${keys.filter((k) => k !== pn).join(' + ') || '(نقل)'} → ${pn}`);
  }

  if (mergedCount) {
    db.set('users', all);
    db.set('identities', aliases);
  }
  return mergedCount;
}
