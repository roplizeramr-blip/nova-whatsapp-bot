import { MB } from '@rexxhayanasi/elaina-baileys';
import { config } from '../config.js';
import { ARABIC_ALIASES } from './arabic.js';

// 🗂️ أقسام أوامر بـوت استرو — مصنفة بدقة كاملة بالعربي
export const SECTIONS = [
  {
    id: 'ai',
    label: 'الذكاء الاصطناعي',
    emoji: '🤖',
    desc: 'اسأل شات جي بي تي، جيميناي، توليد صور، وتحويل النص لصوت',
    aliases: ['ذكاء', 'ذكاء_اصطناعي', 'ai', 'اسأل'],
  },
  {
    id: 'download',
    label: 'التحميل والوسائط',
    emoji: '📥',
    desc: 'تيك توك، فيسبوك، انستغرام، يوتيوب وأغاني MP3',
    aliases: ['تحميل', 'تنزيل', 'ميديا', 'وسائط', 'download'],
  },
  {
    id: 'games',
    label: 'الألعاب والتحديات',
    emoji: '🎮',
    desc: 'تحديات إكس أو، مسابقات، خمن الشخصية، المشنقة، وحساب',
    aliases: ['العاب', 'ألعاب', 'تحديات', 'games', 'لعب'],
  },
  {
    id: 'economy',
    label: 'البنك والاقتصاد',
    emoji: '💰',
    desc: 'رصيدك، البنك، المتجر، الوظائف، والترتيب اليومي',
    aliases: ['بنك', 'اقتصاد', 'فلوس', 'economy', 'محفظة'],
  },
  {
    id: 'tools',
    label: 'الأدوات والخدمات',
    emoji: '🛠️',
    desc: 'صناعة الملصقات، الترجمة الفورية، الطقس، وحساب العمليات',
    aliases: ['ادوات', 'أدوات', 'خدمات', 'tools'],
  },
  {
    id: 'group',
    label: 'إدارة الجروبات',
    emoji: '🛡️',
    desc: 'منشن جماعي، إعدادات المجموعة، الترحيب، وقوانين الجروب',
    aliases: ['جروب', 'جروبات', 'مجموعات', 'group'],
  },
  {
    id: 'protection',
    label: 'الحماية والرقابة',
    emoji: '🚫',
    desc: 'طرد، كتم، حظر، إنذارات، ومنع الروابط والسبام',
    aliases: ['حماية', 'الحماية', 'امان', 'protection'],
  },
  {
    id: 'music',
    label: 'الموسيقى والمحتوى',
    emoji: '🎧',
    desc: 'التعرف على الأغاني (شازام)، كلمات الأغاني، والروايات',
    aliases: ['موسيقى', 'مزيكا', 'صوتيات', 'music'],
  },
  {
    id: 'fun',
    label: 'فرفشة وهزار',
    emoji: '😂',
    desc: 'نكت مصرية أصيلة، الشيشة، ومزاج رايق مع استرو',
    aliases: ['فرفشة', 'هزار', 'ضحك', 'نكت', 'fun'],
  },
  {
    id: 'general',
    label: 'معلومات عامة',
    emoji: '📌',
    desc: 'كارت استرو، سرعة البوت، الدليل، وقائمة المساعدة',
    aliases: ['عام', 'معلومات', 'بايو', 'general'],
  },
  {
    id: 'owner',
    label: 'أوامر المطور',
    emoji: '👑',
    desc: 'لوحة التحكم، إحصائيات السيرفر، وإدارة النظام',
    aliases: ['مطور', 'المالك', 'owner', 'ادارة'],
  },
];

// استخراج أفضل اسم عربي للأمر
export function getArabicName(cmd) {
  const arList = ARABIC_ALIASES[cmd.name];
  if (arList?.length) return arList[0];
  const arAlias = (cmd.aliases ?? []).find((a) => /[\u0600-\u06FF]/.test(a));
  if (arAlias) return arAlias;
  return cmd.name;
}

