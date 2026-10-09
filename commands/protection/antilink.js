import { requireAdmin } from '../../core/groupadmin.js';
import { getSettings, updateSetting } from '../../core/protection.js';
import { sendQuickReplies } from '../../core/send.js';

// 🔗 .antilink — التحكم في اللينكات: تشغيل/إيقاف + دومينات مسموحة + نوع العقاب
export default {
  name: 'antilink',
  aliases: ['اللينكات', 'منع_اللينكات', 'روابط'],
  description: 'التحكم الشامل في اللينكات — تشغيل/إيقاف + سماح لدومين معيّن + تحديد نوع العقوبة',
  usage: '.antilink on|off  |  .antilink allow youtube.com  |  .antilink action delete|warn|kick',
  category: 'protection',
  async execute(sock, m, args) {
    if (await requireAdmin(sock, m, 'ضبط اللينكات')) return;

    const s = getSettings(m.jid);
    const sub = (args[0] ?? '').toLowerCase();
    const actionVal = (args[1] ?? '').toLowerCase();
    const allowed = s.allowLinks ?? [];

    if (sub === 'on' || sub === 'تشغيل') {
      updateSetting(m.jid, 'antilink', true);
      return m.reply('🔗 مانع اللينكات شغال الآن — الروابط غير المسموحة سيتم حظرها.');
    }
    if (sub === 'off' || sub === 'ايقاف' || sub === 'تعطيل') {
      updateSetting(m.jid, 'antilink', false);
      return m.reply('✅ تم إيقاف مانع اللينكات — أي رابط هيعدّي دلوقتي.');
    }

    // 🎯 تحديد نوع العقاب (delete | warn | kick)
    if (sub === 'action' || sub === 'عقاب' || sub === 'عقوبة') {
      if (['delete', 'حذف', 'مسح'].includes(actionVal)) {
        updateSetting(m.jid, 'antilinkAction', 'delete');
        return m.reply('✅ تم ضبط العقوبة: *مسح الرسالة فقط بهدوء*.');
      }
      if (['warn', 'انذار', 'إنذار'].includes(actionVal)) {
        updateSetting(m.jid, 'antilinkAction', 'warn');
        return m.reply('✅ تم ضبط العقوبة: *مسح + إنذار وطرد تلقائي عند 3 إنذارات*.');
      }
      if (['kick', 'طرد'].includes(actionVal)) {
        updateSetting(m.jid, 'antilinkAction', 'kick');
        return m.reply('🚪 تم ضبط العقوبة: *طرد فوري للمخالف بدون إنذار*.');
      }
      return sendQuickReplies(sock, m.jid, {
        title: '🔗 عقوبة إرسال الروابط',
        text: `العقوبة الحالية: *${s.antilinkAction || 'warn'}*\nاختر الإجراء الذي يتخذه البوت عند إرسال رابط مخالف:`,
        buttons: [
          { label: '🛡️ مسح فقط', id: '.antilink action delete' },
          { label: '⚠️ إنذار (3 طرد)', id: '.antilink action warn' },
          { label: '🚪 طرد فوري', id: '.antilink action kick' },
        ],
      });
    }

    if (sub === 'allow' || sub === 'سماح') {
      const domain = (args[1] ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      if (!domain) return m.reply('اكتب الدومين، مثال:\n`.antilink allow youtube.com`');
      if (allowed.includes(domain)) return m.reply(`${domain} مسموح خلاص 🤷`);
      allowed.push(domain);
      updateSetting(m.jid, 'allowLinks', allowed);
      if (!s.antilink) updateSetting(m.jid, 'antilink', true);
      return m.reply(`✅ ${domain} بقى مسموح بيه في الجروب\n🔗 باقي اللينكات ممنوعة.`);
    }

    if (sub === 'deny' || sub === 'منع' || sub === 'remove') {
      const domain = (args[1] ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      const i = allowed.indexOf(domain);
      if (i === -1) return m.reply(`${domain} مش في القائمة المسموحة 🤷`);
      allowed.splice(i, 1);
      updateSetting(m.jid, 'allowLinks', allowed);
      return m.reply(`🔒 ${domain} رجع ممنوع تاني.`);
    }

    // 📋 عرض كارت الحالة الشامل مع أزرار التحكم
    const currentAction = s.antilinkAction === 'kick' ? '🚪 طرد فوري' : s.antilinkAction === 'delete' ? '🛡️ مسح فقط' : '⚠️ مسح + إنذار (3 طرد)';
    const statusText = [
      `• الحالة: ${s.antilink ? '✅ مفعّل (ممنوع)' : '❌ معطّل (مسموح)'}`,
      `• نوع العقوبة: *${currentAction}*`,
      allowed.length ? `• الدومينات المسموحة:\n${allowed.map((d) => `  - ${d}`).join('\n')}` : '• الدومينات المسموحة: لا يوجد (أي لينك بيتحظر)',
    ].join('\n');

    return sendQuickReplies(sock, m.jid, {
      title: `🔗 مانع اللينكات في الجروب`,
      text: statusText,
      buttons: [
        { label: s.antilink ? '🔓 اسمح للكل' : '🔒 امنع الكل', id: s.antilink ? '.antilink off' : '.antilink on' },
        { label: '⚙️ نوع العقوبة', id: '.antilink action' },
        { label: '✅ اسمح بيوتيوب', id: '.antilink allow youtube.com' },
        { label: '✅ اسمح بتيك توك', id: '.antilink allow tiktok.com' },
      ],
    });
  },
};
