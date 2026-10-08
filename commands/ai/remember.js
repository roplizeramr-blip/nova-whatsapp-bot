import { sendQuickReplies, sendText } from '../../core/send.js';
import { rememberMemory } from '../../core/memory.js';

// 🧠 .تذكر — حفظ معلومة أو ذكرى شخصية في عقل استرو مباشرة
export default {
  name: 'تذكر',
  aliases: ['افتكر', 'احفظ', 'اتذكر', 'remember', 'حفظ_ذكرى'],
  description: 'حفظ معلومة أو ذكرى في عقل استرو — .تذكر أنا بحب القهوة السادة',
  usage: '.تذكر <المعلومة اللي عايز استرو يفتكرها>',
  async execute(sock, m, args, ctx) {
    const text = args.join(' ').trim();
    const key = m.identityKey ?? m.sender;

    if (!text || text.length < 3) {
      return sendQuickReplies(sock, m.jid, {
        title: '🧠 حفظ ذكرى جديدة',
        text: 'اكتب معلومة أو ذكرى عايز استرو يحفظها في دماغه وما ينساهاش أبداً!\n\n💡 *أمثلة:*\n• `.فكر أنا بحب القهوة السادة بدون سكر`\n• `.فكر عيد ميلادي يوم 15 مايو`\n• `.فكر شغال مبرمج ويب`',
        buttons: [
          { label: '📋 استعراض ذكرياتي', id: '.ذاكرتي' },
          { label: '🤖 تحدث مع استرو', id: '.ai ازيك يا استرو' },
        ],
      });
    }

    // حفظ الذكرى وتثبيتها حتى لا يمسها النسيان التدريجي
    const added = rememberMemory(key, text, { pinned: true });

    const replyText = added
      ? `🧠 *حفظتها في دماغي يا كبير!* ✨\n\n📌 *المعلومة:* "${text}"\n\nعمري ما هنساها، وهفتكرها في كلامنا دايماً 🤝`
      : `🧠 *المعلومة دي متسجلة عندي بالفعل!* 💡\n\n📌 *المعلومة:* "${text}"\n\nحدّثت وقتها وقوّيتها في الذاكرة يا باشا 🤝`;

    return sendQuickReplies(sock, m.jid, {
      title: '🧠 ذاكرة استرو',
      text: replyText,
      buttons: [
        { label: '📋 شوف ذكرياتك', id: '.ذاكرتي' },
        { label: '➕ احفظ كمان', id: '.فكر ' },
      ],
    });
  },
};
