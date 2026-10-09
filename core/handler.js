import { config } from '../config.js';
import { sendText } from './send.js';
import { maybeAutoReply } from './autoreply.js';
import { checkMessage, getSettings } from './protection.js';
import { db } from './db.js';
import { isOwner } from '../lib/utils.js';
import { normalizeArabic } from './arabic.js';
import { resolveKey, canonicalKey } from './identity.js';
import { awardXp, checkBadges } from './economy.js';
import { bump, recordCommandError } from './stats.js';
import { interceptGameInput } from './game-interceptor.js';

const cooldowns = new Map();
// 🗣️ آخر مرة قلنالها "استنى" — عشان الرد يبقى مرة في البرست مش مع كل رسالة
const cooldownNotices = new Map();
const COOLDOWN_NOTICE_GAP = 10000;
const botStartTime = Date.now();

// 🧹 الكولداون كان بيكبر بلا حد: مفتاح لكل (مستخدم × أمر) = 63 أمر × كل حد
// شافه البوت. على نشر طويل ده آلاف المدخلات بتتخزّن للأبد. بنمسح اللي عدّى
// عليه ساعة كل 10 دقايق.
const COOLDOWN_TTL = 3600000;
let cooldownSweep = null;
export function startCooldownSweep() {
  if (cooldownSweep) return;
  cooldownSweep = setInterval(() => {
    const now = Date.now();
    for (const [k, t] of cooldowns) {
      if (now - t > COOLDOWN_TTL) cooldowns.delete(k);
    }
    for (const [k, t] of cooldownNotices) {
      if (now - t > COOLDOWN_TTL) cooldownNotices.delete(k);
    }
  }, 600000);
  cooldownSweep.unref?.();
}

// فك الرسائل الملفوفة (ephemeral / viewOnce ...) لحد الرسالة الحقيقية
function unwrapMessage(message) {
  let node = message;
  const wrappers = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
    'editedMessage',
  ];
  for (let i = 0; i < 5 && node; i++) {
    const wrapper = wrappers.find((w) => node[w]);
    if (!wrapper) break;
    node = node[wrapper].message;
  }
  return node;
}

// استخراج نص الرسالة — وكمان ردود الأزرار والقوائم بتوصل هنا
function extractBody(message) {
  if (!message) return '';
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  // ملف/caption — الأوامر المتبعتة كوصف لملف كانت بتضيع
  if (message.documentMessage?.caption) return message.documentMessage.caption;

  // رد على زر سريع أو اختيار من القائمة (native flow)
  const params = message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (params) {
    try {
      return JSON.parse(params).id ?? '';
    } catch {
      return '';
    }
  }

  // ردود القوائم والأزرار القديمة
  return (
    message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    message.templateButtonReplyMessage?.selectedId ||
    message.buttonsResponseMessage?.selectedButtonId ||
    ''
  );
}

/**
 * نقطة دخول كل رسايل واتساب — بتفك الرسالة، تبني الـ context، توجّه الأوامر
 * للرد الذكي التلقائي. كل رسالة في try بتاعها عشان وحدة وقعة ما تقتلش الباقي.
 * ما بترميش استثناءات لأي حد فوقها.
 */
