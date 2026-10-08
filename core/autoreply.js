import api from './api.js';
import { dispatchToolAction, executeAgentTool, extractImageUrl } from './tool-caller.js';
import { chatWithAI, cleanForVoice, isErrorText } from './ai.js';
import { TRIGGERS, TRIGGERS_REGEX } from './persona.js';
import {
  rememberMessage,
  learnFromText,
  touchProfile,
  getProfile,
  ensureName,
  absenceHours,
  extractMemory,
  chillTick,
  setTone,
} from './memory.js';
import { sendText, sendQuickReplies, sendVoice } from './send.js';
import { canonicalKey } from './identity.js';
import { imageToUrl, getSettings } from './protection.js';
import { voiceBuffer } from './media.js';
import { transcribeAudio } from './stt.js';
import { speak } from './tts.js';
import { awardXp } from './economy.js';
import { hintFor } from './arabic.js';
import { bump } from './stats.js';
import { db } from './db.js';
import { sleep } from '../lib/utils.js';
import { config } from '../config.js';

// 🧠 محرك الرد الذكي التلقائي:
// - في الخاص: أي رسالة عادية → نوفا يرد
// - في الجروب: منشن للبوت، أو رد على رسالة من البوت، أو كلمة سحرية (نوفا/استرو)
// - بيفتكر الناس بالـ LID، وبيستقبل العائدين بالذكريات، وبيفكر قبل ما يتكلم

const cooldowns = new Map();

function normJid(j) {
  return String(j ?? '').split(':')[0].split('@')[0];
}

function normQ(t) {
  return String(t).trim().toLowerCase().replace(/\s+/g, ' ');
}

function botNumbers(sock) {
  return [sock.user?.id, sock.user?.lid].filter(Boolean).map(normJid);
}

// هل الرسالة موجهة للبوت؟
export function isAddressedToBot(sock, m) {
  const mode = db.get('modes', {})[m.jid] ?? 'normal';

  const ctx = m.message?.extendedTextMessage?.contextInfo;
  const mine = botNumbers(sock);
  const mentioned = ctx?.mentionedJid?.some((j) => mine.includes(normJid(j))) ?? false;
  const repliedToBot = ctx?.participant ? mine.includes(normJid(ctx.participant)) : false;
  const text = m.body?.trim() ?? '';
  const triggered = TRIGGERS_REGEX.test(text);

  // 🤫 الوضع الصامت: حتى في الخاص مايردش غير على المنادى
  if (!m.isGroup) {
    if (mode === 'quiet') return mentioned || repliedToBot || triggered;
    return true;
  }

  // 🗣️ وضع الشات الكامل: الجروب اللي مفعّل فيه — نوفا يرد على كل حاجة
  try {
    if (getSettings(m.jid).aiChatAll && mode !== 'quiet') return true;
  } catch {}

  // 👥 في الجروبات العادية:
  // 1) لو منشن صريح للبوت
  if (mentioned) return true;

  // 2) لو نداء واضح باسم البوت (استرو / نوفا / يا بوت / astro / nova)
  if (triggered) return true;

  // 3) لو رد/اقتباس لرسالة من رسائل البوت — فلترة صارمة لمنع الرد على الضحك والكلمات العابرة
  if (repliedToBot) {
    const isTrivial = /^(?:اه|أه|لا|تمام|اوك|اوكي|ماشي|ماشى|شكرا|شكراً|😂+|🤣+|هههه+|هنج|ضحك|ايوة|ايوه|تسلم|حبيبي|منور|كفو|حلو|جميل|مشكور|ليه|مين|طب|طيب|خلاص|عادي|بس)$/i.test(text);
    if (isTrivial || text.length < 3) return false;
    return true;
  }

  return false;
}

// 💭 ترحيب العائد بعد غياب — يكمّل من نفس النقطة
function welcomeBackExtra(profile, awayHours) {
  const mems = (profile.memories ?? []).slice(-3).map((m) => m.text).join(' • ');
  const away = awayHours < 48 ? 'يوم' : `${Math.round(awayHours / 24)} أيام`;
  return [
    `الشخص ده رجع بعد غياب (${away}) — رحب بيه بحرارة وكأنه راجع من سفر،`,
    mems ? `وافتكر معاه ذكرى من كلامه القديم: "${mems}"،` : '',
    'واسأله عن اللي كان بيتكلم عنه آخر حاجة وكمّل من نفس النقطة.',
  ].filter(Boolean).join(' ');
}

