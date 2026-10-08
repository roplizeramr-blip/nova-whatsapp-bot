import { sendQuickReplies, sendText } from '../../core/send.js';
import { db } from '../../core/db.js';
import { speak, VOICES } from '../../core/tts.js';

// 🎙️ .voice — تغيير واختيار الصوت الذكي للبوت (ElevenLabs & المشاهير)
export default {
  name: 'voice',
  aliases: ['صوت', 'تغيير_الصوت', 'setvoice', 'الاصوات', 'الأصوات'],
  description: 'اختيار صوت البوت الناطق — .voice <اسم الصوت> أو بدون معطيات لاختيار صوت',
  usage: '.voice antoni | .voice liam | .voice messi',
  async execute(sock, m, args) {
    const rawArg = (args[0] ?? '').trim().toLowerCase();
    const chatVoices = db.get('chatVoice', {});
    const currentVoice = chatVoices[m.jid] ?? 'antoni';

    // لو حدد صوتاً معيناً
    if (rawArg) {
      const selected = VOICES[rawArg] ?? rawArg;
      const validVoices = ['antoni', 'liam', 'bella', 'matilda', 'adam', 'messi', 'goku', 'eminem', 'therock', 'drake'];
      
      if (!validVoices.includes(selected)) {
        return m.reply(
          `⚠️ الصوت غير معروف! الأصوات المتاحة هي:\n` +
          `• antoni (أنطوني - طبيعي وسريع ⚡)\n` +
          `• liam (ليام - هادئ)\n` +
          `• bella (بيلا - أنثوي)\n` +
          `• messi (ميسي ⚽)\n` +
          `• goku (غوكو 💥)\n` +
          `• adam (آدم)\n` +
          `مثال: \`.voice antoni\``
        );
      }

      chatVoices[m.jid] = selected;
      db.set('chatVoice', chatVoices);

      await m.reply(`✅ تم تعيين صوت البوت إلى: *${selected}* بنجاح! جاري إرسال عينة صوتية... 🎙️`);
      return speak(sock, m.jid, `أهلاً بيك يا فنان! ده صوتي الجديد ${selected}، جاهز أكلمك بيه في أي وقت!`, { voice: selected });
    }

    // عرض قائمة الأصوات التفاعلية
    const msg = [
      `🎙️ *اختيار وتغيير صوت البوت الناطق* ⚡`,
      ``,
      `الصوت الحالي في هذه المحادثة: *${currentVoice}*`,
      ``,
      `اختر الصوت المفضل لك من الأزرار بالأسفل، وسيرد البوت عليك به 👇`,
    ].join('\n');

    return sendQuickReplies(sock, m.jid, {
      title: '🎙️ إعدادات الصوت الذكي',
      text: msg,
      buttons: [
        { label: '⚡ أنطوني (طبيعي وسريع)', id: '.voice antoni' },
        { label: '🌟 ليام (شبابي هادئ)', id: '.voice liam' },
        { label: '🌸 بيلا (صوت أنثوي)', id: '.voice bella' },
        { label: '⚽ ميسي (رياضي)', id: '.voice messi' },
        { label: '💥 غوكو (أنمي)', id: '.voice goku' },
        { label: '👑 آدم (كلاسيكي)', id: '.voice adam' },
      ],
    });
  },
};
