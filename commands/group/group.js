import { requireAdmin, listParticipants } from '../../core/groupadmin.js';
import { sendQuickReplies, sendText } from '../../core/send.js';
import { getSettings } from '../../core/protection.js';

export default {
  name: 'group',
  aliases: ['جروب', 'المجموعة', 'مجموعة'],
  description: 'التحكم الإداري الشامل في المجموعة — قفل، فتح، روابط، وتعديل البيانات (للأدمن)',
  usage: '.group [close|open|link|revoke|name|desc|info]',
  category: 'group',
  async execute(sock, m, args) {
    if (await requireAdmin(sock, m, 'أوامر إدارة الجروب')) return;

    const sub = (args[0] ?? '').toLowerCase();
    const rest = args.slice(1).join(' ').trim();

    // 🔒 1. قفل الجروب (المشرفين فقط يكتبون)
    if (sub === 'close' || sub === 'قفل' || sub === 'غلق') {
      try {
        await sock.groupSettingUpdate(m.jid, 'announcement');
        return sendQuickReplies(sock, m.jid, {
          title: '🔒 تم قفل الجروب',
          text: 'تم إغلاق الشات بنجاح — الرسائل مقتصرة الآن على المشرفين فقط 🛡️',
          buttons: [{ label: '🔓 فتح الشات للجميع', id: '.group open' }],
        });
      } catch (err) {
        return m.reply('❌ مقدرتش أقفل الجروب — اتأكد إني واخد رتبة مشرف (Admin)!');
      }
    }

    // 🔓 2. فتح الجروب (الجميع يكتبون)
    if (sub === 'open' || sub === 'فتح') {
      try {
        await sock.groupSettingUpdate(m.jid, 'not_announcement');
        return sendQuickReplies(sock, m.jid, {
          title: '🔓 تم فتح الجروب',
          text: 'تم فتح الشات بنجاح — يمكن لجميع الأعضاء إرسال الرسائل الآن 💬✨',
          buttons: [{ label: '🔒 قفل الشات للمشرفين', id: '.group close' }],
        });
      } catch (err) {
        return m.reply('❌ مقدرتش أفتح الجروب — اتأكد إني واخد رتبة مشرف (Admin)!');
      }
    }

    // 🔗 3. رابط دعوة الجروب
    if (sub === 'link' || sub === 'لينك' || sub === 'رابط') {
      try {
        const code = await sock.groupInviteCode(m.jid);
        const inviteUrl = `https://chat.whatsapp.com/${code}`;
        return sendQuickReplies(sock, m.jid, {
          title: '🔗 رابط دعوة المجموعة',
          text: `رابط الجروب الرسمي الحالي:\n${inviteUrl}`,
          buttons: [
            { label: '📋 نسخ الرابط', id: `copy:${inviteUrl}` },
            { label: '🔄 تجديد الرابط', id: '.group revoke' },
          ],
        });
      } catch (err) {
        return m.reply('❌ مقدرتش أجيب الرابط — اتأكد إني مشرف في الجروب!');
      }
    }

    // 🔄 4. تجديد وإلغاء رابط الدعوة
    if (sub === 'revoke' || sub === 'تجديد' || sub === 'تجديد_الرابط' || sub === 'ريفوك') {
      try {
        const newCode = await sock.groupRevokeInvite(m.jid);
        const newUrl = `https://chat.whatsapp.com/${newCode}`;
        return sendQuickReplies(sock, m.jid, {
          title: '🔄 تم تجديد رابط الجروب',
          text: `تم إلغاء الرابط القديم وتوليد رابط جديد صالح:\n${newUrl}`,
          buttons: [
            { label: '📋 نسخ الرابط الجديد', id: `copy:${newUrl}` },
          ],
        });
      } catch (err) {
        return m.reply('❌ مقدرتش أجدد الرابط — اتأكد إني مشرف!');
      }
    }

    // 🏷️ 5. تغيير اسم الجروب
    if (sub === 'name' || sub === 'اسم' || sub === 'عنوان') {
      if (!rest) return m.reply('اكتب الاسم الجديد، مثال:\n`.group name شات الصحاب ⚡`');
      try {
        await sock.groupUpdateSubject(m.jid, rest);
        return m.reply(`✅ تم تغيير اسم الجروب إلى:\n*${rest}*`);
      } catch (err) {
        return m.reply('❌ مقدرتش أغير الاسم — اتأكد إني مشرف!');
      }
    }

    // 📝 6. تغيير وصف الجروب
    if (sub === 'desc' || sub === 'وصف' || sub === 'الوصف') {
      if (!rest) return m.reply('اكتب الوصف الجديد، مثال:\n`.group desc مرحباً بكم في الجروب، ممنوع اللينكات.`');
      try {
        await sock.groupUpdateDescription(m.jid, rest);
        return m.reply('✅ تم تحديث وصف وقوانين الجروب بنجاح!');
      } catch (err) {
        return m.reply('❌ مقدرتش أعدل الوصف — اتأكد إني مشرف!');
      }
    }

    // 📊 7. معلومات وحالة الجروب الشاملة
    if (sub === 'info' || sub === 'معلومات' || sub === 'الحالة') {
      try {
        const meta = await sock.groupMetadata(m.jid);
        const s = getSettings(m.jid);
        const admins = (meta.participants ?? []).filter((p) => p.admin);
        const total = (meta.participants ?? []).length;
        const isAnnounce = meta.announce;

        const infoText = [
          `╭────「 📊 معلومات المجموعة 」────╮`,
          `│ 🏷️ *الاسم:* ${meta.subject}`,
          `│ 👥 *الأعضاء:* ${total} عضو`,
          `│ 👑 *المشرفين:* ${admins.length} مشرف`,
          `│ 🔒 *حالة الشات:* ${isAnnounce ? 'مغلق (مشرفين فقط)' : 'مفتوح للجميع'}`,
          `│ 🔗 *مانع اللينكات:* ${s.antilink ? '✅ مفعّل' : '❌ معطّل'}`,
          `│ 📥 *التحميل:* ${s.download === true ? '✅ مفتوح' : s.download === 'admin' ? '👑 أدمن فقط' : '❌ مقفول'}`,
          `│ 🤖 *الذكاء:* ${s.ai ? '✅ شغال' : '❌ مقفول'}`,
          `│ 🎮 *الألعاب:* ${s.games ? '✅ مفتوحة' : '❌ مقفولة'}`,
          `╰──────────────────────────────╯`,
        ].join('\n');

        return sendQuickReplies(sock, m.jid, {
          title: '📊 لوحة معلومات المجموعة',
          text: infoText,
          buttons: [
            { label: isAnnounce ? '🔓 فتح الجروب' : '🔒 قفل الجروب', id: isAnnounce ? '.group open' : '.group close' },
            { label: '🔗 رابط الجروب', id: '.group link' },
            { label: '⚙️ إعدادات الحماية', id: '.gsettings' },
          ],
        });
      } catch (err) {
        return m.reply('❌ مقدرتش أجيب معلومات الجروب.');
      }
    }

    // 📋 القائمة الرئيسية لأوامر المجموعة
    return sendQuickReplies(sock, m.jid, {
      title: '👑 لوحة إدارة المجموعة',
      text: 'اختر الإجراء السريع لإدارة الجروب أو استخدم الأوامر المباشرة:\n• `.group close` قفل الشات للمشرفين\n• `.group open` فتح الشات للجميع\n• `.group link` جلب رابط الجروب\n• `.group revoke` تجديد رابط الدعوة\n• `.group name <الاسم>` تغيير اسم الجروب\n• `.group desc <الوصف>` تغيير وصف الجروب\n• `.group info` معلومات وحالة الجروب',
      buttons: [
        { label: '🔒 قفل الشات', id: '.group close' },
        { label: '🔓 فتح الشات', id: '.group open' },
        { label: '🔗 رابط الجروب', id: '.group link' },
        { label: '⚙️ الإعدادات والحماية', id: '.gsettings' },
      ],
    });
  },
};
