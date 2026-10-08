import { sendQuickReplies, sendImage } from '../../core/send.js';
import { chatWithAI, cleanForVoice, isErrorText } from '../../core/ai.js';
import { rememberMessage } from '../../core/memory.js';
import { db } from '../../core/db.js';
import { speak } from '../../core/tts.js';
import api from '../../core/api.js';
import { config } from '../../config.js';

const SUGGESTIONS = [
  { label: '🎧 قولها بصوت', id: '.ai voice' },
];

// 🆔 هوية الموحد: المفتاح الكانوني (الرقم الدولي) زي autoreply بالظبط —
// قبل كده الأمر ده كان بيخزن الذاكرة بـ m.sender (اللي ممكن يكون LID)
// بينما الشات التلقائي بيخزن بالكانوني → نفس الشخص ليه بروفايلين
// و"فاكرك قلتلي" بتفشل بين المسارين.
async function identityOf(m) {
  if (m.canonical) {
    try {
      const canon = await m.canonical;
      if (canon) return canon;
    } catch {}
  }
  return m.identityKey ?? m.sender ?? m.jid;
}

async function stateKey(m) {
  return `${m.jid}::${await identityOf(m)}`;
}

async function getState(m) {
  return db.get('aiState', {})[await stateKey(m)] ?? {};
}

function saveState(key, state) {
  const all = db.get('aiState', {});
  // ⚠️ `by` بيتكتب مرة واحدة — مش بيسحق اللي حد تاني حطه
  all[key] = { ...all[key], ...state, by: state.by ?? all[key]?.by ?? null, at: Date.now() };
  db.set('aiState', all);
}

export default {
  name: 'ai',
  aliases: ['استرو', 'نوفا', 'اسال', 'اسأل', 'اسأل_الذكاء'],
  description: 'اسأل استرو أي حاجة — أو استخدم أزرار المتابعة (كمان/صوت/صورة)',
  usage: '.ai سؤالك  أو  .ai more|voice|image',
  async execute(sock, m, args) {
    const sub = (args[0] ?? '').toLowerCase();
    const state = await getState(m);

    // 🎧 تكرار آخر رد بصوت استرو (غوكو افتراضيًا مع احتياطي فارس)
    if (sub === 'voice') {
      if (!state.lastReply) return m.reply('مفيش رد لسه — اسألني الأول بـ `.ai سؤالك`');
      await m.reply('🎙️ ثواني بتسجّلها...');
      try {
        return await speak(sock, m.jid, cleanForVoice(state.lastReply));
      } catch {
        // الصوت فشل — النص أحسن من مفيش
        return m.reply(`🥴 الصوت مش راضي يتسجل دلوقتي — خد النص:\n${state.lastReply}`);
      }
    }

    // 🖼️ تحويل آخر سؤال لصورة
    if (sub === 'image') {
      if (!state.lastPrompt) return m.reply('مفيش سؤال لسه — اكتب `.image وصف الصورة` على طول');
      await m.reply('🎨 بجهز الصورة... استنى شوية');
      let url = null;
      try {
        url = await api.image(state.lastPrompt);
      } catch {
        return m.reply('🎨 معلش يا صاحبي، خدمة الصور مش متاحة دلوقتي — جرب تاني بعد شوية');
      }
      if (!url) return m.reply('🎨 الصورة معرفتش تتعمل المرة دي — جرب وصف تاني أوضح وأقصر');
      return sendImage(sock, m.jid, url, `🖼️ ${state.lastPrompt}`);
    }

    // 🧠 عرض خطوات التفكير والاستدلال المنطقي لنموذج Atria
    if (sub === 'thought' || sub === 'think' || sub === 'تفكير') {
      if (!state.lastReasoning) return m.reply('🧠 مفيش خطوات تفكير مسجلة للسؤال الأخير.');
      return m.reply(`🧠 *خطوات التفكير والتحليل المنطقي (Atria Dawn Preview):*\n\n${state.lastReasoning}`);
    }

    // 🔄 زوّد كلام عن آخر موضوع
    if (sub === 'more') {
      if (!state.lastPrompt) return m.reply('مفيش موضوع لسه — اسألني الأول بـ `.ai سؤالك`');
      return ask(sock, m, `زوّدني بمعلومات أكتر عن: ${state.lastPrompt}`, state.by);
    }

    // 💬 سؤال جديد
    const question = args.join(' ').trim();
    if (!question) {
      return sendQuickReplies(sock, m.jid, {
        title: '🧠 أنا استرو — اسألني أي حاجة',
        text: 'اكتب سؤالك كده: `.ai إيه أحسن أكل مصري؟`\n\nوفي الخاص تقدر تكلممني من غير أوامر خالص، وأنا فاكر كل حاجة قلتها لي 🫡',
        buttons: [
          { label: '😄 هزر معايا', id: '.simsimi ازيك' },
          { label: '🖼️ صورة بالذكاء', id: '.ai image-help' },
        ],
      });
    }
    if (sub === 'image-help') return m.reply('اكتب: `.image قطة فضائية` — وهعملها بالذكاء الاصطناعي');
    return ask(sock, m, question, await identityOf(m));
  },
};

async function ask(sock, m, question, senderKey) {
  const key = senderKey ?? (await identityOf(m));
  const sKey = await stateKey(m);
  saveState(sKey, { lastPrompt: question, by: key });
  rememberMessage(key, 'user', question);

  let reply = null;
  let reasoning = null;
  try {
    const res = await chatWithAI({
      text: question,
      key,
      pushName: m.pushName,
    });
    reply = res?.reply;
    reasoning = res?.reasoning;
  } catch {
    // "كل المصادر فشلت" وغيرها — رسالة مصرية مفهومة أحسن من stack trace
    return m.reply('🥴 عقلي مشغول شوية والموود فاصل دلوقتي — ابعت سؤالك تاني بعد دقيقة');
  }
  // 🚫 نص خطأ مزوّد عمره ما يوصلك ولا يتخزن في الذاكرة
  if (isErrorText(reply)) {
    return m.reply('🥴 الرد اللي جالي من الشبكة بايظ — اسألني تاني');
  }
  rememberMessage(key, 'bot', reply);
  saveState(sKey, { lastReply: reply, lastReasoning: reasoning });

  const buttons = [];
  if (reasoning && reasoning.trim().length > 10) {
    buttons.push({ label: '🧠 خطوات التفكير', id: '.ai thought' });
  }
  buttons.push({ label: '🎧 قولها بصوت', id: '.ai voice' });

  await sendQuickReplies(sock, m.jid, { text: reply, buttons });
}
