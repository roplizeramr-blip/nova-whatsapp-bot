import { sendQuickReplies, sendText } from '../../core/send.js';
import { db } from '../../core/db.js';
import { grantWin, grantLoss, addCoins } from '../../core/economy.js';

const WINS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // صفوف
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // أعمدة
  [0, 4, 8], [2, 4, 6],            // أقطار
];

const NUM_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

function cell(board, i) {
  const v = board[i];
  if (v === 'X') return '❌';
  if (v === 'O') return '⭕';
  return NUM_EMOJIS[i] || '▫️';
}

function render(board) {
  return [
    ` ${cell(board, 0)}  │  ${cell(board, 1)}  │  ${cell(board, 2)} `,
    `─────┼─────┼─────`,
    ` ${cell(board, 3)}  │  ${cell(board, 4)}  │  ${cell(board, 5)} `,
    `─────┼─────┼─────`,
    ` ${cell(board, 6)}  │  ${cell(board, 7)}  │  ${cell(board, 8)} `,
  ].join('\n');
}

function winner(board) {
  for (const [a, b, c] of WINS) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a];
  }
  return board.every(Boolean) ? 'draw' : null;
}

// ذكاء اصطناعي لبوت اللعبة — وضع ذكي وتكتيكي
function botMove(board, difficulty = 'normal') {
  const empties = board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (empties.length === 0) return -1;

  // لو مستوى سهل، يلعب عشوائي 60% من الوقت
  if (difficulty === 'easy' && Math.random() < 0.6) {
    return empties[Math.floor(Math.random() * empties.length)];
  }

  // 1) كسب فوري لو فيه حركة تكسب
  for (const i of empties) {
    const t = [...board];
    t[i] = 'O';
    if (winner(t) === 'O') return i;
  }

  // 2) صد فوري لو اللاعب مهدد يكسب
  for (const i of empties) {
    const t = [...board];
    t[i] = 'X';
    if (winner(t) === 'X') return i;
  }

  // 3) أخذ المركز لو فاضي
  if (!board[4]) return 4;

  // 4) الأركان التكتيكية
  const corners = [0, 2, 6, 8].filter((i) => !board[i]);
  if (corners.length > 0 && Math.random() < 0.8) {
    return corners[Math.floor(Math.random() * corners.length)];
  }

  // 5) أي مربع فاضي متاح
  return empties[Math.floor(Math.random() * empties.length)];
}

function boardButtons(board) {
  return board
    .map((v, i) => (v ? null : { label: `${NUM_EMOJIS[i]} مربع ${i + 1}`, id: `.xo ${i + 1}` }))
    .filter(Boolean)
    .slice(0, 9);
}

function games() {
  return db.get('xo', {});
}