export async function handleUpsert(sock, ctx, { messages, type }) {
  if (type !== 'notify') return;

  // ⚠️ من غير ده: لو Baileys بعت event من غير messages، الـ for بيعمل TypeError
  // بره الـ try → unhandled rejection بيقتل المعالج كله
  for (const msg of messages ?? []) {
    try {
      if (!msg?.message || !msg.key) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;
      if (msg.key.fromMe && !config.respondToSelf) continue;

      // 👻 مضاد الحذف: حد حذف رسالة نصية في جروب مفعّل → نعرض الأصل من ذاكرتنا
      const pm = msg.message.protocolMessage;
      if (pm?.type === 0 && pm.key) {
        try {
          const chatId = pm.key.remoteJid ?? msg.key.remoteJid;
          if (chatId?.endsWith('@g.us') && getSettings(chatId).antidelete) {
            await announceDeleted(sock, chatId, pm.key);
          }
        } catch (err) {
          console.error('⚠️ anti-delete فشل:', err.message?.slice(0, 60));
        }
        continue; // رسالة بروتوكول — مفيش محتوى نعالجه
      }

      const message = unwrapMessage(msg.message);
      const body = extractBody(message);

      // 🎙️ الرسايل الصوتية مفيهاش نص — بنسيبها تعدي عشان نوفا يسمعها ويحاورها
      const isVoiceNote = !!message?.audioMessage;
      if (!body && !isVoiceNote) continue;

      const m = buildContext(sock, msg, message, body);
      bump('messages');
      console.log(`📩 [${m.isGroup ? 'جروب' : 'خاص'}] رسالة من ${m.pushName || 'مستخدم'} (${m.sender?.split('@')[0]}): "${m.body?.slice(0, 60)}"`);

      // 😴 لو البوت مقفول في الشات ده (عدا المالك)
      if (db.get('botOff', {})[m.jid] && !isOwner(m, config)) {
        console.log(`😴 تم تخطي الرسالة لأن البوت معطل في الشات (${m.jid})`);
        continue;
      }

      // 🛡️ حماية الجروبات — لو الرسالة اتحذفت متعالجهاش.
      // fail-open: نظام الحماية لو ضرب error (حذف فاشل، API واقف) ما يوقفش
      // الرسالة كلها — كانت الأوامر كلها في الجروب بتضيع بصمت مع أول عطل.
      if (m.isGroup) {
        try {
          if (await checkMessage(sock, m)) {
            console.log(`🛡️ رسالة محجوبة بواسطة نظام الحماية: ${m.sender}`);
            continue;
          }
        } catch (err) {
          console.error('⚠️ فحص حماية الجروب فشل — الرسالة هتعدي عادي:', err.message?.slice(0, 80));
        }
      }

      await routeCommand(sock, m, ctx);
      // 🧠 الرد الذكي التلقائي — للأوامر اللي مش بأوامر (خاص / منشن / رد / كلمة سحرية)
      if (!m.body.startsWith(config.prefix)) {
        let gameHandled = false;
        try {
          gameHandled = await interceptGameInput(sock, m);
        } catch (gameErr) {
          console.error('⚠️ خطأ في معالج الألعاب التلقائي:', gameErr);
        }
        if (!gameHandled) {
          await maybeAutoReply(sock, m);
        }
      }
    } catch (err) {
      console.error('❌ خطأ في معالجة رسالة:', err);
    }
  }
}

// 👻 مضاد الحذف — كان فيه خطأين:
// 1) `.find()` بترجّع أول رسالة مستخدم في النافذة (الأقدم) مش المحذوفة →
//    البوت كان بيعلن رسالة من ساعتين. الصح: آخر رسالة.
// 2) البروفايلات مخزّنة بـ LID لا بأرقام التليفون، فالبحث بالرقم كان بيرجّع
//    undefined والميزة كانت شغالة على الفاضي.
async function announceDeleted(sock, chatId, deletedKey) {
  // لا نستنتج محتوى الرسالة من سجل المستخدم: السجل ليس مربوطًا بـchatId/messageId
  // وقد يحتوي نصًا خاصًا أو نصًا أقدم. إشعار عام فقط إلى أن يتوفر تطابق دقيق.
  const author = deletedKey.participant ?? deletedKey.remoteJid ?? '';
  if (!author) return;
  const digits = String(author).split(':')[0].split('@')[0];
  await sendText(sock, chatId, `👻 رسالة من @${digits} اتحذفت.`, {
    mentions: [author],
  });
}

function buildContext(sock, msg, message, body) {
  const jid = msg.key.remoteJid;
  const sender = msg.key.fromMe
    ? jid
    : msg.key.participant || jid; // ← التصليح: participant بيرجع "" في الخاص، فـ || بدل ؟?

  // 🆔 الهوية الموحدة (LID مفضّل) — عشان الذاكرة ماتنساش حد
  // حسب توثيق المكتبة: الخاص → remoteJidAlt | الجروب → participantAlt (رقم التليفون الحقيقي)
  const senderAlt = msg.key.remoteJidAlt ?? msg.key.participantAlt ?? null;
  const identityKey = resolveKey(msg.key.participant, senderAlt, jid) ?? sender ?? jid;

  const args = body.startsWith(config.prefix)
    ? body.slice(config.prefix.length).trim().split(/\s+/).filter(Boolean)
    : [];

  // 🆔 المفتاح الكانوني — بيتحسب مرة واحدة لكل رسالة (lazy) وبدون ما يعطّل أي حاجة:
  // identityKey فوق فضل زي ما هو (نفس السلوك القديم)، و`m.canonical` بيجيب المفتاح
  // الثابت لصاحبنا (رقمه الدولي). لو فشل بيترجع null والمستدعي يستخدم identityKey.
  let canonPromise = null;
  const getCanonical = () => {
    canonPromise ??= canonicalKey(sock, sender || senderAlt || jid).catch(() => null);
    return canonPromise;
  };

  return {
    sock,
    msg,
    message,
    get quoted() {
      return message?.extendedTextMessage?.contextInfo?.quotedMessage ?? null;
    },
    body,
    jid,
    sender,
    senderAlt,
    identityKey,
    get canonical() {
      return getCanonical();
    },
    isGroup: jid.endsWith('@g.us'),
    pushName: msg.pushName || 'صديقي',
    args,
    get command() {
      return args[0]?.toLowerCase() ?? '';
    },
    reply: (text, extra = {}) => sendText(sock, jid, text, { quoted: msg, ...extra }),
  };
}

