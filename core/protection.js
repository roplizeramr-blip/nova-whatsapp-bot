import { downloadContentFromMessage } from '@rexxhayanasi/elaina-baileys';
import api from './api.js';
import { db } from './db.js';
import { uploadBuffer } from './media.js';
import { resolveKey } from './identity.js';

// 🛡️ نواة حماية الجروبات:
// anti-link • anti-spam • anti-سباب • فحص NSFW للصور • نظام إنذارات → طرد تلقائي

const DEFAULTS = {
  antilink: true,
  antispam: true,
  antibad: false,
  nsfw: true,
  welcome: true,
  // 🚫 حمايات متقدمة
  antibot: true,      // فلترة البوتات Other
  antiflood: true,    // منع التكرار (نفس الرسالة 3 مرات)
  capslock: false,    // منع الكتابة كلها كابيتال
  antidelete: false,  // 👻 عرض الرسائل المحذوفة
  // 📣 الاستباقية
  morning: false,     // صباح الخير التلقائي + الصدارة الأسبوعية
  questAuto: false,   // نشر التحدي اليومي تلقائيًا
  followUp: false,    // متابعة الغايبين
  welcomeText: '👋 أهلاً {user} في *{group}*!\nاتفضل اقرأ الوصف وابدأ معانا 🌟',
  // ⚠️ كان الحقل ده نص فاضي المكسور — فكان شرط `if (s.goodbyeText)` دايمًا
  // صح، والبوت يبعث رسالة وداع لكل حد يخرج من أي جروب جديد قبل ما أي
  // أدمن يظبط حاجة. دلوقتي فاضي = مطفي، الأدمن يفعّله بـ `.goodbye on`.
  goodbyeText: '',
  // الدومينات المسموحة في antilink (فاضي = أي لينك ممنوع)
  allowLinks: [],
  // كلمات مخصصة (بتيجي من الداشبورد أو أمر .blacklist)
  badwords: [],
};

const BADWORDS = ['كلب', 'حمار', 'غبي', 'احمق', 'أحمق', 'زبالة', 'خرا', 'قذر', 'مناكير'];
const LINK_RE = /(https?:\/\/|www\.[^\s]+|chat\.whatsapp\.com\/[^\s]+)/i;
const CAPS_RE = /[A-Z]{12,}/;

// 🤖 كلمات سبام — لازم جمل كاملة، مش كلمة لوحدها.
//
// ⚠️ الريجكس القديم كان فيه `join` لوحدها، فأي حد يكتب "هننjoin بكره"
// أو "I'm joining the trip" بتتمسح رسالته ويتطرد بعد 3. كمان ` earning `
// بمسافات جوه البديل كانت مستحيلة تتطابق. دلوقتي جمل/عبارات واضحة بس،
// وبها سبام عربي كمان (البوت عربي).
const SPAM_PATTERNS = [
  /https?:\/\/(?:bit\.ly|tinyurl\.com|t\.me|wa\.me|chat\.whatsapp\.com|\d+\.\d+\.\d+\.\d+)\//i,
  /\b(click here|free money|work from home|earn \$?\d+|join my (?:channel|group|team)|invite link|whatsapp group link)\b/i,
  /(?:كسب|اربح|اشترك|انضم|سجل|ادفع)\s*(?:الان|دلوقتي|\d+\s*(?:جنيه|دولار|ريال))/,
  /(?:رابط|لينك)\s*(?:الربح|بتفرق|مجاني|ديال)/,
  /(.)\1{6,}/, // حرف واحد مكرر 7 مرات (سبام كلاسيكي)
];

export function isSpamText(text) {
  return SPAM_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(String(text ?? ''));
  });
}

// عداد السبام في الذاكرة: sender → [timestamps]
const spamMap = new Map();
const metaCache = new Map();

export function getSettings(jid) {
  const all = db.get('groupSettings', {});
  return { ...DEFAULTS, ...(all[jid] ?? {}) };
}

export function updateSetting(jid, key, value) {
  const all = db.get('groupSettings', {});
  all[jid] = { ...DEFAULTS, ...(all[jid] ?? {}), [key]: value };
  db.set('groupSettings', all);
  return all[jid];
}

