import { speakAs } from '../../core/tts.js';
import { sendQuickReplies } from '../../core/send.js';

// 🎭 .animevoice — كلام بصوت شخصيات مشهورة
export default {
  name: 'animevoice',
  aliases: ['صوتشخصية', 'صوت-انمي'],
  description: 'كلام بصوت شخصيات: غوكو، ميسي، ايمينيم... — .animevoice الشخصية النص',
  usage: '.animevoice غوكو أنا قادم',
  async execute(sock, m, args) {
    const text = args.join(' ').trim();
    if (!text) {
      return sendQuickReplies(sock, m.jid, {
        title: '🎭 أصوات الشخصيات',
        text: 'اكتب: `.animevoice غوكو النص`\n\nالشخصيات المتاحة:\n🐉 غوكو • ⚽ ميسي • 🎤 ايمينيم • 🍜 ناروتو • 🏴‍☠️ لوفي',
        buttons: [
          { label: '🐉 غوكو', id: '.animevoice غوكو أنا سايان جاي من كوكب فيجيتا' },
          { label: '⚽ ميسي', id: '.animevoice ميسي الجول ده باين عليا' },
        ],
      });
    }
    const known = [
      'adam', 'آدم', 'ادم',
      'liam', 'ليام',
      'bella', 'بيلا',
      'antoni', 'أنطوني', 'انطوني',
      'messi', 'ميسي',
      'goku', 'غوكو',
      'eminem', 'ايمينيم', 'إيمينيم',
      'therock', 'ذا_روك', 'روك',
      'snoop', 'سنوب',
      'drake', 'دريك',
      'kanye', 'كانيه',
      'morgan', 'مورغان', 'مورجان',
      'naruto', 'ناروتو',
      'luffy', 'لوفي'
    ];
    const first = text.split(/\s+/)[0].toLowerCase();
    const character = known.find((c) => first.includes(c));
    const content = character ? text.slice(first.length).trim() : text;
    if (!content) return m.reply('اكتب النص بعد الشخصية: `.animevoice messi أنا ميسي` أو `.animevoice adam يا هلا`');
    await speakAs(sock, m.jid, content.slice(0, 450), character ?? 'adam');
  },
};
