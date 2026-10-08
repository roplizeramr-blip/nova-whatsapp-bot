import { sendQuickReplies } from '../../core/send.js';
import { db } from '../../core/db.js';
import { addCoins } from '../../core/economy.js';
import { normalizeArabic } from '../../core/arabic.js';

// بنك أعلام الدول مع تلميحات العواصم والقارات
const FLAGS_DATA = [
  { flag: '🇪🇬', country: 'مصر', continent: 'إفريقيا', capital: 'القاهرة' },
  { flag: '🇸🇦', country: 'السعودية', continent: 'آسيا', capital: 'الرياض' },
  { flag: '🇵🇸', country: 'فلسطين', continent: 'آسيا', capital: 'القدس' },
  { flag: '🇯🇵', country: 'اليابان', continent: 'آسيا', capital: 'طوكيو' },
  { flag: '🇧🇷', country: 'البرازيل', continent: 'أمريكا الجنوبية', capital: 'برازيليا' },
  { flag: '🇫🇷', country: 'فرنسا', continent: 'أوروبا', capital: 'باريس' },
  { flag: '🇩🇪', country: 'ألمانيا', continent: 'أوروبا', capital: 'برلين' },
  { flag: '🇲🇦', country: 'المغرب', continent: 'إفريقيا', capital: 'الرباط' },
  { flag: '🇦🇷', country: 'الأرجنتين', continent: 'أمريكا الجنوبية', capital: 'بوينس آيرس' },
  { flag: '🇦🇺', country: 'أستراليا', continent: 'أوقيانوسيا', capital: 'كانبرا' },
  { flag: '🇨🇦', country: 'كندا', continent: 'أمريكا الشمالية', capital: 'أوتاوا' },
  { flag: '🇬🇧', country: 'بريطانيا', continent: 'أوروبا', capital: 'لندن' },
  { flag: '🇮🇹', country: 'إيطاليا', continent: 'أوروبا', capital: 'روما' },
  { flag: '🇪🇸', country: 'إسبانيا', continent: 'أوروبا', capital: 'مدريد' },
  { flag: '🇹🇷', country: 'تركيا', continent: 'آسيا / أوروبا', capital: 'أنقرة' },
  { flag: '🇰🇷', country: 'كوريا الجنوبية', continent: 'آسيا', capital: 'سيول' },
  { flag: '🇨🇳', country: 'الصين', continent: 'آسيا', capital: 'بكين' },
  { flag: '🇮🇳', country: 'الهند', continent: 'آسيا', capital: 'نيودلهي' },
  { flag: '🇷🇺', country: 'روسيا', continent: 'أوروبا / آسيا', capital: 'موسكو' },
  { flag: '🇲🇽', country: 'المكسيك', continent: 'أمريكا الشمالية', capital: 'مكسيكو سيتي' },
  { flag: '🇦🇪', country: 'الإمارات', continent: 'آسيا', capital: 'أبو ظبي' },
  { flag: '🇶🇦', country: 'قطر', continent: 'آسيا', capital: 'الدوحة' },
  { flag: '🇰🇼', country: 'الكويت', continent: 'آسيا', capital: 'مدينة الكويت' },
  { flag: '🇩🇿', country: 'الجزائر', continent: 'إفريقيا', capital: 'الجزائر' },
  { flag: '🇹🇳', country: 'تونس', continent: 'إفريقيا', capital: 'تونس' },
  { flag: '🇮🇶', country: 'العراق', continent: 'آسيا', capital: 'بغداد' },
  { flag: '🇸🇾', country: 'سوريا', continent: 'آسيا', capital: 'دمشق' },
  { flag: '🇱🇧', country: 'لبنان', continent: 'آسيا', capital: 'بيروت' },
  { flag: '🇯🇴', country: 'الأردن', continent: 'آسيا', capital: 'عمان' },
  { flag: '🇴🇲', country: 'عمان', continent: 'آسيا', capital: 'مسقط' },
  { flag: '🇸🇩', country: 'السودان', continent: 'إفريقيا', capital: 'الخرطوم' },
  { flag: '🇾🇪', country: 'اليمن', continent: 'آسيا', capital: 'صنعاء' },
  { flag: '🇳🇱', country: 'هولندا', continent: 'أوروبا', capital: 'أمستردام' },
  { flag: '🇵🇹', country: 'البرتغال', continent: 'أوروبا', capital: 'لشبونة' },
  { flag: '🇸🇪', country: 'السويد', continent: 'أوروبا', capital: 'ستوكهولم' },
  { flag: '🇨🇭', country: 'سويسرا', continent: 'أوروبا', capital: 'بيرن' },
  { flag: '🇬🇷', country: 'اليونان', continent: 'أوروبا', capital: 'أثينا' },
  { flag: '🇿🇦', country: 'جنوب إفريقيا', continent: 'إفريقيا', capital: 'بريتوريا' },
  { flag: '🇳🇬', country: 'نيجيريا', continent: 'إفريقيا', capital: 'أبوجا' },
];

function state() {
  return db.get('flags', {});
}

