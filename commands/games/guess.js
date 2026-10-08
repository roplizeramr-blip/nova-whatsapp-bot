import { sendQuickReplies } from '../../core/send.js';
import { db } from '../../core/db.js';
import { grantWin, grantLoss, getEco, saveEco } from '../../core/economy.js';

const MAX = 50;   // نطاق الرقم من 1 لـ 50
const TRIES = 6;  // عدد المحاولات المتاحة

function state() {
  return db.get('guess', {});
}

function gameKey(m) {
  return `${m.jid}::${m.identityKey ?? m.sender}`;
}

function statKey(m) {
  return m.identityKey ?? m.sender;
}

function getTemperature(guess, target) {
  const diff = Math.abs(guess - target);
  if (diff <= 2) return '🔥🔥🔥 *مولعة ناااار!* أنت على بُعد خطوتين بس من الرقم الصح!';
  if (diff <= 5) return '🔥 *سخنة وقريبة جداً!* قربت من الهدف!';
  if (diff <= 10) return '🌤️ *دافية!* في الاتجاه الصح، استمر!';
  return '❄️ *باردة وبعيدة!* لسه قدامك مسافة.';
}

function showGame(sock, m, game, hintText) {
  const lines = [
    `🔢 *لعبة تخمين الرقم السري* 🎯`,
    `أنا مخبي رقم بين *1* و *${MAX}*`,
    `فاضل ليك: *${game.left}* محاولات من ${TRIES}`,
    `النطاق الحالي للرقم: [ من *${game.low}* إلى *${game.high}* ]`,
  ];

  if (hintText) {
    lines.push('', hintText);
  }

  lines.push('', '💡 اكتب رقمك مباشرة في الشات (مثال: \`25\`) 👇');

  const mid = Math.floor((game.low + game.high) / 2);
  const buttons = [
    { label: `🎲 جرب المنتصف (${mid})`, id: `.guess ${mid}` },
    { label: '🏳️ استسلام', id: '.guess surrender' },
  ];

  return sendQuickReplies(sock, m.jid, {
    title: `🔢 تخمين — فاضل ${game.left} محاولة`,
    text: lines.join('\n'),
    buttons,
  });
}