// فحص هل الأمر يحتاج مدخلات إضافية
export function needsArgs(cmd) {
  const u = (cmd.usage ?? '').trim();
  if (!u) return false;
  const bare = `${config.prefix}${cmd.name}`.trim();
  if (u === bare) return false;
  const rest = u.startsWith(bare) ? u.slice(bare.length).trim() : u;
  if (!rest) return false;
  return /<|\[|اسم|نص|الرابط|لينك|رقم|فارغ|https?:|http:/i.test(rest) || rest.length > 0;
}

function footer() {
  return `${config.botName} ⚡ صاحبك المصري`;
}

const BACK = { label: '🔙 القائمة الرئيسية', id: '.menu' };

// إرسال تفاعلي مرن — أزرار لو مدعومة، ونص فخم جداً مدمج يضمن العرض في كل الحالات
async function send(sock, jid, { title, text, buttons = [], sections = [], selectTitle = 'اختر' }) {
  const list = [...buttons].slice(0, 10);

  try {
    const b = new MB.Button(sock);
    b.setTitle(String(title ?? '').slice(0, 60))
      .setBody(String(text ?? '').slice(0, 4000))
      .setFooter(footer());

    if (sections?.length) {
      b.addSelection(selectTitle);
      for (const s of sections) {
        b.makeSection(s.title, s.highlight_label ?? '');
        for (const r of s.rows) b.makeRow(r.header ?? r.title, r.title, r.description ?? '', r.id);
      }
    }

    for (const btn of list) {
      const label = String(btn.label).slice(0, 40);
      if (typeof btn.id === 'string' && btn.id.startsWith('copy:')) {
        b.addCopy(label, btn.id.slice(5));
      } else {
        b.addReply(label, btn.id);
      }
    }

    await b.send(jid);
  } catch (err) {
    // لو واتساب حجب الأزرار التفاعلية، بنبعت النص الفخم مباشرة
    await sock.sendMessage(jid, { text });
  }
}

// ═══ المستوى 1: القائمة الرئيسية الفخمة ═══
export async function mainMenu(sock, jid, extra = '', ctx = null) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });

  let totalUniqueCmds = 0;
  if (ctx?.categories) {
    for (const cmds of ctx.categories.values()) totalUniqueCmds += cmds.length;
  }
  const cmdsCount = totalUniqueCmds || 101;

  const textLines = [
    '╭───────────────────────────────╮',
    `│     ⚡ *بـــوت آســـتـــرو v2.0* ⚡     │`,
    '│     👑 *صاحبك ورفيقك المصري الذكي*    │',
    '╰───────────────────────────────╯',
    '',
    `🕒 *الوقت:* ${timeStr} بتوقيت مصر`,
    `🧩 *البادئة:* \`${config.prefix}\` (أو كلمني بدون نقطة عادي)`,
    `📊 *إجمالي الأوامر:* ${cmdsCount} أمر متاح ومفعل في 11 قسماً`,
    `👨‍💻 *المطور المعتمد:* أدهم (+20 127 399 0719)`,
    `👑 *المالك الأساسي:* عمرو (01044626335)`,
    '',
    '════════════════════════════════',
    '📂 *تصفح الأقسام:*',
    'اختر القسم المناسب من *القائمة المنسدلة بالأسفل* 👇',
    'أو اضغط زر *لوحة المطور* للتواصل المباشر مع المطور 👑',
    '════════════════════════════════',
  ];

  const fullText = textLines.join('\n');

  // زران رئيسيان نظيفان وفخمان تحت القائمة المنسدلة
  const buttons = [
    { label: '📂 تصفح كل الأقسام', id: '.menu all' },
    { label: '👑 لوحة المطور والتواصل', id: '.owner' },
  ];

  const sections = [
    {
      title: '📂 تصفح أقسام الأوامر الـ 11',
      rows: SECTIONS.map((s) => ({
        header: `${s.emoji} ${s.label}`,
        title: s.label,
        description: s.desc.slice(0, 50),
        id: `.menu ${s.id}`,
      })),
    },
  ];

  return send(sock, jid, {
    title: '⚡ لوحة أوامر بـوت استرو',
    text: fullText,
    buttons,
    sections,
    selectTitle: '📂 اضغط لاختيار القسم',
  });
}

