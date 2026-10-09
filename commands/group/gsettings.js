import { sendQuickReplies, sendText } from '../../core/send.js';
import { getSettings, updateSetting, isAdmin } from '../../core/protection.js';
import { isOwner } from '../../lib/utils.js';
import { config } from '../../config.js';

// ⚙️ .gsettings — لوحة السيطرة الشاملة وإعدادات الجروب (للأدمن والمالك)
const CORE_CONTROLS = [
  { key: 'download', label: '📥 التحميل والوسائط', type: 'tri' },
  { key: 'ai', label: '🤖 الذكاء الاصطناعي', type: 'bool' },
  { key: 'games', label: '🎮 الألعاب والتحديات', type: 'bool' },
  { key: 'tools', label: '🛠️ الأدوات والخدمات', type: 'bool' },
  { key: 'mentions', label: '📢 المنشن الجماعي', type: 'bool' },
  { key: 'antilink', label: '🔗 مانع اللينكات', type: 'bool' },
  { key: 'welcome', label: '👋 الترحيب بالأعضاء', type: 'bool' },
  { key: 'antispam', label: '🚫 مانع السبام والتكرار', type: 'bool' },
  { key: 'antibad', label: '🤬 مانع السباب والشتائم', type: 'bool' },
  { key: 'nsfw', label: '🌶️ فحص الصور NSFW', type: 'bool' },
  { key: 'antidelete', label: '👻 كشف الرسائل المحذوفة', type: 'bool' },
];

