import { sendQuickReplies } from '../../core/send.js';
import { db } from '../../core/db.js';
import { addCoins } from '../../core/economy.js';

function makeMathQuestion(diff = 'auto') {
  let difficulty = diff;
  if (difficulty === 'auto') {
    const r = Math.random();
    if (r < 0.35) difficulty = 'easy';
    else if (r < 0.75) difficulty = 'medium';
    else difficulty = 'hard';
  }

  if (difficulty === 'easy') {
    const a = 10 + Math.floor(Math.random() * 85);
    const b = 5 + Math.floor(Math.random() * 75);
    const isPlus = Math.random() < 0.5;
    const q = isPlus ? `${a} + ${b}` : `${Math.max(a, b)} - ${Math.min(a, b)}`;
    const answer = isPlus ? a + b : Math.max(a, b) - Math.min(a, b);
    return { q: `${q} = ؟`, answer, reward: 15, level: '🟢 سهل' };
  }

  if (difficulty === 'medium') {
    const isMult = Math.random() < 0.6;
    if (isMult) {
      const a = 4 + Math.floor(Math.random() * 9);
      const b = 6 + Math.floor(Math.random() * 12);
      return { q: `${a} × ${b} = ؟`, answer: a * b, reward: 30, level: '🟡 متوسط' };
    } else {
      const b = 3 + Math.floor(Math.random() * 9);
      const res = 4 + Math.floor(Math.random() * 15);
      const a = b * res;
      return { q: `${a} ÷ ${b} = ؟`, answer: res, reward: 30, level: '🟡 متوسط' };
    }
  }

  // hard: عمليات مركبة
  const type = Math.floor(Math.random() * 3);
  if (type === 0) {
    const a = 3 + Math.floor(Math.random() * 8);
    const b = 4 + Math.floor(Math.random() * 9);
    const c = 10 + Math.floor(Math.random() * 40);
    return { q: `(${a} × ${b}) + ${c} = ؟`, answer: a * b + c, reward: 50, level: '🔴 عبقري (صعب)' };
  } else if (type === 1) {
    const a = 5 + Math.floor(Math.random() * 12);
    const b = 3 + Math.floor(Math.random() * 8);
    const c = 5 + Math.floor(Math.random() * 20);
    return { q: `(${a} × ${b}) - ${c} = ؟`, answer: a * b - c, reward: 50, level: '🔴 عبقري (صعب)' };
  } else {
    const num = 4 + Math.floor(Math.random() * 8);
    const add = 15 + Math.floor(Math.random() * 40);
    return { q: `${num}² + ${add} = ؟`, answer: num * num + add, reward: 50, level: '🔴 عبقري (صعب)' };
  }
}

function state() {
  return db.get('math', {});
}