// هل المستخدم أدمن في الجروب؟ (كاش 60 ثانية)
export async function isAdmin(sock, jid, userJid) {
  try {
    const cached = metaCache.get(jid);
    const meta = cached && Date.now() - cached.at < 60000 ? cached.meta : await sock.groupMetadata(jid);
    metaCache.set(jid, { meta, at: Date.now() });
    const target = String(userJid).split(':')[0].split('@')[0];
    return (meta.participants ?? []).some(
      (p) => String(p.id).split(':')[0].split('@')[0] === target && (p.admin === 'admin' || p.admin === 'superadmin'),
    );
  } catch {
    return false;
  }
}

export async function deleteMessage(sock, jid, key) {
  try {
    await sock.sendMessage(jid, { delete: key });
    return true;
  } catch {
    return false; // البوت مش أدمن غالبًا
  }
}

// مفتاح الإنذار: بنوحّده على هوية الشخص (resolveKey) وبنرحّل أي إنذار قديم
// متخزّن بالـ JID الخام أو بالرقم بس — عشان `.shop buy clearwarn` يلاقيه.
function warningKey(settings, sender) {
  const s = settings ?? {};
  const canonical = resolveKey(sender) ?? sender;
  if (s.warnings?.[canonical] !== undefined) return canonical;

  const digits = String(sender).split(':')[0].split('@')[0];
  const legacy = Object.keys(s.warnings ?? {}).find((k) => k.split('@')[0] === digits);
  if (legacy !== undefined) {
    // ننقل العدد للمفتاح الجديد ونمسح القديم
    s.warnings[canonical] = s.warnings[legacy];
    delete s.warnings[legacy];
    return canonical;
  }
  return canonical;
}

// إنذار — وبعد 3 إنذارات: طرد
export async function warnUser(sock, jid, sender, reason) {
  const all = db.get('groupSettings', {});
  const s = { ...DEFAULTS, ...(all[jid] ?? {}) };
  s.warnings = s.warnings ?? {};

  // ⚠️ كان بيكتب الإنذار بالـ JID الخام، وأمر `.shop buy clearwarn` بيدوّر
  // بمفتاح الهوية (LID) — فالمستخدم بيدفع 250 عملة على حاجة مش موجودة.
  // دلوقتي هنوحّد على مفتاح الهوية، مع الترحيل للإنذارات القديمة.
  const key = warningKey(s, sender);
  s.warnings[key] = (s.warnings[key] ?? 0) + 1;
  const count = s.warnings[key];
  all[jid] = s;
  db.set('groupSettings', all);

  if (count >= 3) {
    delete s.warnings[key];
    db.set('groupSettings', all);
    try {
      await sock.groupParticipantsUpdate(jid, [sender], 'remove');
      await sock.sendMessage(jid, { text: `🚪 طردت @${norm(sender)} — كمل 3 إنذارات (${reason})`, mentions: [sender] });
    } catch {
      await sock.sendMessage(jid, { text: `⚠️ @${norm(sender)} كمل 3 إنذارات ومقدرتش أطرده — خليوني أدمن (${reason})`, mentions: [sender] });
    }
    return 0;
  }

  await sock.sendMessage(jid, {
    text: `⚠️ إنذار *${count}/3* لـ @${norm(sender)} — ${reason}\nكمل 3 وهتتطرد!`,
    mentions: [sender],
  });
  return count;
}

function norm(j) {
  return String(j).split(':')[0].split('@')[0];
}