export default {
  name: 'gsettings',
  aliases: ['اعدادات', 'الاعدادات', 'ضبط', 'تحكم_الجروب', 'سيطرة'],
  description: 'لوحة السيطرة والتحكم الكامل في المجموعة والحماية (للأدمن فقط)',
  usage: '.gsettings [ميزة] [on|off|admin]',
  category: 'group',
  async execute(sock, m, args) {
    if (!m.isGroup) return m.reply('الأمر ده خاص بالجروبات بس 👥');

    const isAd = await isAdmin(sock, m.jid, m.sender);
    const isOwn = isOwner(m, config);
    if (!isAd && !isOwn) {
      return m.reply('🔐 لوحة السيطرة مخصصة لمشرفي الجروب والمالك فقط.');
    }

    const key = (args[0] ?? '').toLowerCase();
    const val = (args[1] ?? '').toLowerCase();
    const s = getSettings(m.jid);

    // 🎯 1. تخصيص إجراء عقاب اللينكات (action: delete | warn | kick)
    if (key === 'action' || key === 'عقاب' || key === 'عقوبة') {
      if (['delete', 'حذف', 'مسح'].includes(val)) {
        updateSetting(m.jid, 'antilinkAction', 'delete');
        return m.reply('✅ تم ضبط عقاب اللينكات: *مسح الرسالة فقط دون إنذار*.');
      }
      if (['warn', 'انذار', 'إنذار'].includes(val)) {
        updateSetting(m.jid, 'antilinkAction', 'warn');
        return m.reply('✅ تم ضبط عقاب اللينكات: *مسح + إنذار وطرد عند 3 إنذارات*.');
      }
      if (['kick', 'طرد'].includes(val)) {
        updateSetting(m.jid, 'antilinkAction', 'kick');
        return m.reply('🚪 تم ضبط عقاب اللينكات: *طرد فوري للمخالف بدون إنذار مسبق*.');
      }
      return sendQuickReplies(sock, m.jid, {
        title: '🔗 عقوبة إرسال الروابط',
        text: `العقوبة الحالية: *${s.antilinkAction || 'warn'}*\nاختر الإجراء الذي يتخذه البوت عند إرسال رابط مخالف:`,
        buttons: [
          { label: '🛡️ مسح فقط', id: '.gsettings action delete' },
          { label: '⚠️ إنذار (3 طرد)', id: '.gsettings action warn' },
          { label: '🚪 طرد فوري', id: '.gsettings action kick' },
        ],
      });
    }

    // 🎛️ 2. التحكم في ميزة محددة بالاسم (مثل: .gsettings download admin أو .gsettings ai off)
    const match = CORE_CONTROLS.find((c) => c.key === key || c.key.toLowerCase() === key);
    if (match) {
      let nextVal;
      if (['on', 'فتح', 'تشغيل', 'true'].includes(val)) nextVal = true;
      else if (['off', 'قفل', 'تعطيل', 'false'].includes(val)) nextVal = false;
      else if (['admin', 'ادمن', 'مشرفين'].includes(val) && match.type === 'tri') nextVal = 'admin';
      else {
        // تبديل تلقائي (Toggle)
        if (match.type === 'tri') {
          if (s[match.key] === true) nextVal = 'admin';
          else if (s[match.key] === 'admin') nextVal = false;
          else nextVal = true;
        } else {
          nextVal = !s[match.key];
        }
      }

      updateSetting(m.jid, match.key, nextVal);
      const statusLabel = nextVal === true ? '✅ مفعل (مفتوح للجميع)' : nextVal === 'admin' ? '👑 مخصص للأدمن فقط' : '❌ معطل بالكامل';
      return sendQuickReplies(sock, m.jid, {
        title: `⚙️ تم تحديث ${match.label}`,
        text: `الحالة الجديدة لـ *${match.label}*: ${statusLabel}`,
        buttons: [
          { label: '⚙️ العودة للوحة الإعدادات', id: '.gsettings' },
        ],
      });
    }

    // 📊 3. عرض لوحة التحكم الرئيسية الكاملة (Master Dashboard)
    const renderStatus = (k) => {
      const v = s[k];
      if (v === true) return '✅ مفعّل';
      if (v === 'admin') return '👑 أدمن فقط';
      return '❌ معطّل';
    };

    const dashboardLines = [
      '╭─────「 ⚙️ لوحة السيطرة وإعدادات الجروب 」─────╮',
      '',
      '🎛️ *التحكم في الأقسام والميزات:*',
      `• 📥 التحميل والوسائط: ${renderStatus('download')}`,
      `• 🤖 الذكاء الاصطناعي: ${renderStatus('ai')} ${s.aiChatAll ? '(شات كامل)' : '(بالمنشن)'}`,
      `• 🎮 الألعاب والتحديات: ${renderStatus('games')}`,
      `• 🛠️ الأدوات والخدمات: ${renderStatus('tools')}`,
      `• 📢 المنشن الجماعي: ${renderStatus('mentions')}`,
      '',
      '🛡️ *الحماية والأمان:*',
      `• 🔗 مانع اللينكات: ${renderStatus('antilink')} (عقاب: ${s.antilinkAction || 'إنذار'})`,
      `• 🚫 مانع السبام والتكرار: ${renderStatus('antispam')}`,
      `• 🤬 مانع السباب: ${renderStatus('antibad')}`,
      `• 🌶️ فحص الصور NSFW: ${renderStatus('nsfw')}`,
      `• 👋 رسالة الترحيب: ${renderStatus('welcome')}`,
      `• 👻 كشف المحذوف: ${renderStatus('antidelete')}`,
      '',
      '💡 *اضغط أي زر بالأسفل لتبديل حالته فوراً 👇*',
      '╰──────────────────────────────────────────╯',
    ].join('\n');

    return sendQuickReplies(sock, m.jid, {
      title: '⚙️ لوحة السيطرة والتحكم — أسترو',
      text: dashboardLines,
      buttons: [
        { label: `📥 تحميل (${s.download === true ? 'الكل' : s.download === 'admin' ? 'أدمن' : 'قفل'})`, id: '.gsettings download' },
        { label: `🤖 ذكاء (${s.ai ? 'شغال' : 'قفل'})`, id: '.gsettings ai' },
        { label: `🎮 ألعاب (${s.games ? 'مفتوحة' : 'قفل'})`, id: '.gsettings games' },
        { label: `🔗 لينكات (${s.antilink ? 'منع' : 'سماح'})`, id: '.gsettings antilink' },
        { label: `📢 منشن (${s.mentions ? 'أدمن' : 'قفل'})`, id: '.gsettings mentions' },
        { label: `🛠️ أدوات (${s.tools ? 'مفتوحة' : 'قفل'})`, id: '.gsettings tools' },
        { label: '⚙️ نوع عقاب اللينكات', id: '.gsettings action' },
        { label: '🔒 قفل الشات', id: '.group close' },
        { label: '🔓 فتح الشات', id: '.group open' },
      ],
    });
  },
};