async function routeCommand(sock, m, ctx) {
  if (!m.body.startsWith(config.prefix)) return;

  const name = m.command;
  if (!name) return;

  // 🔤 بحث مُطبَّع: الـ loader بيسجّل نسخة مُطبَّعة من كل اسم عربي (بيرجع للـ
  // normalizeArabic)، لكن toLowerCase لوحده مش بيشيل الهمزة/التطويل/الة —
  // يعني ".الأغاني" كانت بتفشل رغم إن "الاغاني" مسجّلة. بنجرّب المفتاح
  // زي ما اتبعت الأول (سلوك قديم محفوظ) وبعدين الصيغة المُطبَّعة كاحتياط.
  const cmd = ctx.commands.get(name) ?? ctx.commands.get(normalizeArabic(name));
  // 🔑 الكولداون بالمفتاح الكانوني — كان بـ m.sender، فنفس الشخص بصيغة LID
  // ورقم تليفون كان بيعدي الكولداون مرتين.
  const identity = m.identityKey ?? m.sender;
  const now = Date.now();

  if (!cmd) {
    // 🤔 اقتراح أقرب أمر لو كتب غلط — بس للكلام المفهوم: أقل من 3 حروف
    // اقتراحها هيطلع عشوائي ويزعّج (مثلاً ".ها" بتقترح أي حاجة قريبة).
    // ولها كولداون برضه عشان الاسم الغلط ميترجعش اقتراح مع كل سبام.
    if (now - (cooldowns.get(`${identity}:__suggestion__`) ?? 0) >= config.cooldown) {
      cooldowns.set(`${identity}:__suggestion__`, now);
      const suggestion = name.length >= 3 ? suggestCommand(name, [...new Set(ctx.commands.keys())]) : null;
      if (suggestion) {
        await m.reply(`🤔 مفيش أمر \`${config.prefix}${name}\` — قصدتك \`${config.prefix}${suggestion}\`؟`);
      }
    }
    return;
  }

  // ⏱️ كولداون لكل مستخدم ضد السبام — المالك معفى، واللي في الكولداون
  // بنقول له صراحة بدل الصمت اللي بيخليه يفتكر البوت بوظ.
  // والأمر نفسه يقدر يظبط كولداون أطول بـ `cooldown` (بالملي ثانية) —
  // مفيد لأوامر الذكاء والتوليد الغالية. اللي مش محدده بياخد العام.
  const cooldownMs = Math.max(0, Number(cmd.cooldown) || config.cooldown);
  const key = `${identity}:${cmd.name}`;
  const left = cooldownMs - (now - (cooldowns.get(key) ?? 0));
  if (left > 0) {
    if (!isOwner(m, config)) notifyCooldown(m, identity, Math.ceil(left / 1000));
    return;
  }
  cooldowns.set(key, now);

  try {
    console.log(`⚡ [Command] تنفيذ أمر: [${cmd.name}] بواسطة: ${m.pushName || 'مستخدم'} (${m.sender?.split('@')[0]})`);
    await cmd.execute(sock, m, m.args.slice(1), {
      ...ctx,
      startTime: botStartTime,
    });
  } catch (err) {
    // ❌ معالجة أخطاء مركزية: اللوج الكامل (بالـ stack) في الكونسول، وللمستخدم
    // رسالة عربية لطيفة من غير تسريب تفاصيل تقنية.
    console.error(`❌ خطأ في الأمر ${cmd.name} (${m.pushName}):`, err);
    recordCommandError(cmd.name);
    await m.reply(friendlyError(err)).catch(() => {});
    return;
  }
  // ⚡ خبرة + 📊 عداد الداشبورد — برّة try الأمر عشان فشل الاقتصاد/الإحصاء
  // ميتحسبش غلط إن الأمر فشل (كان بيوصل للمستخدم "حصل خطأ" بعد ما نجح).
  try {
    bump('commands', `${config.prefix}${cmd.name} — ${m.pushName}`);
    await grantReward(sock, m, cmd);
  } catch (err) {
    console.error(`⚠️ فشل منح مكافأة ${cmd.name} (${m.pushName}):`, err.message ?? err);
  }
}

