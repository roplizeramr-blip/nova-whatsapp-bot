import { sendQuickReplies, sendText } from '../../core/send.js';
import { db } from '../../core/db.js';
import { grantWin, grantLoss } from '../../core/economy.js';
import { resolveKey } from '../../core/identity.js';

// ⚔️ .duel — إكس-أو بين لاعبين حقيقيين في الجروب + عملات للفايز
const WINS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

// ⏰ تحدي متسنى عليه أكتر من كده = مهمل. من غير الوقت ده لو حد تحدّى وراح
// (أو مات النت عنده) الجروب يفضل متقفل على "فيه مبارزة شغالة" للأبد.
const STALE_MS = 30 * 60 * 1000;

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

function duels() {
  return db.get('duels', {});
}

function boardButtons(board) {
  if (!board) return Array.from({ length: 9 }, (_, i) => ({ label: `▫️ ${i + 1}`, id: `.duel mv-${i + 1}` }));
  return board
    .map((v, i) => (v ? null : { label: `▫️ ${i + 1}`, id: `.duel mv-${i + 1}` }))
    .filter(Boolean);
}

function mention(j) {
  return '@' + String(j).split('@')[0];
}

// الجيد بـ LID مش رقم التليفون — المنشن لازم يبقى على الـ JID الحقيقي
function pn(j) {
  return String(j).replace('@lid', '@s.whatsapp.net');
}