// تحميل صورة من رسالة ورفعها لاستضافة مؤقتة → رابط (للرؤية والفحص)
export async function imageToUrl(msg) {
  try {
    const imgMsg =
      msg?.message?.imageMessage ||
      msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ||
      msg?.quoted?.imageMessage ||
      msg?.msg?.message?.imageMessage ||
      msg?.imageMessage;
    if (!imgMsg) return null;

    try {
      const stream = await downloadContentFromMessage(imgMsg, 'image');
      let buffer = Buffer.alloc(0);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 500) {
        const u = await uploadBuffer(buffer);
        if (u) return u;
      }
    } catch {}

    // 🖼️ احتياطي ذكي: استخراج المعاينة المرفقة بالرد في حال عدم توفر مفتاح التشفير
    if (imgMsg.jpegThumbnail) {
      const thumb = Buffer.isBuffer(imgMsg.jpegThumbnail)
        ? imgMsg.jpegThumbnail
        : Buffer.from(imgMsg.jpegThumbnail);
      if (thumb.length > 300) {
        const u = await uploadBuffer(thumb, 'thumb.jpg', 'image/jpeg');
        if (u) return u;
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ⚙️ الفحص الرئيسي — بيتنده لكل رسالة جروب قبل الأوامر
// بيرجع true لو الرسالة اتحذفت (متعالجهاش بعدها)
// آخر رسالة لكل مستخدم (لمنع التكرار)
const lastMsg = new Map();

export async function checkMessage(sock, m) {
  const s = getSettings(m.jid);
  const text = m.body ?? '';
  const lower = text.toLowerCase();

  // تخطي الأدمن في كل الحمايات
  const isAd = await isAdmin(sock, m.jid, m.sender);
  if (isAd) return false;

  const meKey = resolveKey(m.sender) ?? m.sender;
  const meDigits = String(m.sender).split('@')[0];

  // 🔇 مكتوم؟ — نحذف الرسالة ونصمت (ما بنإنذر تاني عشان ما نوصلش 3 ونتفاجأ)
  if (s.muted) {
    const hit =
      s.muted[meKey] ??
      s.muted[m.sender] ??
      Object.entries(s.muted).find(([k, v]) => k.split('@')[0] === meDigits && v.until > Date.now());
    if (hit && (hit.until ?? 0) > Date.now()) {
      await deleteMessage(sock, m.jid, m.msg.key);
      const mins = Math.ceil((hit.until - Date.now()) / 60000);
      if (mins > 0) {
        await sock.sendMessage(m.jid, {
          text: `🔇 @${meDigits} مكتم — فاضل ${mins} دقيقة`,
          mentions: [m.sender],
        }).catch(() => {});
      }
      return true;
    }
  }

  // 🚫 محظور؟ — لو رجع somehow نطرده تاني
  if (s.banned) {
    const banned =
      s.banned[meKey] ?? s.banned[m.sender] ?? Object.keys(s.banned).find((k) => k.split('@')[0] === meDigits);
    if (banned) {
      await deleteMessage(sock, m.jid, m.msg.key);
      await sock.groupParticipantsUpdate(m.jid, [m.sender], 'remove').catch(() => {});
      return true;
    }
  }

  // 🔗 anti-link — مع قائمة سماح (لو الأدمن سماح لـ youtube.com مثلاً)
  if (s.antilink && LINK_RE.test(text)) {
    const allowed = (s.allowLinks ?? []).filter(Boolean);
    const links = text.match(/https?:\/\/[^\s]+|www\.[^\s]+/gi) ?? [];
    const allAllowed = links.length > 0 && links.every((l) => {
      const host = l.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
      return allowed.some((a) => host === String(a).toLowerCase().replace(/^https?:\/\//, '').split('/')[0]);
    });
    if (!allAllowed) {
      await deleteMessage(sock, m.jid, m.msg.key);
      await warnUser(sock, m.jid, m.sender, 'ممنوع اللينكات هنا 🔗');
      return true;
    }
  }

  // 🤬 anti-سباب (الكلمات المخصصة + الافتراضية)
  if (s.antibad) {
    const words = [...BADWORDS, ...(s.badwords ?? [])].filter(Boolean);
    if (words.some((w) => lower.includes(String(w).toLowerCase()))) {
      await deleteMessage(sock, m.jid, m.msg.key);
      await warnUser(sock, m.jid, m.sender, 'كلام مش لائق 🤬');
      return true;
    }
  }

  // 🤖 فلترة البوتات — رسائل سبام جاهزة
  if (s.antibot && SPAM_PATTERNS.some((re) => re.test(text))) {
    await deleteMessage(sock, m.jid, m.msg.key);
    await warnUser(sock, m.jid, m.sender, 'رسالة سبام أو بت 🚫');
    return true;
  }

  // 🌊 منع التكرار — نفس الرسالة. الحالة مرتبطة بالجروب والمرسل
  // عشان رسائل الشخص في جروب تاني ما تتحسبش على الجروب ده.
  if (s.antiflood) {
    const max = s.floodMax ?? 3;
    const secs = (s.floodSecs ?? 8) * 1000;
    const floodKey = `${m.jid}:${m.sender}`;
    const prev = lastMsg.get(floodKey);
    if (prev && prev.text === text && Date.now() - prev.at < secs) {
      prev.count = (prev.count ?? 1) + 1;
      prev.at = Date.now();
      if (prev.count >= max) {
        await deleteMessage(sock, m.jid, m.msg.key);
        lastMsg.delete(floodKey);
        await warnUser(sock, m.jid, m.sender, 'بتكرر الرسالة كتير 🔁');
        return true;
      }
    } else {
      lastMsg.set(floodKey, { text, at: Date.now(), count: 1 });
    }
  }

  // 🔠 منع الكابيتال الطويل
  if (s.capslock && CAPS_RE.test(text)) {
    await deleteMessage(sock, m.jid, m.msg.key);
    await warnUser(sock, m.jid, m.sender, 'نقطة البيع خلاص 🔠');
    return true;
  }

  // 🚫 anti-spam: أكتر من 7 رسايل في 10 ثواني، داخل الجروب الحالي فقط.
  // كان يكتب warning ويرجع false؛ الرسالة بعدها كانت تكمل للأوامر والـAI.
  if (s.antispam) {
    const now = Date.now();
    const spamKey = `${m.jid}:${m.sender}`;
    const stamps = (spamMap.get(spamKey) ?? []).filter((t) => now - t < 10000);
    stamps.push(now);
    spamMap.set(spamKey, stamps);
    if (stamps.length > 7) {
      await deleteMessage(sock, m.jid, m.msg.key);
      await warnUser(sock, m.jid, m.sender, 'سبام كبير 🚫');
      spamMap.set(spamKey, []);
      return true;
    }
  }

  // 🌶️ فحص NSFW للصور
  // ⚠️ `m.key` مش موجودة — buildContext بيرجّع `msg` مش `key`، فكان TypeError
  // بيقع مع أي صورة في أي جروب (الشرط بره الـ try فمش بيتصطاد) → الرسالة كلها
  // بتتمسح بما فيها الأمر، وفحص NSFW ما اشتغلش خالص.
  if (s.nsfw && m.message?.imageMessage && !m.msg?.key?.fromMe) {
    try {
      const url = await imageToUrl(m);
      if (url) {
        const res = await api.nsfwCheck(url);
        if (res.isNSFW) {
          await deleteMessage(sock, m.jid, m.msg.key);
          await warnUser(sock, m.jid, m.sender, 'صور مش مناسبة 🌶️');
          return true;
        }
      }
    } catch {
      // فشل الفحص → نكمل عادي
    }
  }

  return false;
}

// 🧹 تنظيف دوري للخرائط في الذاكرة
//
// ⚠️ spamMap و lastMsg و metaCache كان بيتضافوا مفتاح جديد لكل مستخدم
// وكل جروب ما لمسهم — ومش بيتشالوا غير لما يت tripping. على نشر طويل
// (شهور) ده بيوصل لآلاف المدخلات وبياخد ذاكرة ببطء.
const SWEEP_MS = 10 * 60 * 1000;
const SWEEP_TTL = 2 * 60 * 60 * 1000; // مدخل عمره ساعتين = مش نشط

function sweepMaps() {
  const now = Date.now();
  let removed = 0;
  for (const [k, v] of spamMap) {
    const last = v[v.length - 1] ?? 0;
    if (now - last > SWEEP_TTL) {
      spamMap.delete(k);
      removed++;
    }
  }
  for (const [k, v] of lastMsg) {
    if (now - (v.at ?? 0) > SWEEP_TTL) {
      lastMsg.delete(k);
      removed++;
    }
  }
  for (const [k, v] of metaCache) {
    if (now - (v.at ?? 0) > SWEEP_TTL) {
      metaCache.delete(k);
      removed++;
    }
  }
  if (removed) console.log(`🧹 تنظيف: ${removed} مفتاح قديم من كاش الحماية`);
}

let sweepTimer = null;
export function startProtectionSweep() {
  stopProtectionSweep();
  sweepTimer = setInterval(sweepMaps, SWEEP_MS);
  sweepTimer.unref?.();
  return stopProtectionSweep;
}
export function stopProtectionSweep() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}
