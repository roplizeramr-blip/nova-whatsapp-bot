import { speak, CHARACTERS } from '../../core/tts.js';
import { sendQuickReplies } from '../../core/send.js';

// 🎙️ .say — حوّل أي كلام لرسالة صوتية بصوت نوفا
export default {
  name: 'say',
  aliases: ['قول', 'اتكلم'],
  description: 'حوّل كلامك لرسالة صوتية — .say النص',
  usage: '.say أهلا يا معلم',
  async execute(sock, m, args) {
    const text = args.join(' ').trim();
    if (!text) {
      return sendQuickReplies(sock, m.jid, {
        title: '🎙️ مولد الصوت بالذكاء الاصطناعي',
        text: 'حوّل كلامك لرسالة صوتية واقعية بلهجة مصرية وعربية فخمة!\n\n💡 *طريقة الاستخدام:*\n• `.say أهلاً بيك يا غالي` (بصوت استرو المصري الطبيعي)\n• `.animevoice messi هلا مدريد` (بصوت ميسي)\n• أو اطلب في الشات مباشرة: "قول بصوت ميسي..." أو "اتكلم بصوتك..."',
        buttons: [
          { label: '🎙️ تجربة صوت استرو', id: '.say ازيك يا صاحبي عامل ايه كله تمام' },
          { label: '⚽ تجربة صوت ميسي', id: '.animevoice messi أهلاً بيكم يا أساطير الكرة' },
          { label: '🐉 تجربة صوت غوكو', id: '.animevoice goku كامهاميهاااا' },
        ],
      });
    }
    if (text.length > 500) return m.reply('🤐 الكلام طويل أوي — خليه أقصر من 500 حرف');
    await speak(sock, m.jid, text);
  },
};