export default {
  name: 'duel',
  aliases: ['مبارزة', 'تحدى'],
  description: 'تحدى صاحبك إكس-أو في الجروب — 50 عملة للفايز!',
  usage: '.duel @شخص',
  async execute(sock, m, args) {
    if (!m.isGroup) return m.reply('المبارزة في الجروبات بس — عشان يكون في جمهور 😄');
    const all = duels();
    const me = m.identityKey ?? m.sender;
    let sub = (args.find((a) => /^(yes|no|mv-|cancel|stop|p?[1-9]$)/i.test(a)) ?? '').toLowerCase();
    if (/^p?[1-9]$/.test(sub)) {
      sub = `mv-${sub.replace('p', '')}`;
    }

    // 🧹 تنظيف المبارزات المهملة — اللي فات عليها الوقت
    const existing = all[m.jid];
    if (existing?.at && Date.now() - existing.at > STALE_MS) {
      delete all[m.jid];
      db.set('duels', all);
      return m.reply('🧹 المبارزة القديمة اتشالت (كانت متسنية من زمان) — ابدأ واحدة جديدة');
    }
    const game = all[m.jid];

    // 🚪 إلغاء / إيقاف — كان في الريجكس بس مفيش branch بيستقبله، فالتحدي المعلّق
    // كان بيسيب الجروب مقفول على "فيه مبارزة شغالة" إلى الأبد.
    if (sub === 'cancel' || sub === 'stop') {
      if (!game) return m.reply('مفيش مبارزة تلغيها 🤷');
      const isChallenger = game.pX === me;
      const isChallenged = game.pO === me;
      if (!isChallenger && !isChallenged && !game.pX?.includes(String(m.sender).split('@')[0])) {
        return m.reply('🚫 الإلغاء للاعبين بس');
      }
      const who = isChallenger ? 'المتحدّي' : 'المتحدّى';
      delete all[m.jid];
      db.set('duels', all);
      return m.reply(`🚪 ${who} ألغى المبارزة. عايز تتحدى حد تاني؟ \`.duel @شخص\``);
    }

    // ضغطة على المربعات
    if (sub.startsWith('mv-')) {
      if (!game || game.stage !== 'playing') return m.reply('مفيش مبارزة شغالة — ابدأ واحدة بـ `.duel @شخص`');
      const currentPlayer = game.turn === 'X' ? game.pX : game.pO;
      if (me !== currentPlayer) return m.reply(`⏳ مش دورك! الدور على ${mention(currentPlayer)} ${game.turn === 'X' ? '❌' : '⭕'}`);
      const pos = Number(sub.slice(3)) - 1;
      if (pos < 0 || pos > 8) return m.reply('🚫 مربع غلط');
      if (game.board[pos]) return m.reply('🚫 المربع ده متاخد');
      game.board[pos] = game.turn;
      game.at = Date.now();
      const result = winner(game.board);

      if (result) {
        delete all[m.jid];
        db.set('duels', all);
        if (result === 'draw') {
          return sendQuickReplies(sock, m.jid, {
            title: '🤝 تعادل! مبارزة جامدة',
            text: render(game.board) + '\n\nالرجالة الاتنين محترمين 😂',
            buttons: [{ label: '🔄 ريماتش', id: `.duel ${mention(game.pO)}` }],
          });
        }
        const winnerKey = result === 'X' ? game.pX : game.pO;
        const loserKey = result === 'X' ? game.pO : game.pX;
        const coins = grantWin(winnerKey, 50);
        grantLoss(loserKey);
        return sendQuickReplies(sock, m.jid, {
          title: `🏆 ${mention(winnerKey)} كسب المبارزة!`,
          text: `${render(game.board)}\n\n💰 +${coins} عملة للبطل\n😂 ${mention(loserKey)} نصيبك المرة الجاية`,
          mentions: [pn(winnerKey), pn(loserKey)],
          buttons: [{ label: '🔄 ريماتش', id: `.duel ${mention(loserKey)}` }],
        });
      }

      game.turn = game.turn === 'X' ? 'O' : 'X';
      all[m.jid] = game;
      db.set('duels', all);
      return sendQuickReplies(sock, m.jid, {
        title: `⚔️ دور ${mention(game.turn === 'X' ? game.pX : game.pO)} ${game.turn === 'X' ? '❌' : '⭕'}`,
        text: [render(game.board), '', 'دوس على المربع اللي هتلعب فيه 👇', '(اكتب .duel cancel للإلغاء)'].join('\n'),
        buttons: boardButtons(game.board),
      });
    }

    // قبول/رفض التحدي
    if (sub === 'yes' || sub === 'no') {
      if (!game || game.stage !== 'pending') return m.reply('مفيش تحدي مستني قبول');
      if (me !== game.pO) return m.reply('التحدي مش ليك 😅');
      if (sub === 'no') {
        delete all[m.jid];
        db.set('duels', all);
        return m.reply(`😌 ${mention(game.pO)} رفض التحدي — خايف بظاهر`);
      }
      game.stage = 'playing';
      game.board = Array(9).fill(null);
      game.turn = 'X';
      game.at = Date.now();
      all[m.jid] = game;
      db.set('duels', all);
      return sendQuickReplies(sock, m.jid, {
        title: '⚔️ المبارزة بدأت! ❌ ضد ⭕',
        text: `${mention(game.pX)} ❌ (يبدأ)\n${mention(game.pO)} ⭕\n\n${render(game.board)}`,
        mentions: [pn(game.pX), pn(game.pO)],
        buttons: boardButtons(game.board),
      });
    }

    // بدء تحدي: .duel @شخص
    // ⚠️ كان بيسحب participant من contextInfo (بس موجود لما ترد على حد) وبيخزنه
    // خام من غير resolveKey — والباقي كله بيشتغل بمفاتيح الهوية، فاللاعب التاني
    // كان بيتقارن بمفتاح مختلف عن بتاعه → "مش دورك" للأبد بعد ما يقبل.
    const targetRaw =
      m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ??
      m.message?.extendedTextMessage?.contextInfo?.participant;
    if (!targetRaw) {
      return m.reply('منشن اللي عايز تتحداه: `.duel @شخص` — أو رد على رسالته');
    }
    if (game && (game.stage === 'pending' || game.stage === 'playing')) {
      return m.reply('⏳ فيه مبارزة شغالة هنا خلاص — خلصوها الأول أو `.duel cancel`');
    }
    const target = resolveKey(targetRaw) ?? targetRaw;
    if (me === target) return m.reply('😂 هتتحدى نفسك؟! جيب حد تاني');

    all[m.jid] = { stage: 'pending', pX: me, pO: target, target, at: Date.now() };
    db.set('duels', all);
    return sendQuickReplies(sock, m.jid, {
      title: `⚔️ تحدي! ${mention(me)} ضد ${mention(target)}`,
      text: `${mention(target)} — عندك تحدي إكس-أو! 🎮\nالفايز ياخد *50 عملة* 💰\n\nتقبل ولا خايف؟ 😏`,
      mentions: [pn(target), pn(me)],
      buttons: [
        { label: '⚔️ أقبل التحدي', id: '.duel yes' },
        { label: '🙈 خايف', id: '.duel no' },
        { label: '🚪 إلغاء', id: '.duel cancel' },
      ],
    });
  },
};
