import { sendQuickReplies, sendText } from '../../core/send.js';
import { GeminiLiveSession } from '../../core/gemini-live.js';

export default {
  name: 'call',
  aliases: ['اتصال', 'مكالمة', 'رن', 'مكالمة_حية', 'livecall'],
  description: 'بدء مكالمة صوتية حية بالذكاء الاصطناعي مع أسترو (Gemini 3.8 Live) — .call',
  usage: '.call أو .اتصال',
  async execute(sock, m, args) {
    const callUrl = 'https://nova-bot-x3unfm.cranl.net/call';

    const cardText =
      `╭───『 📞 مـكـالـمـة صـوتـيـة حـيـة ⚡ 』───╮\n` +
      `│\n` +
      `│ أهلاً بك يا غالي! جاهز أكلمك صوت مباشر الآن 🎙️\n` +
      `│\n` +
      `│ 🧠 *المحرك الصوتي:* Gemini 3.8 Live Extended Thinking\n` +
      `│ ⚡ *زمن الاستجابة:* أقل من 1.5 ثانية بدون تأخير\n` +
      `│ 🗣️ *اللهجة:* مصري عامي سريع وخفيف الظل\n` +
      `│\n` +
      `│ 🔗 *رابط غرفة المكالمة الصوتية الحية:*\n` +
      `│ ${callUrl}\n` +
      `│\n` +
      `│ 💡 *طريقة الاستخدام:*\n` +
      `│ 1️⃣ افتح الرابط في متصفح هاتفك.\n` +
      `│ 2️⃣ اضغط على زر "📞 بدء المكالمة" واسمح بالمايك.\n` +
      `│ 3️⃣ اتكلم طبيعي مع أسترو كأنك في مكالمة تليفون!\n` +
      `│\n` +
      `│ 🎧 أو رن على البوت في واتساب أو ابعتلي فويس شات وسأرد عليك فويس فوراً!\n` +
      `╰─────────────────────────╯`;

    return sendQuickReplies(sock, m.jid, cardText, [
      { label: '📞 فتح غرفة المكالمة', id: `.call` },
      { label: '🤖 تحدث مع أسترو', id: `.chat ألو يا استرو` },
    ]);
  },
};