// ⏳ رد الكولداون — مرة واحدة كل 10 ثواني للشخص الواحد مهما سبّم أوامر،
// عشان نوضح من غير ما نغرق الشات برسايل.
function notifyCooldown(m, identity, secondsLeft) {
  const now = Date.now();
  if (now - (cooldownNotices.get(identity) ?? 0) < COOLDOWN_NOTICE_GAP) return;
  cooldownNotices.set(identity, now);
  m.reply(`⏳ اهدى شوية يا ${m.pushName} 😄 — استنى *${secondsLeft} ثانية* بين كل أمر والأمر`).catch(() => {});
}

// رسالة الخطأ اللي بتوصل للمستخدم: لو الخطأ رسالة عربية قصيرة متعمدة من
// الأمر نفسه ("مفيش رابط فيديو") بنعرضها زي ما هي، ولو تقني بنخفيه.
function friendlyError(err) {
  const raw = String(err?.message ?? err ?? '').trim();
  const intentional =
    raw &&
    raw.length <= 80 &&
    !raw.includes('\n') &&
    /[\u0600-\u06FF]/.test(raw) &&
    !/Error|at\s|code:|ENOENT|ECONN|timeout|JSON|fetch|http|\d{3}/i.test(raw);
  return intentional
    ? `⚠️ ${raw}`
    : '⚠️ حصل خطأ غير متوقع عندنا وإحنا بنصلحه — جرّب تاني بعد شوية 🙏';
}

// ⚡ قيمة الخبرة لكل أمر — مش كلها 2 زي الأول.
// الأوامر الغالية (ذكاء/توليد/تحميل) بتدي أكتر، والحماية بتدي أقل
// عشان محدش يfarm بيالإعدادات.
const XP_VALUES = {
  ai: 6, simsimi: 3, image: 8, video: 10, smart: 6,
  song: 5, yt: 5, tiktok: 4, manga: 4, novel: 4, describe: 5,
  translate: 4, lyrics: 3, pin: 3, gif: 2, sticker: 3,
  rps: 3, xo: 3, quiz: 6, guess: 4, hang: 5, math: 4,
  race: 5, guesswho: 4, td: 3, duel: 8, dailyquest: 5,
  coinflip: 3, color: 4, emoji: 4, mind: 5,
  daily: 4, slot: 2, roll: 2, shop: 2, bank: 2,
  ban: 2, unban: 2, mute: 2, warn: 2, kick: 3, blacklist: 3,
  antilink: 2, antiflood: 2, tagall: 2, promote: 2, demote: 2,
  menu: 1, help: 1, usage: 1, about: 1, how: 1, owner: 1, mystats: 1,
};
const DEFAULT_XP = 2;

async function grantReward(sock, m, cmd) {
  const key = m.identityKey ?? m.sender;
  const xp = XP_VALUES[cmd.name] ?? DEFAULT_XP;
  const levelUp = awardXp(key, xp);
  if (!levelUp) return;

  // 🎉 إعلان الترقية
  const badges = checkBadges(key);
  const bits = [`🎉 *${m.pushName}* ارتقيت لـ *مستوى ${levelUp.to}*!`];
  bits.push(`⚡ شغال: ${xp} XP`);
  for (const b of badges) bits.push(`${b.emoji} وسام جديد: *${b.label}*`);

  await sendText(sock, m.jid, bits.join('\n'), { mentions: [m.sender] }).catch(() => {});
}

// أقرب اسم أمر — مسافة تعديل بسيطة (حروف ناقصة/زيادة/مختلفة)
function suggestCommand(typed, names) {
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  let best = null;
  let bestDist = Infinity;
  for (const n of names) {
    const d = dist(typed, n);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return bestDist <= 2 ? best : null;
}
