import { sendQuickReplies, sendText } from '../../core/send.js';
import { db } from '../../core/db.js';
import { grantWin, grantLoss, addCoins } from '../../core/economy.js';
import { normalizeArabic } from '../../core/arabic.js';

// 🔤 بنك الكلمات المخفية وتلميحاتها الممتعة
const WORDS = [
  // 🇪🇬 معالم وأكلات مصرية
  { w: 'مصر', h: 'بلد الأهرامات وأم الدنيا 🇪🇬' },
  { w: 'كشري', h: 'أكلة شعبية مصرية أسطورية بمكرونة وعدس وصلصة 🍲' },
  { w: 'طعمية', h: 'فلافل مصرية مقرمشة بالسمسم والكرات 🧆' },
  { w: 'حواوشي', h: 'عيش بلدي ولحمة وتوابل في الفرن 🥩' },
  { w: 'ملوخية', h: 'شوربة خضراء مصرية بالتقلية والأرانب 🍲' },
  { w: 'كباب', h: 'لحمة مشوية على الفحم والسيخ 🍢' },
  { w: 'كنافة', h: 'حلوى شرقية بالجبنة أو القشطة في رمضان 🍯' },
  { w: 'بسبوسة', h: 'حلوى سميد مع الشربات والمكسرات 🍰' },
  { w: 'هرم', h: 'أعجوبة معمارية خالدة في الجيزة 🔺' },
  { w: 'نيل', h: 'أطول نهر في العالم وشريان الحياة لمصر 🌊' },
  { w: 'قلعة', h: 'حصن صلاح الدين الأيوبي في المقطم 🏰' },
  { w: 'أقصر', h: 'مدينة مصرية تضم ثلث آثار العالم 🏛️' },
  { w: 'أسوان', h: 'بلاد النوبة والسد العالي وجمال الجنوب ⛵' },
  { w: 'إسكندرية', h: 'عروس البحر الأبيض المتوسط ومكتبتها الشهيرة 🏖️' },
  { w: 'شيشة', h: 'معسل وفحم في قعدة القهوة البلدي 💨' },
  { w: 'قهوة', h: 'مشروب الصباح والمزاج المفضل ☕' },
  { w: 'شاي', h: 'مشروب الشعب بالنعناع في الخمسينة 🫖' },

  // 🌍 أشياء وحياة يومية
  { w: 'شمس', h: 'نجم النهار ومصدر الضوء والدفء ☀️' },
  { w: 'قمر', h: 'ينير عتمة الليل بأطواره 🌙' },
  { w: 'بحر', h: 'مياه مالحة وأمواج وشواطئ 🏖️' },
  { w: 'جبل', h: 'تضاريس شاهقة وصخور صلبة 🏔️' },
  { w: 'سماء', h: 'فضاء أزرق تسبح فيه الغيوم والنجوم 🌌' },
  { w: 'سحاب', h: 'غيوم محملة بقطرات المطر 🌧️' },
  { w: 'مطر', h: 'ماء ينزل من السماء بركة ورحمة 🌧️' },
  { w: 'شجرة', h: 'جذور وأغصان وظل وثمار 🌳' },
  { w: 'وردة', h: 'عطر وألوان زاهية وجمال طبيعي 🌹' },
  { w: 'كتاب', h: 'خير جليس في الزمان وخزانة المعرفة 📖' },
  { w: 'قلم', h: 'أداة الكتابة وتدوين الأفكار ✍️' },
  { w: 'ساعة', h: 'عقارب تدور لتنظيم الوقت ⏰' },
  { w: 'مفتاح', h: 'يفتح الأبواب والأقفال المغلقة 🔑' },
  { w: 'مرآة', h: 'تعكس صورتك وملامحك بكل دقة 🪞' },
  { w: 'كاميرا', h: 'تلتقط الصور وتوثق الذكريات 📸' },

  // 🚗 تكنولوجيا ووسائل نقل
  { w: 'سيارة', h: 'مركبة بأربع عجلات ومحرك للتنقل 🚗' },
  { w: 'طيارة', h: 'تحلق بين السحاب وتنقل المسافرين عبر القارات ✈️' },
  { w: 'قطار', h: 'وسيلة نقل سريعة على القضبان الحديدية 🚆' },
  { w: 'سفينة', h: 'تبحر في أعماق البحار والمحيطات 🚢' },
  { w: 'صاروخ', h: 'ينطلق بقوة هائلة نحو الفضاء الخارجي 🚀' },
  { w: 'موبايل', h: 'هاتف ذكي لا يفارق جيبك ويدك 📱' },
  { w: 'كمبيوتر', h: 'جهاز المعالجة والإنترنت والبرمجة 💻' },
  { w: 'تلفزيون', h: 'شاشة تعرض الأفلام والمسلسلات والأخبار 📺' },

  // 🦁 حيوانات وطيور
  { w: 'أسد', h: 'ملك الغابة وصاحب الزئير المرعب 🦁' },
  { w: 'نمر', h: 'حيوان مفترس مخطط وسريع 🐅' },
  { w: 'فهد', h: 'أسرع حيوان بري على الأرض 🐆' },
  { w: 'صقر', h: 'طائر جارح حاد البصر وعالي التحليق 🦅' },
  { w: 'حصان', h: 'رمز الأصالة والفروسية والسرعة 🐎' },
  { w: 'جمل', h: 'سفينة الصحراء ويتحمل العطش لأيام 🐫' },
  { w: 'دلفين', h: 'صديق الإنسان الذكي في مياه البحر 🐬' },
  { w: 'فيل', h: 'أضخم حيوان يعيش على اليابسة بخرطوم طويل 🐘' },

  // ⚽ رياضة وترفيه
  { w: 'كورة', h: 'المعشوقة المستديرة والرياضة الأولى في العالم ⚽' },
  { w: 'ملعب', h: 'ساحة التنافس الرياضي بين الفرق 🏟️' },
  { w: 'جول', h: 'هدف يهز الشباك ويسعد الجماهير 🥅' },
  { w: 'حكم', h: 'قاضي المباراة بصافرته وبطاقاته 🟨' },
  { w: 'مدرب', h: 'يضع الخطة والتكتيك ويوجه اللاعبين 📋' },
  { w: 'بطولة', h: 'كأس يتنافس عليه الجميع للتتويج 🏆' },
];

