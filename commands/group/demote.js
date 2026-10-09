import { isAdmin } from '../../core/protection.js';
import { targetOf, mentionOf } from '../../core/groupadmin.js';

// ⬇️ .demote — تنزيل أدمن لعضو
export default {
  name: 'demote',
  aliases: ['تنزيل_مشرف', 'تنزيلادمن', 'سحب_الادمن', 'انزل_ادمن'],
  description: 'تنزيل أدمن لعضو عادي — منشنه أو رد على رسالته',
  usage: '.demote @شخص',
  async execute(sock, m) {
    if (!(await isAdmin(sock, m.jid, m.sender))) return m.reply('🔐 الأمر ده للأدمن بس');
    const target = targetOf(m);
    if (!target) return m.reply('منشن الشخص أو اعمل رد على رسالته: `.demote @شخص`');
    try {
      await sock.groupParticipantsUpdate(m.jid, [target], 'demote');
      return sock.sendMessage(m.jid, { text: `⬇️ نزلت ${mentionOf(target)} من الإدارة`, mentions: [target] });
    } catch {
      return m.reply('❌ مقدرتش — لازم مالك الجروب يفعل ده');
    }
  },
};