// ═══ المستوى 2: أوامر قسم محدد ═══
export async function sectionMenu(sock, jid, sectionKey, ctx) {
  const normKey = sectionKey.trim().toLowerCase();

  // فحص إذا طلب كل الأوامر دفعة واحدة
  if (normKey === 'all' || normKey === 'كلها' || normKey === 'الكل' || normKey === 'كل_الاوامر') {
    return allCommandsMenu(sock, jid, ctx);
  }

  const section = SECTIONS.find(
    (s) => s.id === normKey || s.aliases.some((a) => a.toLowerCase() === normKey),
  );

  if (!section) return mainMenu(sock, jid);

  const cmds = ctx.categories.get(section.id) ?? [];
  if (!cmds.length) {
    return send(sock, jid, {
      title: `${section.emoji} ${section.label}`,
      text: `╭───「 ${section.emoji} ${section.label} 」───╮\n\n⏳ مفيش أوامر متوفرة حالياً في القسم ده.\n\n╰─────────────────────╯`,
      buttons: [BACK],
    });
  }

  const lines = [
    `╭──────『 ${section.emoji} ${section.label} 』──────╮`,
    `│ 📌 ${section.desc}`,
    `│ 📊 إجمالي الأوامر: ${cmds.length} أمر`,
    '╰───────────────────────────╯',
    '',
    '✨ *قائمة أوامر القسم:*',
    '',
  ];

  for (const cmd of cmds) {
    const arName = getArabicName(cmd);
    const desc = cmd.description ?? 'بدون وصف';
    const usage = cmd.usage ? `\n   الصيغة: \`${cmd.usage}\`` : '';
    lines.push(`• *${config.prefix}${arName}* (أو \`${config.prefix}${cmd.name}\`)\n   📝 ${desc}${usage}\n`);
  }

  lines.push('───────────────────────────');
  lines.push('💡 اضغط على زر الرجوع للعودة للقائمة الرئيسية');

  const buttons = [
    { label: '📜 كل الأقسام', id: '.menu' },
    BACK,
  ];

  return send(sock, jid, {
    title: `${section.emoji} ${section.label}`,
    text: lines.join('\n'),
    buttons,
  });
}

// ═══ عرض جميع الأوامر دفعة واحدة ═══
export async function allCommandsMenu(sock, jid, ctx) {
  const lines = [
    '╭───────────────────────────────╮',
    '│     📖 *دليل أوامر استرو الشامل*     │',
    '╰───────────────────────────────╯',
    '',
  ];

  for (const sec of SECTIONS) {
    const cmds = ctx.categories.get(sec.id) ?? [];
    if (!cmds.length) continue;

    lines.push(`\n┌──『 ${sec.emoji} ${sec.label} (${cmds.length}) 』`);
    for (const cmd of cmds) {
      const arName = getArabicName(cmd);
      lines.push(`│ ⭓ \`${config.prefix}${arName}\` — ${cmd.description ?? ''}`);
    }
    lines.push('└───');
  }

  lines.push('\n───────────────────────────────');
  lines.push('⚡ *بـوت استرو — في خدمتك دائماً* ✨');

  return send(sock, jid, {
    title: '📖 دليل أوامر استرو الشامل',
    text: lines.join('\n'),
    buttons: [BACK],
  });
}

// ═══ المستوى 3: شرح أمر مفصل + نسخ الصيغة ═══
export async function usageScreen(sock, jid, cmd, ctx) {
  const arName = getArabicName(cmd);
  const example = (cmd.usage ?? `${config.prefix}${arName}`).replace(/</g, '').replace(/>/g, ' ');

  const text = [
    `╭───「 📋 شرح الأمر: *${arName}* 」───╮`,
    '',
    `📌 *الوظيفة:* ${cmd.description ?? 'لا يوجد وصف'}`,
    `✍️ *الاسم الأساسي:* \`${config.prefix}${cmd.name}\``,
    cmd.aliases?.length ? `🔀 *الأسماء البديلة:* ${cmd.aliases.map((a) => `\`${a}\``).join(' ، ')}` : '',
    '',
    '✍️ *طريقة الاستخدام:*',
    `   \`${example}\``,
    '',
    '╰─────────────────────────────╯',
  ].filter(Boolean).join('\n');

  return send(sock, jid, {
    title: `📋 ${arName}`,
    text,
    buttons: [
      { label: '📋 نسخ الصيغة', id: `copy:${example}` },
      BACK,
    ],
  });
}