// مراحل المشنقة الستة بالرسم الدقيق
const GALLOWS = [
  // 0 أخطاء
  `  ┌───┐\n  │   \n  │   \n  │   \n ═╧═`,
  // خطأ 1: الرأس
  `  ┌───┐\n  │   🙂\n  │   \n  │   \n ═╧═`,
  // خطأ 2: الجذع
  `  ┌───┐\n  │   🙂\n  │   │\n  │   \n ═╧═`,
  // خطأ 3: يد واحدة
  `  ┌───┐\n  │   😟\n  │  /│\n  │   \n ═╧═`,
  // خطأ 4: اليدين
  `  ┌───┐\n  │   😣\n  │  /│\\\n  │   \n ═╧═`,
  // خطأ 5: رجل واحدة
  `  ┌───┐\n  │   😫\n  │  /│\\\n  │  / \n ═╧═`,
  // خطأ 6: المشنقة اكتملت
  `  ┌───┐\n  │   💀\n  │  /│\\\n  │  / \\\n ═╧═`,
];

const ARABIC_LETTERS = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوىيءأإؤئةى';

function games() {
  return db.get('hang', {});
}

function cleanNormChar(c) {
  if (['أ', 'إ', 'آ'].includes(c)) return 'ا';
  if (['ة', 'ه'].includes(c)) return 'ه';
  if (['ى', 'ي'].includes(c)) return 'ي';
  return c;
}

function mask(word, guessed) {
  const normGuessed = guessed.map(cleanNormChar);
  return word.split('').map((ch) => {
    if (ch === ' ') return '  ';
    const normCh = cleanNormChar(ch);
    return normGuessed.includes(normCh) ? ch : '_';
  }).join(' ');
}

function render(game) {
  const errCount = Math.min(game.wrong.length, 6);
  const visualGallows = GALLOWS[errCount];

  return [
    `🔤 *لعبة المشنقة والكلمة المخفية*`,
    `\`\`\`\n${visualGallows}\n\`\`\``,
    `🔤 الكلمة: \`${mask(game.word, game.guessed)}\``,
    `💡 التلميح: *${game.hint}*`,
    `❌ أخطاء (${game.wrong.length}/6): ${game.wrong.join(' ') || 'لا يوجد'}`,
    `✅ أحرف صحيحة: ${game.guessed.join(' ') || 'لا يوجد'}`,
  ].join('\n');
}