export default {
  name: 'xo',
  aliases: ['اكس', 'اكس_او', 'اكس-او', 'xo9', 'تيك_تاك_تو'],
  description: 'لعبة إكس-أو المطورة (XO) — العب بالأرقام المباشرة 1-9 أو الأزرار التفاعلية',
  usage: '.xo  أو  .xo 5  أو  .xo stop',
  async execute(sock, m, args) {
    const all = games();
    const me = m.identityKey ?? m.sender;
    const rawArg = (args[0] ?? '').trim();
    const arg = rawArg.toLowerCase();

    // 🛑 إيقاف اللعبة والاستسلام
    if (['stop', 'وقف', 'استسلم', 'الغاء', 'إلغاء', 'خروج'].includes(arg)) {
      if (!all[m.jid]) return m.reply('مافيش لعبة شغالة هنا عشان تلغيها! اكتب `.xo` وابدأ واحدة 🎮');
      delete all[m.jid];
      db.set('xo', all);
      return m.reply('🛑 تم إنهاء لعبة إكس-أو. اكتب `.xo` في أي وقت للبدء من جديد!');
    }

    let game = all[m.jid];

    // 🎮 بدء لعبة جديدة إذا لم تكن هناك لعبة أو طُلب ذلك صراحة
    if (!game || arg === 'new' || arg === 'جديد' || arg === 'ابدأ') {
      const difficulty = args[1] === 'easy' || args[1] === 'سهل' ? 'easy' : 'normal';
      all[m.jid] = {
        board: Array(9).fill(null),
        player: me,
        playerName: m.pushName || 'اللاعب',
        difficulty,
        at: Date.now(),
      };
      db.set('xo', all);

      const introText = [
        `🎮 *لعبة إكس-أو (Tic-Tac-Toe)* ❌⭕`,
        `أنت هتلعب بـ: ❌`,
        `البوت هيلعب بـ: ⭕`,
        ``,
        render(all[m.jid].board),
        ``,
        `💡 *طريقة اللعب:*`,
        `اكتب رقم المربع من *1 إلى 9* مباشرة في الشات!`,
        `أو اضغط على الزر التفاعلي بالأسفل 👇`,
      ].join('\n');

      return sendQuickReplies(sock, m.jid, {
        title: '❌⭕ بدأت لعبة إكس-أو!',
        text: introText,
        buttons: boardButtons(all[m.jid].board),
      });
    }

    // 🛡️ فحص هوية اللاعب في اللعبة
    if (game.player && game.player !== me && !m.isOwner) {
      return m.reply(`✋ في لعبة شغالة حالياً لصاحبها *${game.playerName || 'لاعب آخر'}*!\nاكتب \`.xo stop\` لإنهائها أو استنى يخلص دورته.`);
    }

    // 🎯 استخراج رقم المربع المطلوب اللعب فيه (يدعم 1..9، p1..p9، mv-1..mv-9)
    let pos = null;
    const match = /^(?:p|mv-)?([1-9])$/i.exec(rawArg);
    if (match) {
      pos = Number(match[1]) - 1;
    }

    // إذا لم يرسل رقماً، نعرض له اللوحة الحالية
    if (pos === null) {
      return sendQuickReplies(sock, m.jid, {
        title: '❌⭕ لعبة إكس-أو مستمرة',
        text: `${render(game.board)}\n\n💡 اكتب رقم المربع (1-9) للعب، أو دوس زر من تحت:`,
        buttons: boardButtons(game.board),
      });
    }

    // فحص ما إذا كان المربع مشغولاً
    if (game.board[pos]) {
      return m.reply(`⚠️ المربع رقم *${pos + 1}* مشغول بالفعل (${game.board[pos]})! اختار مربع فاضي.`);
    }

    // 1️⃣ حركة اللاعب البشري
    game.board[pos] = 'X';
    let res = winner(game.board);
    let botPlayedPos = null;

    // 2️⃣ حركة البوت إذا لم تنته اللعبة
    if (!res) {
      const bPos = botMove(game.board, game.difficulty);
      if (bPos >= 0) {
        game.board[bPos] = 'O';
        botPlayedPos = bPos;
        res = winner(game.board);
      }
    }

    game.at = Date.now();

    // 🏆 معالجة النتيجة النهائية (فوز / خسارة / تعادل)
    if (res) {
      const stats = db.get('xoStats', {});
      const st = stats[me] ?? { win: 0, lose: 0, draw: 0, streak: 0, maxStreak: 0 };

      let endTitle = '';
      let rewardText = '';

      if (res === 'X') {
        st.win++;
        st.streak = (st.streak || 0) + 1;
        st.maxStreak = Math.max(st.maxStreak || 0, st.streak);

        let winCoins = 30;
        let streakBonus = 0;
        if (st.streak >= 3) {
          streakBonus = st.streak * 10;
          winCoins += streakBonus;
        }

        const totalCoins = grantWin(me, winCoins);
        endTitle = `🎉 *كفوو عليك! فزت على البوت!* 🏆`;
        rewardText = `💰 كسبت: *+${winCoins} عملة* ${streakBonus > 0 ? `(منها 🔥 ${streakBonus} بونص سلسلة!)` : ''}\n🪙 رصيدك الحالي: *${totalCoins}*`;
      } else if (res === 'O') {
        st.lose++;
        st.streak = 0;
        grantLoss(me);
        endTitle = `😎 *البوت كسبك المرة دي!* حظ أوفر يا بطل`;
        rewardText = `💔 راحت عليك، ركز في الدور الجاي!`;
      } else {
        st.draw++;
        endTitle = `🤝 *تعادل قوي وممتع!*`;
        addCoins(me, 10);
        rewardText = `🪙 +10 عملات تعويضية لكل لاعب محترم`;
      }

      stats[me] = st;
      delete all[m.jid];
      db.set('xo', all);
      db.set('xoStats', stats);

      const finalBoard = [
        endTitle,
        ``,
        render(game.board),
        ``,
        rewardText,
        `📊 *إحصائياتك:* ${st.win} فوز 🥇 • ${st.lose} خسارة 💔 • ${st.draw} تعادل 🤝 • 🔥 سلسلة: ${st.streak}`,
      ].join('\n');

      return sendQuickReplies(sock, m.jid, {
        title: endTitle,
        text: finalBoard,
        buttons: [
          { label: '🔄 العب جولة تانية', id: '.xo new' },
          { label: '🎮 ألعاب تانية', id: '.games' },
        ],
      });
    }

    // 🔄 استمرار اللعبة
    all[m.jid] = game;
    db.set('xo', all);

    const stepText = [
      `❌⭕ *دورك الآن!*`,
      `${botPlayedPos !== null ? `🤖 البوت لعب في المربع رقم: *${botPlayedPos + 1}*\n` : ''}`,
      render(game.board),
      ``,
      `اكتب رقم المربع (1-9) مباشرة في الشات 👇`,
    ].join('\n');

    return sendQuickReplies(sock, m.jid, {
      title: '❌⭕ دورك في اللعب',
      text: stepText,
      buttons: boardButtons(game.board),
    });
  },
};