export default {
  name: 'flags',
  aliases: ['اعلام', 'علم', 'خمن_العلم', 'الاعلام', 'دولة'],
  description: 'لعبة خمن علم الدولة — تعرف على علم الدولة واكسب عملات',
  usage: '.flags  أو  اكتب اسم الدولة مباشرة في الشات',
  async execute(sock, m, args) {
    const all = state();
    const game = all[m.jid];
    const meKey = m.identityKey ?? m.sender;
    const rawArg = (args.join(' ') || '').trim();
    const normArg = normalizeArabic(rawArg.toLowerCase());

    // 💡 طلب تلميح
    if (['hint', 'تلميح'].includes(normArg)) {
      if (!game) return m.reply('مافيش لعبة شغالة عشان تاخد تلميح! اكتب `.flags` وابدأ 🚩');
      return m.reply(`💡 *تلميح جغرافي:* الدولة تقع في قارة *${game.continent}* وعاصمتها هي *${game.capital}*!`);
    }

    // 🛑 استسلام
    if (['giveup', 'استسلم', 'استسلام', 'stop', 'وقف', 'الغاء', 'إلغاء'].includes(normArg)) {
      if (!game) return m.reply('مافيش لعبة أعلام شغالة دلوقتي! اكتب `.flags` وابدأ واحدة 🚩');
      delete all[m.jid];
      db.set('flags', all);
      return sendQuickReplies(sock, m.jid, {
        title: `🏳️ استسلمت! الدولة كانت: *${game.country}* ${game.flag}`,
        text: `عاصمتها: ${game.capital} • قارتها: ${game.continent}\nمعلش، المرة الجاية هتعرفها! 💪`,
        buttons: [{ label: '🔄 علم جديد', id: '.flags' }],
      });
    }

    // 🎯 استقبال إجابة (اسم الدولة)
    if (rawArg && game) {
      if (Date.now() - game.at > 60000) {
        delete all[m.jid];
        db.set('flags', all);
        return sendQuickReplies(sock, m.jid, {
          title: `⌛ انتهى الوقت! الدولة كانت: *${game.country}* ${game.flag}`,
          text: 'عايز تتحدى نفسك بعلم جديد؟ 👇',
          buttons: [{ label: '🚩 علم جديد', id: '.flags' }],
        });
      }

      const cleanGuess = rawArg.replace(/\s+/g, '');
      const cleanTarget = game.country.replace(/\s+/g, '');

      if (normalizeArabic(cleanGuess) === normalizeArabic(cleanTarget) || normArg.includes(normalizeArabic(game.country))) {
        // إجابة صحيحة!
        const stats = db.get('flagsStats', {});
        const me = stats[meKey] ?? { score: 0 };
        me.score++;
        stats[meKey] = me;

        delete all[m.jid];
        db.set('flags', all);
        db.set('flagsStats', stats);

        const coins = addCoins(meKey, 25);

        const winMsg = [
          `🎉 *يا بطل الجغرافيا يا ${m.pushName || 'لعيب'}!* 👏`,
          `العلم هو: *${game.flag} ${game.country}* ✅`,
          `🏛️ العاصمة: ${game.capital} • 🌍 القارة: ${game.continent}`,
          ``,
          `💰 +25 عملة (رصيدك الإجمالي: ${coins})`,
          `📊 نقاطك في تحدي الأعلام: *${me.score}* نقطة`,
        ].join('\n');

        return sendQuickReplies(sock, m.jid, {
          title: '🎉 إجابة صحيحة في تحدي الأعلام!',
          text: winMsg,
          buttons: [
            { label: '🚩 علم تاني', id: '.flags' },
            { label: '🎮 ألعاب تانية', id: '.games' },
          ],
        });
      }

      return m.reply(`❌ مش صح! ركز في ألوان ورمز العلم وجرب تاني (أو اكتب "تلميح" 💡)`);
    }

    // تذكير بالعلم الحالي
    if (game && Date.now() - game.at <= 60000 && !rawArg.includes('new') && !rawArg.includes('جديد')) {
      const remainingSecs = Math.max(0, Math.ceil((game.at + 60000 - Date.now()) / 1000));
      return m.reply(`🚩 *العلم المطلوب:*\n${game.flag} ${game.flag} ${game.flag}\n⏱️ باقي ${remainingSecs} ثانية!\nاكتب اسم الدولة مباشرة في الشات.`);
    }

    // علم جديد
    const item = FLAGS_DATA[Math.floor(Math.random() * FLAGS_DATA.length)];
    all[m.jid] = {
      flag: item.flag,
      country: item.country,
      continent: item.continent,
      capital: item.capital,
      at: Date.now(),
    };
    db.set('flags', all);

    const gameMsg = [
      `🚩 *لعبة خمن علم الدولة!* 🌍`,
      ``,
      `العلم هو:   *${item.flag}  ${item.flag}  ${item.flag}*`,
      ``,
      `⏱️ عندك 60 ثانية لمعرفة اسم الدولة!`,
      `اكتب اسم الدولة مباشرة في الشات (أو اكتب "تلميح" لو مش عارفها) 🎯`,
    ].join('\n');

    return sendQuickReplies(sock, m.jid, {
      title: '🚩 علم دولة جديد!',
      text: gameMsg,
      buttons: [
        { label: '💡 تلميح', id: '.flags hint' },
        { label: '🏳️ استسلام', id: '.flags giveup' },
      ],
    });
  },
};