export async function maybeAutoReply(sock, m) {
  if (config.aiChat === false) return;

  // 🎙️ رسالة صوتية → نسمعها بـ Whisper ونرد صوتيًا (محادثة كاملة بدون كتابة)
  let isVoiceInput = false;
  let text = m.body?.trim() ?? '';

  if (m.message?.audioMessage) {
    // الخاص: يسمع تلقائيًا — الجروب: يسمع لو موجه للبوت (رد على رسالته أو منشن أو شات عام)
    if (m.isGroup && !isAddressedToBot(sock, m)) return;
    console.log('🎙️ رسالة صوتية وصلت من:', m.pushName);
    let transcript = '';
    try {
      const buf = await voiceBuffer(m);
      if (!buf) {
        console.error('🎙️ فشل تحميل الصوت من الرسالة');
        return;
      }
      transcript = (await transcribeAudio(buf, { model: 'whisper-large-v3' }).catch((e) => {
        console.error('🎙️ Whisper فشل:', e.message?.slice(0, 80));
        return '';
      })) ?? '';
    } catch {
      await sendText(sock, m.jid, '🥴 حصلت مشكلة في السمع — جرب تاني');
      return;
    }
    console.log('🎙️ Whisper سمع:', JSON.stringify(transcript.slice(0, 80)));

    // 🤷 الكلام مش واضح أو طويل أوي → رد صوتي يطلب التكرار (أفضل من رسالة غامضة)
    const tooShort = !transcript || transcript.length < 4;
    const looksGarbled = /[a-zA-Z]{4,}/.test(transcript) && !/[ء-ي]/.test(transcript.slice(0, 12));
    if (tooShort || looksGarbled) {
      await sendText(sock, m.jid, '🎙️ هسمعك بس الكلام مش واضح عندي');
      await speak(sock, m.jid, 'مفهمتش قصدك، قول تاني بصوت أوضح من فضلك').catch(() => {});
      return;
    }
    text = transcript;
    isVoiceInput = true;
  }

  // 🤷 تفريغ سكتوت: من غير رسالة، المستخدم كلّم وفهمنا سكتوت
  // المستخدم حسي إنه بيبهوش — من غير رسالة واضحة بيبان إن البوت واقف.
  if (!text) return;
  if (text.length > 800) {
    // كلام كتير أوي (أغنية/محاضرة) — ناخد أول 800 حرف ونرد عادي
    text = text.slice(0, 800);
  }

  // 🗣️ في الجروبات: لو الرسالة مش موجهة للبوت → متتدخلش في دردشة الناس خالص!
  if (m.isGroup && !isAddressedToBot(sock, m)) return;
  // 🔗 لينك يوتيوب → أزرار تحميل فورية (من غير أوامر)
  const ytMatch = text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (ytMatch && !isVoiceInput) {
    const link = `https://www.youtube.com/watch?v=${ytMatch[1]}`;
    const caches = db.get('linkCache', {});
    caches[m.jid] = { link, at: Date.now() };
    db.set('linkCache', caches);
    await sendQuickReplies(sock, m.jid, {
      title: '🎬 شفت لينك يوتيوب!',
      text: 'عايز أحملهولك بأي صيغة؟ 👇',
      buttons: [
        { label: '🎧 صوت', id: '.getlink audio' },
        { label: '🎬 360', id: '.getlink 360' },
        { label: '🎬 720', id: '.getlink 720' },
      ],
    });
    return;
  }

  // 🔗 لينكات تيك توك / إنستجرام / فيسبوك — تحميل مباشر بأمر واحد
  if (!isVoiceInput && !m.isGroup) {
    const social = text.match(/https?:\/{2}(?:www\.|vm\.|vt\.)?(?:tiktok\.com|instagram\.com|facebook\.com|fb\.watch)\/[^\s]+/i);
    if (social) {
      const link = social[0];
      const kind = /tiktok/i.test(link) ? 'تك توك' : /instagram/i.test(link) ? 'إنستجرام' : 'فيسبوك';
      await sendQuickReplies(sock, m.jid, {
        title: `📥 شفت لينك ${kind}!`,
        text: 'تحبّيه أحمّلهولك على طول؟ 👇',
        buttons: [
          { label: '📥 حمّله', id: `.tiktok ${link}` },
          { label: '🚫 لأ', id: '.menu' },
        ],
      });
      return;
    }
  }

  // 🆔 المفتاح الكانوني للشخص — صاحبنا دايمًا بمفتاحه الثابت (رقمه الدولي)
  // مهما جت الرسالة بـ LID أو رقم: نفس البروفايل = الذاكرة عمرها ما تتشرذم
  // (قبل الـ cooldown عشان الكولداون يبقى لكل شخص مش لكل صيغة هوية)
  let key = m.identityKey ?? m.sender ?? m.jid;
  try {
    const canon = m.canonical
      ? await m.canonical // متحسب مسبقًا في handler — مرة واحدة لكل رسالة
      : (await canonicalKey(sock, m.sender || m.jid)) ??
        (await canonicalKey(sock, m.senderAlt)) ??
        (await canonicalKey(sock, m.jid));
    if (canon) key = canon;
  } catch {} // لو فشل الحساب لأي سبب نكمّل بالمفتاح القديم — مفيش رسالة تضيع

  // كولداون 5 ثواني لكل شخص (عشان السبام) — بيتشال لو الرسالة اتعاملت
  const now = Date.now();
  if (now - (cooldowns.get(key) ?? 0) < 5000) return;
  cooldowns.set(key, now);

  // 🧠 تحديث الذاكرة: حساب الغياب الأول (قبل تحديث آخر ظهور) + الاسم + التعلم
  const away = absenceHours(getProfile(key));
  const profile = touchProfile(key, m.jid);
  ensureName(key, profile, m.pushName, m.sender, m.senderAlt);
  learnFromText(key, text);
  rememberMessage(key, 'user', text);

  // 😐 لو زهق من الحنية → برود لفترة
  if (/بطل\s*(?:الحنية|حنين|كده|بقا)|اتحسس|متبقاش\s*حنون/.test(text)) {
    setTone(key, 'chill');
  }

  // 💭 ترحيب العائد بعد غياب
  const isReturnee = away > 24 && (profile.memories?.length || profile.name);

  // ⌨️ مؤشر الكتابة — إحساس بشري سريع
  try { await sock.sendPresenceUpdate('composing', m.jid); } catch {}
  await sleep(150);

  const wantsVoice = /(?:اتكلم|بصوت|صوتك|قولها|انطق)/i.test(text);
  const isLaughing = /ه{3,}|😂{2,}|🤣{2,}/.test(text);
  const hasImage = !!m.message?.imageMessage;

  const awayExtra = isReturnee ? welcomeBackExtra(profile, away) : '';

  // 🛠️ فحص وتنفيذ الأدوات الذكية التفاعلية فوراً بدون أي تأخير (تعديل صور، فيديو، رسم، صوت، تفريغ...)
  const handled = await dispatchToolAction(sock, m, text, profile);
  if (handled) {
    bump('commands');
    bump('aiReplies');
    awardXp(key, 5);
    rememberMessage(key, 'bot', `[أداة منفذة: ${text.slice(0, 40)}]`);
    chillTick(key);
    return;
  }

  // 🗣️ لو في جروب ومفيش منشن أو نداء للبوت ولا أداة مطلوبة → متتدخلش في دردشة الناس
  if (!isAddressedToBot(sock, m)) return;

  // 👁️ رؤية وفهم الصور للمحادثة العامة: صورة مرفقة أو مقتبسة في الخاص أو الجروبات
  let visionHint = '';
  try {
    const imgUrl = await extractImageUrl(m);
    if (imgUrl) {
      const desc = await api.img2prompt(imgUrl).catch(() => null);
      if (desc?.arabic) {
        visionHint = `المستخدم بعت لك صورة (أو اقتبس صورة)، وده وصفها بالذكاء الاصطناعي: "${desc.arabic.slice(0, 300)}". وكلامه مع الصورة: "${text}". جاوبه على سؤاله أو تفاعل مع الصورة بذكاء وبالمصري.`;
      }
    }
  } catch {}
  const extra = [awayExtra, visionHint].filter(Boolean).join(' ');

  // ⚡ كاش الردود المتشابهة — نفس السؤال في 10 دقايق = رد فوري (بدون صور)
  if (!hasImage && !wantsVoice && !isReturnee) {
    const caches = db.get('replyCache', {});
    const hit = caches[m.jid]?.[normQ(text)];
    if (hit && Date.now() - hit.at < 600000) {
      if (hit.reply.length > 300) {
        await sendQuickReplies(sock, m.jid, {
          text: hit.reply,
          buttons: [{ label: '🎧 استمع بصوت', id: '.ai voice' }],
        });
      } else {
        await sendText(sock, m.jid, hit.reply);
      }
      return;
    }
  }

  let reply = null;
  let reasoning = null;
  let agentTools = [];
  try {
    const res = await chatWithAI({
      text,
      key,
      sender: m.sender,
      senderAlt: m.senderAlt,
      pushName: m.pushName,
      voice: Boolean(wantsVoice || isVoiceInput),
      extra,
      mode: db.get('modes', {})[m.jid] ?? 'normal',
    });
    reply = typeof res === 'string' ? res : (res?.reply ?? null);
    reasoning = res?.reasoning ?? null;
    agentTools = res?.tools ?? [];
    bump('aiReplies');
    awardXp(key, 3);
  } catch (err) {
    console.warn('⚠️ تعذر نداء chatWithAI:', err?.message);
    try {
      reply = await api.simsimi(text);
    } catch {
      reply = null;
    }
  }

  // 🛠️ تنفيذ أداة الإيجنت الذكية لو طلبها Atria Dawn Preview
  if (agentTools.length > 0) {
    try {
      const executed = await executeAgentTool(sock, m, agentTools[0], profile);
      if (executed) {
        bump('commands');
        awardXp(key, 5);
        rememberMessage(key, 'bot', `[إيجنت Atria نفذ: ${agentTools[0].name}]`);
        if (reply && reply.length > 10 && !reply.startsWith('[TOOL:')) {
          await sendText(sock, m.jid, reply);
        }
        chillTick(key);
        return;
      }
    } catch (e) {
      console.error('⚠️ خطأ في تنفيذ أداة الإيجنت:', e.message);
    }
  }

  if (!reply) {
    reply = 'يا هلا بيك يا صاحبي! سامعك يا غالي، اتفضل أؤمرني وسامعك بكل وضوح 😄';
  }
  // 🚫 لو الرد نص خطأ من المزوّد — متخزنش في الذاكرة
  if (isErrorText(reply)) {
    reply = 'يا لهوي! السيرفر شكله بيهيس شوية دلوقتي، ثواني وهفوقلك يا صاحبي 😅';
  }
  rememberMessage(key, 'bot', reply);

  // 💾 خزّن في كاش الردود (لغير الصور والصوت)
  if (!hasImage && !wantsVoice) {
    const caches = db.get('replyCache', {});
    const forChat = caches[m.jid] ?? {};
    forChat[normQ(text)] = { reply, at: Date.now() };
    const entries = Object.entries(forChat);
    if (entries.length > 30) {
      entries.sort((a, b) => a[1].at - b[1].at);
      for (const [k] of entries.slice(0, entries.length - 30)) delete forChat[k];
    }
    caches[m.jid] = forChat;
    db.set('replyCache', caches);
  }

  // حفظ آخر سؤال ورد لزرار المتابعة مع خطوات التفكير
  const states = db.get('aiState', {});
  const aiKey = `${m.jid}::${key}`;
  states[aiKey] = { lastPrompt: text, lastReply: reply, lastReasoning: reasoning, by: key, at: now };
  // 🧹 تشذيب — نحتفظ بآخر 50 حالة بس
  const stateKeys = Object.keys(states);
  if (stateKeys.length > 50) {
    stateKeys
      .sort((a, b) => (states[a]?.at ?? 0) - (states[b]?.at ?? 0))
      .slice(0, stateKeys.length - 50)
      .forEach((k) => delete states[k]);
  }
  db.set('aiState', states);

  // 😂 ايموشن: رياكشن ضحك لو هو ضحك
  if (isLaughing) {
    sock.sendMessage(m.jid, { react: { text: '😂', key: m.msg.key } }).catch(() => {});
  }

  if (wantsVoice || isVoiceInput) {
    try {
      await speak(sock, m.jid, cleanForVoice(reply));
      chillTick(key);
      return;
    } catch {
      // فشل الصوت → نص عادي بدون أزرار مزعجة
      await sendText(sock, m.jid, reply);
      return;
    }
  }

  // 💡 أزرار الإجراءات الحيوية: خطوات التفكير + الإجراءات المقترحة
  const hint = hintFor(text);
  const buttons = [];
  if (reasoning && reasoning.trim().length > 10) {
    buttons.push({ label: '🧠 خطوات التفكير', id: '.ai thought' });
  }
  if (hint) {
    buttons.push({ label: `⚡ ${config.prefix}${hint}`, id: `${config.prefix}${hint}` });
  } else if (reply.length > 350) {
    buttons.push({ label: '🎧 استمع بصوت', id: '.ai voice' });
  }

  if (buttons.length > 0) {
    await sendQuickReplies(sock, m.jid, { text: reply, buttons });
  } else {
    await sendText(sock, m.jid, reply);
  }

  // 😐 لو مود هادي → عديّ رسالة من فترة التبريد
  chillTick(key);

  // 💭 استخراج ذكرى كل 8 رسايل — في الخلفية من غير ما يأخر الرد
  const fresh = db.get('users', {})[key];
  if ((fresh?.msgCount ?? 0) % 8 === 0) {
    extractMemory(key).catch(() => {});
  }
}
