import { sendQuickReplies } from '../../core/send.js';
import { db } from '../../core/db.js';
import { addCoins } from '../../core/economy.js';
import { normalizeArabic } from '../../core/arabic.js';

// بنك الكلمات المبعثرة مع تلميحاتها الممتعة
const SCRAMBLE_WORDS = [
  { word: 'مصر', hint: 'أم الدنيا وأرض الكنانة 🇪🇬' },
  { word: 'كشري', hint: 'أشهر أكلة شعبية مصرية 🍲' },
  { word: 'أهرامات', hint: 'عجائب الدنيا السبع في الجيزة 🔺' },
  { word: 'فلافل', hint: 'طعمية مقرمشة بالسمسم 🧆' },
  { word: 'ملوخية', hint: 'شوربة خضراء مصرية بالتقلية 🍲' },
  { word: 'إسكندرية', hint: 'عروس البحر الأبيض المتوسط 🏖️' },
  { word: 'حواوشي', hint: 'لحمة متبلة في رغيف بلدي ساخن 🥩' },
  { word: 'بسبوسة', hint: 'حلوى شرقية بالسميد والشربات 🍰' },
  { word: 'كنافة', hint: 'حلوى رمضانية بالقشطة أو المانجو 🍯' },
  { word: 'طاووس', hint: 'طائر يتباهى بريشه الملون الجميل 🦚' },
  { word: 'دلفين', hint: 'كائن بحري ذكي وصديق للإنسان 🐬' },
  { word: 'أخطبوط', hint: 'كائن بحري له ثمانية أذرع وثلاثة قلوب 🐙' },
  { word: 'كمبيوتر', hint: 'جهاز إلكتروني للحوسبة والبرمجة 💻' },
  { word: 'تلفزيون', hint: 'شاشة عرض البرامج والمسلسلات 📺' },
  { word: 'مستشفى', hint: 'مكان لعلاج المرضى وإجراء العمليات 🏥' },
  { word: 'صيدلية', hint: 'مكان بيع الأدوية والعقاقير الطبية 💊' },
  { word: 'طائرة', hint: 'مركبة تحلق في السماء بين الدول ✈️' },
  { word: 'غواصة', hint: 'سفينة حربية تبحر تحت سطح الماء 🌊' },
  { word: 'صاروخ', hint: 'مركبة فضائية تنطلق بسرعة خارقة 🚀' },
  { word: 'ميكروسكوب', hint: 'جهاز لتكبير وفحص الكائنات الدقيقة 🔬' },
  { word: 'تلسكوب', hint: 'منظار فلكي لرصد النجوم والكواكب 🔭' },
  { word: 'قسطنطينية', hint: 'مدينة تاريخية فتحها محمد الفاتح 🕌' },
  { word: 'أندلس', hint: 'حضارة إسلامية تاريخية في إسبانيا 🏰' },
  { word: 'رياضيات', hint: 'علم الأرقام والمعادلات والهندسة 🧮' },
  { word: 'كيمياء', hint: 'علم المادة والتفاعلات والعناصر 🧪' },
  { word: 'فيزياء', hint: 'علم الطبيعة والقوى والحركة ⚡' },
  { word: 'فلسفة', hint: 'حب الحكمة والتفكير العميق 🧠' },
  { word: 'ديناصور', hint: 'كائن عملاق انقرض قبل ملايين السنين 🦖' },
  { word: 'فراشة', hint: 'حشرة رقيقة تطير بأجنحة ملونة 🦋' },
  { word: 'سلطعون', hint: 'كائن بحري بقوقعة ومخالب 🦀' },
];

function shuffleWord(word) {
  const letters = word.split('');
  let shuffled;
  let attempts = 0;
  do {
    shuffled = [...letters].sort(() => Math.random() - 0.5);
    attempts++;
  } while (shuffled.join('') === word && attempts < 10);
  return shuffled.join(' - ');
}

function state() {
  return db.get('scramble', {});
}