export default {
  name: 'guess',
  aliases: ['خمن', 'تخمين', 'الرقم_السري', 'خمن_الرقم'],
  description: 'خمن الرقم السري من 1 إلى 50 بمؤشر الحرارة (ساخن/بارد) والجوائز الكبرى',
  usage: '.guess  أو  اكتب الرقم مباشرة في الشات',
  async execute(sock, m, args) {
    const all = state();
    const gk = gameKey(m);
    const sk = statKey(m);
    let game = all[gk];
    const rawArg = (args[0] ?? '').trim().toLowerCase();

    // 💡 استخدام تلميح مدفوع من المتجر
    if (rawArg === 'hint' || rawArg === 'تلميح') {
      if (!game) return m.reply('ابدأ لعبة الأول بـ `.guess` 🎯');
      const eco = getEco(sk);
      if ((eco.hints ?? 0) < 1) {
        return m.reply('مافيش عندك تلميحات في حقيبتك — اشتريها من المتجر بـ `.shop` 🛒');
      }
      eco.hints--;
      saveEco(sk, eco);
      const isBigger = game.number > Math.floor((game.low + game.high) / 2);
      const mid = Math.floor((game.low + game.high) / 2);
      return m.reply(`💡 *تلميح سري:* الرقم المطلوب *${isBigger ? 'أكبر من' : 'أصغر من أو يساوي'}* ${mid}\n(باقي في محفظتك ${eco.hints} تلميح)`);
    }

    // 🏳️ استسلام
    if (['surrender', 'استسلم', 'استسلام', 'stop', 'وقف', 'خروج'].includes(rawArg)) {
      if (!game) return m.reply('مافيش لعبة شغالة باسمك دلوقتي! اكتب `.guess` وابدأ واحدة 🔢');
      delete all[gk];
      db.set('guess', all);
      return sendQuickReplies(sock, m.jid, {
        title: '🏳️ استسلمت!',
        text: `الرقم السري كان: *${game.number}* 🎯\nمعلش، المرة الجاية هتجيبها صح! 💪`,
        buttons: [{ label: '🔄 العب تاني', id: '.guess' }],
      });
    }

    const num = Number(rawArg);

    // بدء لعبة جديدة إذا لم تكن موجودة
    if (!game) {
      game = {
        number: 1 + Math.floor(Math.random() * MAX),
        left: TRIES,
        low: 1,
        high: MAX,
        by: sk,
        at: Date.now(),
      };
      all[gk] = game;
      db.set('guess', all);

      if (!num || Number.isNaN(num)) {
        return showGame(sock, m, game, '🎯 بدأت لعبة التخمين! خمّن رقمك الآن:');
      }
    }

    // فحص صلاحية الرقم المدخل
    if (!num || Number.isNaN(num) || num < 1 || num > MAX) {
      return m.reply(`اكتب رقماً صالحاً بين *1* و *${MAX}* — مثال: \`.guess 25\``);
    }

    game.left--;
    const tempText = getTemperature(num, game.number);

    // 🏆 حالة الفوز
    if (num === game.number) {
      const stats = db.get('guessStats', {});
      const me = stats[sk] ?? { win: 0, lose: 0 };
      me.win++;
      stats[sk] = me;

      delete all[gk];
      db.set('guess', all);
      db.set('guessStats', stats);

      const attemptsUsed = TRIES - game.left;
      let prizeCoins = 25;
      if (attemptsUsed === 1) prizeCoins = 100; // أسطوري!
      else if (attemptsUsed === 2) prizeCoins = 60;
      else if (attemptsUsed === 3) prizeCoins = 40;

      const totalCoins = grantWin(sk, prizeCoins);

      const winMsg = [
        `🎉 *يا عبقري يا لعيب! خمنت الرقم الصح!* 🎯`,
        `الرقم السري هو: *${game.number}* ✅`,
        `جبتها في المحاولة رقم: *${attemptsUsed}* من ${TRIES}! 🔥`,
        ``,
        `💰 كسبت: *+${prizeCoins} عملة* (رصيدك الإجمالي: ${totalCoins})`,
        `📊 سجلّك: ${me.win} فوز • ${me.lose} خسارة`,
      ].join('\n');

      return sendQuickReplies(sock, m.jid, {
        title: `🎉 فوز بطل في التخمين!`,
        text: winMsg,
        buttons: [
          { label: '🔄 العب جولة تانية', id: '.guess' },
          { label: '🎮 ألعاب تانية', id: '.games' },
        ],
      });
    }

    // تعديل النطاق ومؤشر الاتجاه
    let directionHint = '';
    if (num < game.number) {
      game.low = Math.max(game.low, num + 1);
      directionHint = `⬆️ الرقم المطلوب *أكبر* من ${num}!\n${tempText}`;
    } else {
      game.high = Math.min(game.high, num - 1);
      directionHint = `⬇️ الرقم المطلوب *أصغر* من ${num}!\n${tempText}`;
    }

    // 💀 حالة الخسارة بانتهاء المحاولات
    if (game.left <= 0) {
      const stats = db.get('guessStats', {});
      const me = stats[sk] ?? { win: 0, lose: 0 };
      me.lose++;
      stats[sk] = me;

      delete all[gk];
      db.set('guess', all);
      db.set('guessStats', stats);
      grantLoss(sk);

      const loseMsg = [
        `💀 *خلصت كل محاولاتك للأسف!*`,
        `الرقم السري كان: *${game.number}* 🎯`,
        `📊 سجلّك: ${me.win} فوز • ${me.lose} خسارة`,
        `ما تزعلش — جرب تاني وتوقع صح! 💪`,
      ].join('\n');

      return sendQuickReplies(sock, m.jid, {
        title: '💀 انتهت المحاولات!',
        text: loseMsg,
        buttons: [{ label: '🔄 جرب تاني', id: '.guess' }],
      });
    }

    // حفظ واستمرار اللعبة
    game.at = Date.now();
    all[gk] = game;
    db.set('guess', all);

    return showGame(sock, m, game, directionHint);
  },
};