export default {
  name: 'math',
  aliases: ['رياضيات', 'حسبة', 'حساب', 'مسألة', 'ذكاء_رياضي'],
  description: 'تحدي عباقرة الرياضيات — أول إجابة صحيحة تكسب العملات فورياً',
  usage: '.math [سهل / متوسط / صعب]  أو  اكتب الناتج مباشرة في الشات',
  async execute(sock, m, args) {
    const all = state();
    const game = all[m.jid];
    const rawArg = (args[0] ?? '').trim().toLowerCase();

    // 🛑 استسلام
    if (['giveup', 'استسلم', 'استسلام', 'stop', 'وقف', 'الغاء', 'إلغاء'].includes(rawArg)) {
      if (!game) return m.reply('مافيش مسألة رياضيات شغالة دلوقتي! اكتب `.math` وابدأ واحدة 🧮');
      delete all[m.jid];
      db.set('math', all);
      return sendQuickReplies(sock, m.jid, {
        title: `🏳️ استسلمت! الإجابة الصحيحة كانت: *${game.answer}*`,
        text: 'معلش، المرة الجاية هتحسبها أسرع! 💪',
        buttons: [{ label: '🧮 مسألة جديدة', id: '.math' }],
      });
    }

    // 🎯 استقبال إجابة رقمية
    if (/^-?\d+$/.test(rawArg) && game) {
      const guess = Number(rawArg);

      // فحص انتهاء الوقت (60 ثانية)
      if (Date.now() - game.at > 60000) {
        delete all[m.jid];
        db.set('math', all);
        return sendQuickReplies(sock, m.jid, {
          title: `⌛ انتهى وقت المسألة! الإجابة كانت: *${game.answer}*`,
          text: 'عايز تتحدى نفسك بمسألة جديدة؟ 👇',
          buttons: [{ label: '🧮 مسألة جديدة', id: '.math' }],
        });
      }

      // الإجابة صحيحة!
      if (guess === game.answer) {
        const meKey = m.identityKey ?? m.sender;
        const stats = db.get('mathStats', {});
        const me = stats[meKey] ?? { points: 0, streak: 0, maxStreak: 0 };
        me.points++;
        me.streak = (me.streak || 0) + 1;
        me.maxStreak = Math.max(me.maxStreak || 0, me.streak);

        let earned = game.reward || 20;
        let streakText = '';
        if (me.streak >= 3) {
          const streakBonus = me.streak * 5;
          earned += streakBonus;
          streakText = `\n🔥 *سلسلة سرعة خارقة:* ${me.streak} إجابات متتالية! (+${streakBonus} عملة بونص)`;
        }

        const totalCoins = addCoins(meKey, earned);
        delete all[m.jid];
        db.set('math', all);
        db.set('mathStats', stats);

        const winMsg = [
          `🎉 *يا عبقري يا صاروخ يا ${m.pushName || 'بطل'}!* ⚡`,
          `المسألة: *${game.q}*`,
          `إجابتك الصحيحة: *${guess}* ✅`,
          ``,
          `💰 كسبت: *+${earned} عملة* (رصيدك الإجمالي: ${totalCoins})${streakText}`,
          `📊 نقاطك في الرياضيات: *${me.points}* نقطة`,
        ].join('\n');

        return sendQuickReplies(sock, m.jid, {
          title: `🎉 إجابة صحيحة وسريعة!`,
          text: winMsg,
          buttons: [
            { label: '🧮 مسألة تانية', id: '.math' },
            { label: '🎮 ألعاب تانية', id: '.games' },
          ],
        });
      }

      return m.reply(`❌ إجابة مش صحيحة! ركز واحسبها تاني (فاضل ثواني في المؤقت ⏱️)`);
    }

    // إذا كانت هناك مسألة سارية ولم تنته، نذكر بها
    if (game && Date.now() - game.at <= 60000 && !rawArg.includes('new') && !rawArg.includes('جديد')) {
      const remainingSecs = Math.max(0, Math.ceil((game.at + 60000 - Date.now()) / 1000));
      return m.reply(`🧮 *المسألة الحالية لسه شغالة:*\n*${game.q}*\nالصعوبة: ${game.level}\n⏱️ باقي ${remainingSecs} ثانية!\nاكتب الناتج في الشات مباشرة.`);
    }

    // إنشاء مسألة جديدة
    let chosenDiff = 'auto';
    if (['easy', 'سهل'].includes(rawArg)) chosenDiff = 'easy';
    else if (['med', 'medium', 'متوسط'].includes(rawArg)) chosenDiff = 'medium';
    else if (['hard', 'صعب', 'عبقري'].includes(rawArg)) chosenDiff = 'hard';

    const questionObj = makeMathQuestion(chosenDiff);
    all[m.jid] = {
      q: questionObj.q,
      answer: questionObj.answer,
      reward: questionObj.reward,
      level: questionObj.level,
      at: Date.now(),
    };
    db.set('math', all);

    const questionMsg = [
      `🧮 *تحدي الرياضيات والسرعة!* ⏱️`,
      `المستوى: *${questionObj.level}*`,
      `الجائزة: *${questionObj.reward} عملة* 💰`,
      ``,
      `❓ المسألة: *${questionObj.q}*`,
      ``,
      `💡 اكتب الإجابة كرقم مباشرة في الشات! أول واحد يجاوب صح يكسب 🚀`,
    ].join('\n');

    return sendQuickReplies(sock, m.jid, {
      title: '🧮 مسألة رياضيات جديدة',
      text: questionMsg,
      buttons: [
        { label: '🏳️ استسلام', id: '.math giveup' },
        { label: '🧮 تغيير المسألة', id: '.math' },
      ],
    });
  },
};