export default {
  name: 'scramble',
  aliases: ['ترتيب', 'حروف', 'رتب', 'ترتيب_الحروف', 'فكك_وركب'],
  description: 'لعبة ترتيب الحروف المبعثرة — ركب الكلمة واكسب عملات',
  usage: '.scramble  أو  اكتب الكلمة مباشرة في الشات',
  async execute(sock, m, args) {
    const all = state();
    const game = all[m.jid];
    const meKey = m.identityKey ?? m.sender;
    const rawArg = (args.join(' ') || '').trim();
    const normArg = normalizeArabic(rawArg.toLowerCase());

    // 🛑 استسلام
    if (['giveup', 'استسلم', 'استسلام', 'stop', 'وقف', 'الغاء', 'إلغاء'].includes(normArg)) {
      if (!game) return m.reply('مافيش لعبة ترتيب حروف شغالة هنا! اكتب `.scramble` وابدأ واحدة 🔠');
      delete all[m.jid];
      db.set('scramble', all);
      return sendQuickReplies(sock, m.jid, {
        title: `🏳️ استسلمت! الكلمة كانت: *${game.word}*`,
        text: `تلميحها كان: ${game.hint}\nمعلش، المرة الجاية هترتبها صح! 💪`,
        buttons: [{ label: '🔄 كلمة جديدة', id: '.scramble' }],
      });
    }

    // 🎯 استقبال إجابة
    if (rawArg && game) {
      // فحص انتهاء الوقت (60 ثانية)
      if (Date.now() - game.at > 60000) {
        delete all[m.jid];
        db.set('scramble', all);
        return sendQuickReplies(sock, m.jid, {
          title: `⌛ انتهى الوقت! الكلمة كانت: *${game.word}*`,
          text: 'عايز تتحدى نفسك بكلمة تانية؟ 👇',
          buttons: [{ label: '🔠 كلمة جديدة', id: '.scramble' }],
        });
      }

      const cleanGuess = rawArg.replace(/\s+/g, '');
      const cleanTarget = game.word.replace(/\s+/g, '');

      if (normalizeArabic(cleanGuess) === normalizeArabic(cleanTarget)) {
        // فوز بالإجابة الصحيحة!
        const stats = db.get('scrambleStats', {});
        const me = stats[meKey] ?? { score: 0 };
        me.score++;
        stats[meKey] = me;

        delete all[m.jid];
        db.set('scramble', all);
        db.set('scrambleStats', stats);

        const coins = addCoins(meKey, 25);

        const winMsg = [
          `🎉 *يا بطل يا سريع يا ${m.pushName || 'لعيب'}!* 👏`,
          `رتبت الكلمة الصح: *${game.word}* ✅`,
          `💡 التلميح: ${game.hint}`,
          ``,
          `💰 +25 عملة (رصيدك الإجمالي: ${coins})`,
          `📊 نقاطك في ترتيب الحروف: *${me.score}* نقطة`,
        ].join('\n');

        return sendQuickReplies(sock, m.jid, {
          title: '🎉 إجابة صحيحة وسريعة!',
          text: winMsg,
          buttons: [
            { label: '🔠 كلمة تانية', id: '.scramble' },
            { label: '🎮 ألعاب تانية', id: '.games' },
          ],
        });
      }

      return m.reply(`❌ مش صح! ركز في الحروف المبعثرة وجرب تاني (باقي ثواني في المؤقت ⏱️)`);
    }

    // تذكير بالكلمة الحالية لو سارية
    if (game && Date.now() - game.at <= 60000 && !rawArg.includes('new') && !rawArg.includes('جديد')) {
      const remainingSecs = Math.max(0, Math.ceil((game.at + 60000 - Date.now()) / 1000));
      return m.reply(`🔠 *الحروف المبعثرة:*\n\`${game.scrambled}\`\n💡 التلميح: *${game.hint}*\n⏱️ باقي ${remainingSecs} ثانية!\nاكتب الكلمة مباشرة في الشات.`);
    }

    // كلمة جديدة
    const item = SCRAMBLE_WORDS[Math.floor(Math.random() * SCRAMBLE_WORDS.length)];
    const scrambled = shuffleWord(item.word);

    all[m.jid] = {
      word: item.word,
      hint: item.hint,
      scrambled,
      at: Date.now(),
    };
    db.set('scramble', all);

    const gameMsg = [
      `🔠 *لعبة ترتيب الحروف المبعثرة!* ⏱️`,
      ``,
      `الحروف هي: \`[ ${scrambled} ]\``,
      `💡 التلميح: *${item.hint}*`,
      ``,
      `⏱️ عندك 60 ثانية لترتيب الكلمة!`,
      `اكتب الكلمة مباشرة في الشات بدون أي نقاط أو أوامر 🎯`,
    ].join('\n');

    return sendQuickReplies(sock, m.jid, {
      title: '🔠 رتب الحروف واكسب عملات!',
      text: gameMsg,
      buttons: [
        { label: '🏳️ استسلام', id: '.scramble giveup' },
        { label: '🔠 كلمة تانية', id: '.scramble' },
      ],
    });
  },
};