function pickWord() {
  const entry = WORDS[Math.floor(Math.random() * WORDS.length)];
  return { w: entry.w, h: entry.h };
}

export default {
  name: 'hang',
  aliases: ['كلمة', 'كلمة_مخفية', 'شنقة', 'المشنقة', 'حبل'],
  description: 'لعبة الكلمة المخفية والمشنقة (Hangman) — خمن الحروف أو الكلمة كاملة مباشرة',
  usage: '.hang  أو  اكتب الحرف مباشرة (مثل: م)',
  async execute(sock, m, args) {
    const all = games();
    const me = m.identityKey ?? m.sender;
    const rawArg = (args[0] ?? '').trim();
    const normArg = normalizeArabic(rawArg.toLowerCase());

    // 🛑 استسلام أو إيقاف اللعبة
    if (['giveup', 'استسلم', 'استسلام', 'stop', 'وقف', 'الغاء', 'إلغاء'].includes(normArg)) {
      const active = all[m.jid];
      if (!active) return m.reply('مافيش لعبة كلمة مخفية شغالة دلوقتي! اكتب `.hang` وابدأ واحدة 🎯');
      delete all[m.jid];
      db.set('hang', all);
      return sendQuickReplies(sock, m.jid, {
        title: `🏳️ استسلمت! الكلمة كانت: *${active.word}*`,
        text: `تلميحها كان: ${active.hint}\nمعلش، المرة الجاية هتكسبها بإذن الله 💪`,
        buttons: [{ label: '🔄 كلمة جديدة', id: '.hang new' }],
      });
    }

    // 🎮 بدء كلمة جديدة
    if (!all[m.jid] || ['new', 'جديد', 'ابدأ'].includes(normArg)) {
      const { w, h } = pickWord();
      all[m.jid] = {
        word: w,
        hint: h,
        guessed: [],
        wrong: [],
        by: me,
        at: Date.now(),
      };
      db.set('hang', all);

      const intro = [
        render(all[m.jid]),
        ``,
        `💡 *طريقة اللعب:*`,
        `اكتب أي *حرف عربي* مباشرة في الشات (مثال: \`م\` أو \`ك\`)!`,
        `لو عرفت الكلمة كاملة، اكتبها مباشرة وهتكسب بونص مضاعف! 🏆`,
      ].join('\n');

      return sendQuickReplies(sock, m.jid, {
        title: '🔤 بدأت لعبة الكلمة المخفية!',
        text: intro,
        buttons: [
          { label: '🔄 كلمة تانية', id: '.hang new' },
          { label: '🏳️ استسلام', id: '.hang giveup' },
        ],
      });
    }

    const game = all[m.jid];

    // إذا لم يرسل حرفاً أو تخميناً، اعرض اللوحة الحالية
    if (!rawArg) {
      return sendQuickReplies(sock, m.jid, {
        title: '🔤 لعبة الكلمة المخفية مستمرة',
        text: render(game) + '\n\nاكتب حرفاً في الشات، أو خمّن الكلمة كاملة 👇',
        buttons: [
          { label: '🔄 كلمة جديدة', id: '.hang new' },
          { label: '🏳️ استسلام', id: '.hang giveup' },
        ],
      });
    }

    // 🎯 1) فحص تخمين الكلمة كاملة مباشرة!
    const cleanRaw = rawArg.replace(/\s+/g, '');
    const cleanWord = game.word.replace(/\s+/g, '');
    if (cleanRaw.length >= 2 && normalizeArabic(cleanRaw) === normalizeArabic(cleanWord)) {
      // فوز فوري بتخمين الكلمة كاملة!
      const stats = db.get('hangStats', {});
      const st = stats[me] ?? { win: 0, lose: 0, score: 0 };
      st.win++;
      st.score += 50;
      stats[me] = st;

      delete all[m.jid];
      db.set('hang', all);
      db.set('hangStats', stats);

      const coins = grantWin(me, 50);

      const winText = [
        `🎉 *عبقري وأسطورة يا ${m.pushName || 'بطل'}!* 🏆`,
        `خمنت الكلمة كاملة ببراعة: *${game.word}* ✅`,
        `💡 التلميح: ${game.hint}`,
        ``,
        `💰 +50 عملة بونص الذكاء الخارق (رصيدك: ${coins})`,
        `📊 انتصاراتك في المشنقة: *${st.win}* فوز`,
      ].join('\n');

      return sendQuickReplies(sock, m.jid, {
        title: '🎉 فوز خارق في الكلمة المخفية!',
        text: winText,
        buttons: [
          { label: '🔄 العب كلمة تانية', id: '.hang new' },
          { label: '🎮 ألعاب تانية', id: '.games' },
        ],
      });
    }

    // 🎯 2) فحص تخمين حرف واحد
    const char = rawArg[0];
    if (!ARABIC_LETTERS.includes(char)) {
      return m.reply('اكتب حرف عربي صالح، أو خمن الكلمة كاملة مباشرة 💡');
    }

    const normChar = cleanNormChar(char);
    const alreadyGuessed = game.guessed.some((c) => cleanNormChar(c) === normChar);
    const alreadyWrong = game.wrong.some((c) => cleanNormChar(c) === normChar);

    if (alreadyGuessed || alreadyWrong) {
      return m.reply(`الحرف "${char}" جربته قبل كده خلاص 😅! اختار حرف تاني.`);
    }

    // التحقق من وجود الحرف في الكلمة
    const wordNormChars = game.word.split('').map(cleanNormChar);
    const isHit = wordNormChars.includes(normChar);

    if (isHit) {
      game.guessed.push(char);
    } else {
      game.wrong.push(char);
    }
    game.at = Date.now();

    // فحص الفوز بالحروف (كل أحرف الكلمة تم تخمينها)
    const normGuessedAll = game.guessed.map(cleanNormChar);
    const allRevealed = game.word.split('').every((c) => c === ' ' || normGuessedAll.includes(cleanNormChar(c)));

    if (allRevealed) {
      const stats = db.get('hangStats', {});
      const st = stats[me] ?? { win: 0, lose: 0, score: 0 };
      st.win++;
      st.score += 35;
      stats[me] = st;

      delete all[m.jid];
      db.set('hang', all);
      db.set('hangStats', stats);

      const prize = game.wrong.length === 0 ? 45 : 30;
      const coins = grantWin(me, prize);

      const winText = [
        `🎉 *مبروك! كشفت الكلمة كاملة يا ${m.pushName}!* 👏`,
        `الكلمة هي: *${game.word}*`,
        `💡 ${game.hint}`,
        ``,
        `💰 +${prize} عملة (رصيدك الإجمالي: ${coins})`,
        `📊 انتصاراتك: *${st.win}* فوز`,
      ].join('\n');

      return sendQuickReplies(sock, m.jid, {
        title: '🎉 فزت في لعبة المشنقة!',
        text: winText,
        buttons: [{ label: '🔄 كلمة جديدة', id: '.hang new' }],
      });
    }

    // فحص الخسارة (6 أخطاء)
    if (game.wrong.length >= 6) {
      const stats = db.get('hangStats', {});
      const st = stats[me] ?? { win: 0, lose: 0, score: 0 };
      st.lose++;
      stats[me] = st;

      delete all[m.jid];
      db.set('hang', all);
      db.set('hangStats', stats);
      grantLoss(me);

      const loseText = [
        `💀 *للأسف اكتملت المشنقة وخسرت الدور!*`,
        `\`\`\`\n${GALLOWS[6]}\n\`\`\``,
        `الكلمة كانت: *${game.word}*`,
        `💡 ${game.hint}`,
        ``,
        `معلش، ركز في الدور الجاي وهتكسبها! 💪`,
      ].join('\n');

      return sendQuickReplies(sock, m.jid, {
        title: '💀 انتهت المحاولات!',
        text: loseText,
        buttons: [{ label: '🔄 جرب كلمة تانية', id: '.hang new' }],
      });
    }

    // استمرار اللعبة بعد المحاولة
    all[m.jid] = game;
    db.set('hang', all);

    const statusMsg = isHit
      ? `✅ *حرف صح (${char})!* ممتاز استمر 👏`
      : `❌ *حرف غلط (${char})!* احذر من المشنقة ⚠️`;

    return sendQuickReplies(sock, m.jid, {
      title: statusMsg,
      text: render(game) + '\n\nاكتب حرفك التالي أو الكلمة كاملة 👇',
      buttons: [
        { label: '🔄 كلمة جديدة', id: '.hang new' },
        { label: '🏳️ استسلام', id: '.hang giveup' },
      ],
    });
  },
};
