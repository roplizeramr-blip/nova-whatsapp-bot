import { sendQuickReplies } from '../../core/send.js';
import { db } from '../../core/db.js';
import { grantWin, grantLoss, getEco, addCoins } from '../../core/economy.js';

const CHOICES = {
  rock:     { emoji: '✊', ar: 'حجر', beats: 'scissors' },
  paper:    { emoji: '✋', ar: 'ورقة', beats: 'rock' },
  scissors: { emoji: '✌️', ar: 'مقص', beats: 'paper' },
};

const ALIASES = {
  rock:     ['حجر', 'ح', 'rock', 'r', '1', '✊'],
  paper:    ['ورقة', 'ورق', 'و', 'paper', 'p', '2', '✋'],
  scissors: ['مقص', 'م', 'scissors', 's', '3', '✌️'],
};

function parseChoice(str) {
  if (!str) return null;
  const s = String(str).toLowerCase().trim();
  for (const [key, aliases] of Object.entries(ALIASES)) {
    if (aliases.includes(s)) return key;
  }
  return null;
}

export default {
  name: 'rps',
  aliases: ['حجر', 'حجر_ورقة_مقص', 'مقص', 'ورقة'],
  description: 'لعبة حجر ورقة مقص مع رهانات العملات وتحديات البوت الممتعة',
  usage: '.rps [حجر / ورقة / مقص] [رهان]  أو  اكتب حركتك مباشرة',
  async execute(sock, m, args) {
    const meKey = m.identityKey ?? m.sender;
    const stats = db.get('rpsStats', {});
    const me = stats[meKey] ?? { win: 0, lose: 0, draw: 0, streak: 0 };

    let choice = null;
    let bet = 0;

    // فحص المعاملات المدخلة (سواء كان الرهان أولاً أو الحركة أولاً)
    for (const a of args) {
      const c = parseChoice(a);
      if (c && !choice) {
        choice = c;
      } else if (/^\d+$/.test(a) && !bet) {
        bet = Number(a);
      }
    }

    // فحص صحة الرهان لو وُجد
    if (bet > 0) {
      if (bet < 5) return m.reply('📉 أقل مبلغ للرهان هو 5 عملات!');
      if (bet > 500) return m.reply('📈 أقصى مبلغ للرهان في الجولة هو 500 عملة!');

      const eco = getEco(meKey);
      if (eco.coins < bet) {
        return m.reply(`🪙 رصيدك الحالي (*${eco.coins}* عملة) مش كافي للرهان ده!`);
      }
    }

    // إذا لم يحدد حركة، نعرض له أزرار الاختيار
    if (!choice) {
      const betNotice = bet > 0 ? `\n💰 الرهان الحالي: *${bet} عملة*` : '';
      return sendQuickReplies(sock, m.jid, {
        title: '🎮 حجر ورقة مقص!',
        text: `اختار حركتك واهزم البوت! ✊✋✌️${betNotice}\nأو اكتب في الشات: \`.rps حجر ${bet || 20}\``,
        buttons: [
          { label: '✊ حجر', id: `.rps rock ${bet || ''}`.trim() },
          { label: '✋ ورقة', id: `.rps paper ${bet || ''}`.trim() },
          { label: '✌️ مقص', id: `.rps scissors ${bet || ''}`.trim() },
        ],
      });
    }

    // اختيار البوت العشوائي
    const botChoiceKeys = ['rock', 'paper', 'scissors'];
    const botPick = botChoiceKeys[Math.floor(Math.random() * 3)];

    const myObj = CHOICES[choice];
    const botObj = CHOICES[botPick];

    let resultStatus = '';
    let coinDeltaText = '';

    if (choice === botPick) {
      // تعادل
      me.draw++;
      resultStatus = '🤝 *تعادل!* اللعبتين طلعوا نفس الحاجة!';
      coinDeltaText = bet > 0 ? '🪙 تم استرجاع رهانك بدون تغيير.' : '';
    } else if (myObj.beats === botPick) {
      // فوز اللاعب
      me.win++;
      me.streak = (me.streak || 0) + 1;
      resultStatus = `🎉 *كفووو! فزت على البوت!* 🏆`;

      const prize = bet > 0 ? bet : 20;
      const totalCoins = addCoins(meKey, prize);
      coinDeltaText = `💰 كسبت: *+${prize} عملة* (رصيدك: ${totalCoins})`;
    } else {
      // فوز البوت
      me.lose++;
      me.streak = 0;
      resultStatus = `😎 *البوت كسبك المرة دي!*`;

      if (bet > 0) {
        const totalCoins = addCoins(meKey, -bet);
        coinDeltaText = `💸 خسرت رهانك: *-${bet} عملة* (رصيدك: ${totalCoins})`;
      } else {
        grantLoss(meKey);
        coinDeltaText = `معلش، ركز في الجولة الجاية! 💪`;
      }
    }

    stats[meKey] = me;
    db.set('rpsStats', stats);

    const roundMsg = [
      `🎮 *نتيجة جولة حجر ورقة مقص*`,
      ``,
      `👤 أنت: ${myObj.emoji} *${myObj.ar}*`,
      `🤖 البوت: ${botObj.emoji} *${botObj.ar}*`,
      ``,
      `🏆 ${resultStatus}`,
      coinDeltaText ? `${coinDeltaText}\n` : '',
      `📊 سجلك: ${me.win} فوز 🥇 • ${me.lose} خسارة 💔 • ${me.draw} تعادل 🤝 • 🔥 سلسلة: ${me.streak}`,
    ].filter(Boolean).join('\n');

    return sendQuickReplies(sock, m.jid, {
      title: resultStatus,
      text: roundMsg,
      buttons: [
        { label: '✊ حجر', id: `.rps rock ${bet || ''}`.trim() },
        { label: '✋ ورقة', id: `.rps paper ${bet || ''}`.trim() },
        { label: '✌️ مقص', id: `.rps scissors ${bet || ''}`.trim() },
      ],
    });
  },
};
