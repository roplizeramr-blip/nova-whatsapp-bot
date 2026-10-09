import api from './api.js';
import { db } from './db.js';
import { getSettings, isAdmin, warnUser } from './protection.js';
import { sendText, sendImage, sendVideo, sendVoice, sendQuickReplies } from './send.js';
import { extractImageUrl } from './tool-caller.js';
import { mainMenu, sectionMenu } from './menu.js';
import { getCommandsRegistry } from './loader.js';
import { normalizeArabic } from './arabic.js';
import { isOwner } from '../lib/utils.js';
import { config } from '../config.js';

/**
 * 🛠️ مواصفات الأدوات الذكية الشاملة بنظام OpenAI / MCP المعياري
 * تغطي كافة أقسام البوت الـ 11 وإجمالي 105 أوامر، لتمكين الإيجنت (Mercury 2.5 / Groq)
 * من فهم وتنفيذ وإدارة كل ميزة بذكاء وسرعة.
 */
export const AGENT_TOOLS_SPEC = [
  // 1) الألعاب والتحديات التفاعلية (15 لعبة)
  {
    type: 'function',
    function: {
      name: 'play_game',
      description: 'بدء أو تشغيل أي لعبة تفاعلية في واتساب مثل: إكس أو (xo)، تخمين الرقم (guess)، مسابقات عامة (quiz)، رياضيات (math)، المشنقة (hang)، حجر ورقة مقص (rps)، صراحة وجرأة (truth_dare)، ترتيب الحروف (scramble)، خمن العلم (flags)، مبارزة ثنائية (duel)، لعبة القرش (coinflip)، لعبة الألوان (color)، سباق السرعة (race)، مين ده (guesswho)، أو مهمة اليوم (dailyquest). استدعِ هذه الأداة فوراً عند طلب المستخدم "العب معايا" أو "شغل لعبة" أو "عايز العب كذا".',
      parameters: {
        type: 'object',
        properties: {
          game: {
            type: 'string',
            enum: [
              'xo', 'guess', 'quiz', 'math', 'hang', 'rps', 'truth_dare',
              'scramble', 'flags', 'duel', 'coinflip', 'color', 'race',
              'guesswho', 'dailyquest'
            ],
            description: 'اسم اللعبة المطلوبة',
          },
        },
        required: ['game'],
      },
    },
  },

  // 2) التحميل والوسائط (10 منصات)
  {
    type: 'function',
    function: {
      name: 'download_media',
      description: 'تحميل أي محتوى وسائط أو موسيقى من الإنترنت (أغاني MP3، فيديوهات تيك توك بدون علامة مائية، يوتيوب، إنستغرام ريلز وبوستات، فيسبوك، سبوتيفاي، ميديافاير، أو أي رابط مباشر). استدعِ هذه الأداة فوراً عند طلب "حمل اغنية", "نزل فيديو", "هات مهرجان", "حمل من تيك توك", أو إرسال رابط تحميل.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'اسم الأغنية أو التراك المطلوب، أو رابط التحميل المباشر',
          },
          type: {
            type: 'string',
            enum: ['auto', 'song', 'video', 'tiktok', 'instagram', 'facebook', 'spotify', 'mediafire'],
            description: 'نوع الوسائط أو المنصة المفضلة',
          },
        },
        required: ['query'],
      },
    },
  },

  // 3) توليد الصور
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'رسم وتوليد صورة بالذكاء الاصطناعي بناءً على وصف تفصيلي. استدعِ هذه الأداة فوراً عند طلب: "ارسم", "ارسم لي", "عايز صورة", "صورة لـ", "توليد صورة", "draw", "generate image".',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'الوصف التفصيلي للصورة المراد رسمها',
          },
        },
        required: ['prompt'],
      },
    },
  },

  // 4) صناعة الفيديو
  {
    type: 'function',
    function: {
      name: 'generate_video',
      description: 'صناعة وتوليد مقطع فيديو بالذكاء الاصطناعي. استدعِ هذه الأداة فوراً عند طلب: "فيديو لـ", "اعملي فيديو", "سوي فيديو", "اصنع فيديو", "generate video".',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'وصف مشهد الفيديو المراد صناعته',
          },
          ratio: {
            type: 'string',
            enum: ['16:9', '9:16'],
            description: 'أبعاد الفيديو: 16:9 شاشات بالعرض، أو 9:16 ريلز/طولي',
          },
        },
        required: ['prompt'],
      },
    },
  },

  // 5) تعديل الصور
  {
    type: 'function',
    function: {
      name: 'edit_image',
      description: 'تعديل أو تغيير الصورة المرفقة أو المقتبسة أو السابقة في الشات بالذكاء الاصطناعي بواسطة برومبت. استدعِ هذه الأداة فوراً عند طلب: "عدل الصورة", "غير فيها", "خليها كذا", "ضيف كذا", "edit image".',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'الوصف الدقيق للتعديل المطلوب على الصورة',
          },
        },
        required: ['prompt'],
      },
    },
  },

  // 6) إزالة الخلفية
  {
    type: 'function',
    function: {
      name: 'remove_bg',
      description: 'إزالة وتفريغ خلفية الصورة المرفقة أو المقتبسة وجعلها شفافة بالذكاء الاصطناعي.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },

  // 7) البنك والاقتصاد والمحفظة (10 أوامر)
  {
    type: 'function',
    function: {
      name: 'economy_action',
      description: 'التحكم في البنك والمحفظة ونظام الاقتصاد والنقاط والجوائز في البوت. استدعِ هذه الأداة عند طلب: "رصيدي", "فلوسي", "مكافأتي اليومية", "البنك", "إيداع", "سحب", "المتجر", "اشتري", "حول كوينز", "المتصدرين", "رتبتي", "رول", "سلوت", "أوسمة".',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'balance', 'daily', 'bank_deposit', 'bank_withdraw', 'bank_balance',
              'shop', 'buy', 'transfer', 'top', 'rank', 'roll', 'slot', 'badges'
            ],
            description: 'نوع العملية الاقتصادية المطلوبة',
          },
          amount: {
            type: 'number',
            description: 'المبلغ المالي أو عدد الكوينز (للإيداع أو السحب أو التحويل أو الرهان)',
          },
          target: {
            type: 'string',
            description: 'رقم أو منشن العضو المستهدف بالتحويل',
          },
          item: {
            type: 'string',
            description: 'اسم العنصر المراد شراؤه من المتجر',
          },
        },
        required: ['action'],
      },
    },
  },

  // 8) إدارة المجموعات وإعداداتها (9 أوامر)
  {
    type: 'function',
    function: {
      name: 'group_management',
      description: 'إدارة المجموعة وإعداداتها في واتساب: فتح أو قفل الجروب، رابط الجروب أو تجديده، طرد عضو، ترقية لمشرف، تنزيل مشرف، لوحة الإعدادات، تفعيل/تعطيل الترحيب أو الوداع، أو وضع الشات الذكي.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'open', 'close', 'link', 'revoke', 'kick', 'promote',
              'demote', 'settings', 'welcome', 'goodbye', 'aichat', 'morning'
            ],
            description: 'الإجراء الإداري المطلوب تنفيذه على الجروب',
          },
          target: {
            type: 'string',
            description: 'رقم أو منشن العضو المستهدف بالطرد أو الترقية أو التنزيل',
          },
        },
        required: ['action'],
      },
    },
  },

  // 9) الحماية والرقابة والإنذارات (12 أمر)
  {
    type: 'function',
    function: {
      name: 'moderation_protection',
      description: 'تنفيذ أوامر الحماية والرقابة والإنذارات في المجموعة: توجيه إنذار لعضو، عرض سجل الإنذارات، كتم عضو، فك الكتم، حظر عضو من البوت، فك الحظر، منشن للكل، تاج مخفي، أو عرض قائمة مشرفي الجروب.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'warn', 'warns', 'mute', 'unmute', 'ban', 'unban',
              'tagall', 'hidetag', 'admins', 'antilink', 'antiflood', 'blacklist'
            ],
            description: 'نوع إجراء الحماية أو الرقابة المطلوب',
          },
          target: {
            type: 'string',
            description: 'رقم أو منشن العضو المستهدف',
          },
          text: {
            type: 'string',
            description: 'سبب الإنذار أو الحظر، أو نص الرسالة للمنشن الجماعي',
          },
        },
        required: ['action'],
      },
    },
  },

  // 10) الأدوات والخدمات المساعدة (16 أمر)
  {
    type: 'function',
    function: {
      name: 'tools_utility',
      description: 'تشغيل واستخدام أدوات وخدمات البوت المساعدة: صناعة ملصق ستيكر من صورة (sticker)، ترجمة نصوص لأي لغة (translate)، البحث عن تطبيقات وألعاب APK وتحميلها (apk)، جلب كلمات الأغاني (lyrics)، فحص هوية رقم هاتف (checknum)، ضبط تذكير بموعد (reminder)، تلخيص وشرح وتحليل نصوص (smart)، حساب وتشغيل كود (run)، نطق جملة بصوت ذكي (say / voice)، صور بينترست (pin)، أو صور متحركة (gif).',
      parameters: {
        type: 'object',
        properties: {
          tool: {
            type: 'string',
            enum: [
              'sticker', 'translate', 'apk', 'lyrics', 'checknum',
              'reminder', 'smart', 'run', 'say', 'voice', 'animevoice',
              'pin', 'gif', 'describe'
            ],
            description: 'اسم الأداة المطلوبة',
          },
          query: {
            type: 'string',
            description: 'النص أو الكلمات المراد البحث عنها أو ترجمتها أو حسابها أو نطقها',
          },
          target_lang: {
            type: 'string',
            description: 'لغة الهدف للترجمة (ar, en, fr, de, es...)',
          },
        },
        required: ['tool'],
      },
    },
  },

  // 11) الفرفشة والترفيه وأكوام
  {
    type: 'function',
    function: {
      name: 'entertainment_fun',
      description: 'الفرفشة والضحك والترفيه: نكتة مصرية أصيلة (joke)، جلسة شيشة افتراضية (hookah)، أو البحث عن أحدث الأفلام والمسلسلات وروابط تحميلها من أكوام (akwam).',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['joke', 'hookah', 'akwam'],
            description: 'نوع الترفيه المطلوب',
          },
          query: {
            type: 'string',
            description: 'اسم الفيلم أو المسلسل للبحث في أكوام',
          },
        },
        required: ['type'],
      },
    },
  },

  // 12) الموسيقى والمحتوى المتخصص
  {
    type: 'function',
    function: {
      name: 'music_content',
      description: 'التعرف على الأغاني والموسيقى (شازام shazam من مقطع صوتي مقتبس)، البحث عن روايات وكتب (novel)، قراءة فصول المانجا (manga)، أو عزل وفصل الصوت عن الموسيقى (vocal).',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['shazam', 'novel', 'manga', 'vocal'],
            description: 'النوع المطلوب',
          },
          query: {
            type: 'string',
            description: 'اسم الرواية أو المانجا للبحث',
          },
        },
        required: ['action'],
      },
    },
  },

  // 13) صوت المشاهير
  {
    type: 'function',
    function: {
      name: 'celebrity_voice',
      description: 'نطق جملة بصوت شخصية مشهورة أو لاعب كرة قدم (نيمار neymar، ميسي messi، غوكو goku، إيمينيم eminem، ذا روك therock، رونالدو ronaldo، دريك drake).',
      parameters: {
        type: 'object',
        properties: {
          voice: {
            type: 'string',
            enum: ['neymar', 'messi', 'goku', 'eminem', 'therock', 'ronaldo', 'drake', 'adam', 'antoni'],
            description: 'الشخصية الصوتية المطلوبة',
          },
          text: {
            type: 'string',
            description: 'النص المراد نطقه بالصوت',
          },
        },
        required: ['voice', 'text'],
      },
    },
  },

  // 14) إعدادات واستعلامات النظام والمنيو
  {
    type: 'function',
    function: {
      name: 'bot_system',
      description: 'إعدادات واستعلامات نظام البوت: قياس سرعة الاستجابة (ping)، إحصائيات البوت (stats)، تغيير نمط الشخصية (mode)، لغة التخاطب (language)، أو فتح القائمة التفاعلية للأوامر (show_menu).',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['ping', 'stats', 'mode', 'language', 'show_menu'],
            description: 'الإجراء النظامي المطلوب',
          },
          value: {
            type: 'string',
            description: 'القسم المطلوب للمنيو، أو النمط المفضل للشخصية، أو كود اللغة',
          },
        },
        required: ['action'],
      },
    },
  },

  // 15) إرسال رسالة خاصة لجهة اتصال محددة
  {
    type: 'function',
    function: {
      name: 'send_message',
      description: 'إرسال رسالة واتساب إلى شخص أو جهة اتصال محددة (مثل شروق، أدهم، عمرو، أو رقم هاتف). استدعِ هذه الأداة فوراً عند طلب المستخدم: "ابعت لـ...", "رسالة لـ...", "ارسل لشروق...", "send message to...".',
      parameters: {
        type: 'object',
        properties: {
          recipient: {
            type: 'string',
            description: 'اسم الشخص المستهدف (شروق، أدهم، عمرو) أو رقم هاتفه بالصيغة الدولية أو المحلية',
          },
          message: {
            type: 'string',
            description: 'نص الرسالة المراد توصيلها للمستلم',
          },
        },
        required: ['recipient', 'message'],
      },
    },
  },

  // 🌐 16) أداة التنفيذ الشاملة (Universal Command Execution Bridge)
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'الأداة الشاملة لتنفيذ أي أمر من كافة أوامر البوت الـ 105 ديناميكياً بمدخلاته. استخدم هذه الأداة لتنفيذ أي أمر محدد في البوت مثل .bank deposit 500 أو .poll أو .akwam أو .sticker أو .reminder أو أي أمر لم تغطه الأدوات السابقة.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'اسم الأمر بالإنجليزية أو العربية (مثل: bank, poll, mystats, kick, sticker, ping, akwam...)',
          },
          args: {
            type: 'string',
            description: 'المدخلات والمعطيات التابعة للأمر إن وجدت (مثال: "deposit 500" أو "en مرحبا" أو رابط أو نص)',
          },
        },
        required: ['command'],
      },
    },
  },

  // للتوافق العكسي مع أية استدعاءات قديمة
  {
    type: 'function',
    function: {
      name: 'download_song',
      description: 'البحث عن أغنية أو مهرجان وتحميله بصيغة صوت أو فيديو.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'اسم الأغنية' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_media',
      description: 'البحث عن محتوى متخصص (يوتيوب، تيك توك، بينترست، أكوام، تطبيقات APK).',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['youtube', 'tiktok', 'pinterest', 'akwam', 'apk'] },
          query: { type: 'string' },
        },
        required: ['platform', 'query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'group_action',
      description: 'تنفيذ أوامر إدارية في الجروب (promote, demote, kick).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['promote', 'demote', 'kick'] },
          target: { type: 'string' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'warn_user',
      description: 'توجيه إنذار رسمي لعضو في الجروب.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'make_sticker',
      description: 'تحويل الصورة إلى ملصق واتساب.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_menu',
      description: 'عرض قائمة الأوامر التفاعلية.',
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string' },
        },
      },
    },
  },
];

/**
 * 🎯 استخراج وتوحيد JID العضو المستهدف بدقة
 */
export function resolveTargetJid(m, rawTarget) {
  const info = m.message?.extendedTextMessage?.contextInfo;
  if (info?.mentionedJid && info.mentionedJid.length > 0) {
    return info.mentionedJid[0];
  }
  if (info?.participant) {
    return info.participant;
  }
  if (rawTarget) {
    const s = String(rawTarget).trim().replace(/^@/, '');
    if (s.endsWith('@s.whatsapp.net') || s.endsWith('@lid')) {
      return s;
    }
    const digits = s.replace(/\D/g, '');
    if (digits.length >= 8) {
      return `${digits}@s.whatsapp.net`;
    }
  }
  return null;
}

/**
 * ⚡ الموزع العام لتشغيل أي أمر بوت عبر سجل الأوامر المركزي (Universal Dispatcher)
 */
export async function dispatchBotCommand(sock, m, cmdName, args = [], ctx = {}) {
  const { commands } = getCommandsRegistry();
  if (!commands || commands.size === 0) {
    console.warn(`[Agent Dispatch] سجل الأوامر غير متوفر حالياً`);
    return false;
  }

  const cleanName = String(cmdName || '').trim().replace(/^\./, '').toLowerCase();
  const norm = normalizeArabic(cleanName);
  const cmd = commands.get(cleanName) || commands.get(norm);

  if (!cmd) {
    console.warn(`[Agent Dispatch] لم يتم العثور على الأمر: "${cmdName}"`);
    return false;
  }

  // 🎛️ فحص صلاحيات المجموعة لفئات الأوامر
  if (m.isGroup) {
    const s = getSettings(m.jid);
    const cat = cmd.category || '';
    if ((cat === 'download' || cat === 'music') && s.download === false) {
      await sendText(sock, m.jid, '❌ أوامر التحميل والوسائط معطلة في هذا الجروب بقرار من المشرفين.');
      return true;
    }
    if (cat === 'games' && s.games === false) {
      await sendText(sock, m.jid, '❌ الألعاب والتحديات معطلة في هذا الجروب بقرار من المشرفين.');
      return true;
    }
    if (cat === 'ai' && s.ai === false) {
      await sendText(sock, m.jid, '❌ أوامر الذكاء الاصطناعي معطلة في هذا الجروب بقرار من المشرفين.');
      return true;
    }
    if (cat === 'tools' && s.tools === false) {
      await sendText(sock, m.jid, '❌ الأدوات والخدمات معطلة في هذا الجروب بقرار من المشرفين.');
      return true;
    }
    if (['tagall', 'hidetag'].includes(cmd.name) && s.mentions === false) {
      await sendText(sock, m.jid, '❌ أوامر المنشن الجماعي معطلة في هذا الجروب.');
      return true;
    }
  }

  // 👑 فحص صلاحيات المطور
  if (cmd.ownerOnly && !isOwner(m, config)) {
    await sendText(sock, m.jid, '👑 الأمر ده مخصص لمالك البوت فقط يا غالي.');
    return true;
  }

  // 🛡️ فحص صلاحيات أدمن الجروب
  if (cmd.adminOnly && m.isGroup) {
    const isSenderAdmin = (await isAdmin(sock, m.jid, m.sender)) || isOwner(m, config);
    if (!isSenderAdmin) {
      await sendText(sock, m.jid, '🔐 الأمر ده مخصص لمشرفي وأدمن الجروب فقط.');
      return true;
    }
  }

  const argsArr = Array.isArray(args) ? args : String(args || '').trim().split(/\s+/).filter(Boolean);
  const syntheticM = {
    ...m,
    args: [cmd.name, ...argsArr],
    body: `${config.prefix}${cmd.name} ${argsArr.join(' ')}`.trim(),
  };

  try {
    console.log(`⚡ [Agent Dispatch -> ${cmd.name}] مع مدخلات:`, JSON.stringify(argsArr));
    await cmd.execute(sock, syntheticM, argsArr, ctx);
    return true;
  } catch (err) {
    console.error(`❌ [Agent Dispatch] خطأ في أمر ${cmd.name}:`, err.message);
    await sendText(sock, m.jid, `⚠️ حصل خطأ وأنا بنفذ أمر ${cmd.name} — جرب تاني.`);
    return true;
  }
}

/**
 * ⚡ الموزع التنفيذي للأدوات (Agent Tool Dispatcher)
 * يقوم بتنفيذ الأداة الحقيقية التي استدعاها النموذج وإرسال نتيجتها مباشرة إلى الشات
 */
export async function executeAgentTool(sock, m, toolCall, profile = {}, ctx = {}) {
  if (!toolCall) return false;

  const name = (toolCall.name || '').toLowerCase();
  const args = toolCall.arguments || {};
  console.log(`🤖 [Agent Tool Executing] -> [${name}] with args:`, JSON.stringify(args));

  // 🎛️ فحص صلاحيات المجموعة لأدوات الإيجنت التلقائية
  if (m.isGroup) {
    const s = getSettings(m.jid);
    if (name === 'play_game' && s.games === false) {
      await sendText(sock, m.jid, '❌ الألعاب معطلة في هذا الجروب بقرار من المشرفين.');
      return true;
    }
    if ((name === 'download_song' || name === 'download_media' || name === 'search_media') && s.download === false) {
      await sendText(sock, m.jid, '❌ أوامر التحميل والبحث معطلة في هذا الجروب بقرار من المشرفين.');
      return true;
    }
    if ((name === 'generate_image' || name === 'generate_video') && s.ai === false) {
      await sendText(sock, m.jid, '❌ التوليد بالذكاء الاصطناعي معطل في هذا الجروب بقرار من المشرفين.');
      return true;
    }
  }

  // 1) تشغيل الألعاب التفاعلية (15 لعبة)
  if (name === 'play_game') {
    const game = String(args.game || 'xo').toLowerCase();
    return await dispatchBotCommand(sock, m, game, [], ctx);
  }

  // 2) التحميل والوسائط
  if (name === 'download_media' || name === 'download_song') {
    const query = String(args.query || '').trim();
    const type = String(args.type || 'auto').toLowerCase();
    if (!query) return false;

    if (type === 'song' || (!query.startsWith('http') && type === 'auto')) {
      return await dispatchBotCommand(sock, m, 'song', query.split(/\s+/), ctx);
    }
    return await dispatchBotCommand(sock, m, 'universal', [query], ctx);
  }

  // 3) توليد ورسم الصور
  if (name === 'generate_image') {
    const prompt = String(args.prompt || '').trim();
    if (prompt) {
      await sendText(sock, m.jid, '🎨 حاضر من عيني يا فنان! ثواني وأرسمهالك بالذكاء الاصطناعي... ⏳');
      try {
        const imgResult = await api.image(prompt);
        if (imgResult) {
          if (typeof imgResult === 'string') {
            const chatImages = db.get('chatImages', {});
            chatImages[m.jid] = { url: imgResult, prompt, at: Date.now() };
            db.set('chatImages', chatImages);
          }
          await sendImage(sock, m.jid, imgResult, `🎨 تم رسم: *${prompt}*\n⚡ بواسطة *استرو بـوت*`);

          const shortP = prompt.length > 50 ? prompt.slice(0, 50) : prompt;
          await sendQuickReplies(sock, m.jid, {
            title: '🎨 خيارات الصورة',
            text: 'تحب تعمل إيه في الصورة دي؟',
            buttons: [
              { label: '🎬 تحويل إلى فيديو', id: `.video ${shortP}` },
              { label: '🎨 رسم نسخة ثانية', id: `.image ${shortP}` },
            ],
          });
          return true;
        }
      } catch (err) {
        console.error('⚠️ فشل رسم الصورة:', err.message);
      }
      await sendText(sock, m.jid, '😵 معلش يا غالي، سيرفر الرسم عليه ضغط دلوقتي — جرب تاني بعد لحظات.');
      return true;
    }
  }

  // 4) صناعة وتوليد الفيديوهات
  if (name === 'generate_video') {
    const prompt = String(args.prompt || '').trim();
    const ratio = args.ratio === '9:16' ? '9:16' : '16:9';
    if (prompt) {
      await sendText(sock, m.jid, `🎬 أحلى فيديو لعيونك يا صاحبي! جاري التصميم بأبعاد ${ratio}... ثواني ⏳`);
      try {
        const videoRes = await api.video(prompt, { ratio });
        const videoUrl = typeof videoRes === 'string' ? videoRes : videoRes?.url;
        if (videoUrl) {
          await sendVideo(sock, m.jid, videoUrl, `🎬 فيديو: *${prompt}*\n⚡ تم الصنع بواسطة *استرو بـوت*`);
          return true;
        }
      } catch (err) {
        console.error('⚠️ فشل توليد الفيديو:', err.message);
      }

      const shortP = prompt.length > 50 ? prompt.slice(0, 50) : prompt;
      await sendQuickReplies(sock, m.jid, {
        title: '🎬 تعذر إنشاء الفيديو',
        text: '⚠️ يا غالي، سيرفر تحريك الفيديو بالذكاء الاصطناعي عليه صيانة وضغط حالياً في المصدر.\nتقدر ترسم المشهد كصورة HD أو تجرب الفيديو تاني بعد شوية:',
        buttons: [
          { label: '🎨 رسم المشهد كصورة HD', id: `.image ${shortP}` },
          { label: '🎬 إعادة محاولة الفيديو', id: `.video ${shortP}` },
        ],
      });
      return true;
    }
  }

  // 5) تعديل الصور بالذكاء الاصطناعي
  if (name === 'edit_image') {
    const prompt = String(args.prompt || '').trim();
    let imgUrl = await extractImageUrl(m);

    if (!imgUrl) {
      const chatImages = db.get('chatImages', {});
      const cached = chatImages[m.jid];
      if (cached && (Date.now() - (cached.at || 0) < 1800000)) {
        imgUrl = cached.url;
      }
    }

    if (!imgUrl) {
      await sendText(sock, m.jid, '🎨 يا فنان ابعت الصورة الأول أو رد عليها عشان أقدر أعدلهالك بالذكاء الاصطناعي! 📸');
      return true;
    }

    await sendText(sock, m.jid, `🎨 جاري تعديل صورتك: *${prompt}*... ثواني يا باشا ⏳`);
    try {
      let edited = null;
      if (imgUrl) {
        edited = await api.vexEditImage(imgUrl, prompt).catch(() => null);
      }
      let isFallback = false;
      if (!edited) {
        edited = await api.image(prompt);
        isFallback = true;
      }

      if (edited) {
        const chatImages = db.get('chatImages', {});
        chatImages[m.jid] = { url: edited, prompt, at: Date.now() };
        db.set('chatImages', chatImages);

        const caption = isFallback
          ? `✨ تم تجسيد وتعديل الصورة: *${prompt}*\n⚡ بواسطة *استرو بـوت*`
          : `✨ تم تعديل الصورة بنجاح: *${prompt}*\n⚡ بواسطة *استرو بـوت*`;
        await sendImage(sock, m.jid, edited, caption);
        return true;
      }
    } catch (err) {
      console.error('⚠️ فشل تعديل الصورة:', err.message);
    }
    await sendText(sock, m.jid, '😵 تعذر تعديل الصورة حالياً — جرب برومبت تانية.');
    return true;
  }

  // 6) تفريغ خلفية الصورة
  if (name === 'remove_bg') {
    const imgUrl = await extractImageUrl(m);
    if (!imgUrl) {
      await sendText(sock, m.jid, '✂️ ابعت الصورة أو رد عليها عشان أشيلك الخلفية فوراً يا غالي!');
      return true;
    }
    await sendText(sock, m.jid, '✂️ ثواني وبفرغلك خلفية الصورة بجودة عالية... ⏳');
    try {
      const noBg = await api.removeBg(imgUrl);
      if (noBg) {
        await sendImage(sock, m.jid, noBg, '✨ تم إزالة الخلفية بنجاح! ⚡');
        return true;
      }
    } catch (err) {
      console.error('⚠️ فشل تفريغ الخلفية:', err.message);
    }
    await sendText(sock, m.jid, '😵 حصل خطأ في سيرفر تفريغ الخلفية، جرب صورة تانية.');
    return true;
  }

  // 7) البنك والاقتصاد والمحفظة
  if (name === 'economy_action') {
    const action = String(args.action || 'balance').toLowerCase();
    const amount = args.amount;
    const target = args.target;
    const item = args.item;

    switch (action) {
      case 'daily':
        return await dispatchBotCommand(sock, m, 'daily', [], ctx);
      case 'balance':
        return await dispatchBotCommand(sock, m, 'mystats', [], ctx);
      case 'bank_deposit':
        return await dispatchBotCommand(sock, m, 'bank', ['deposit', amount ? String(amount) : ''], ctx);
      case 'bank_withdraw':
        return await dispatchBotCommand(sock, m, 'bank', ['withdraw', amount ? String(amount) : ''], ctx);
      case 'bank_balance':
        return await dispatchBotCommand(sock, m, 'bank', ['balance'], ctx);
      case 'shop':
        return await dispatchBotCommand(sock, m, 'shop', [], ctx);
      case 'buy':
        return await dispatchBotCommand(sock, m, 'shop', ['buy', item || ''], ctx);
      case 'transfer':
        return await dispatchBotCommand(sock, m, 'transfer', [amount ? String(amount) : '', target || ''].filter(Boolean), ctx);
      case 'top':
        return await dispatchBotCommand(sock, m, 'top', [], ctx);
      case 'rank':
        return await dispatchBotCommand(sock, m, 'rank', [], ctx);
      case 'roll':
        return await dispatchBotCommand(sock, m, 'roll', [], ctx);
      case 'slot':
        return await dispatchBotCommand(sock, m, 'slot', [amount ? String(amount) : '10'], ctx);
      case 'badges':
        return await dispatchBotCommand(sock, m, 'badges', [], ctx);
      default:
        return await dispatchBotCommand(sock, m, 'mystats', [], ctx);
    }
  }

  // 8) إدارة المجموعات
  if (name === 'group_management' || name === 'group_action') {
    const action = String(args.action || 'settings').toLowerCase();
    const target = resolveTargetJid(m, args.target);

    switch (action) {
      case 'open':
        return await dispatchBotCommand(sock, m, 'group', ['open'], ctx);
      case 'close':
        return await dispatchBotCommand(sock, m, 'group', ['close'], ctx);
      case 'link':
        return await dispatchBotCommand(sock, m, 'group', ['link'], ctx);
      case 'revoke':
        return await dispatchBotCommand(sock, m, 'group', ['revoke'], ctx);
      case 'kick':
        return await dispatchBotCommand(sock, m, 'kick', [target || ''], ctx);
      case 'promote':
        return await dispatchBotCommand(sock, m, 'promote', [target || ''], ctx);
      case 'demote':
        return await dispatchBotCommand(sock, m, 'demote', [target || ''], ctx);
      case 'welcome':
        return await dispatchBotCommand(sock, m, 'welcome', [], ctx);
      case 'goodbye':
        return await dispatchBotCommand(sock, m, 'goodbye', [], ctx);
      case 'aichat':
        return await dispatchBotCommand(sock, m, 'aichat', [], ctx);
      case 'morning':
        return await dispatchBotCommand(sock, m, 'morning', [], ctx);
      case 'settings':
      default:
        return await dispatchBotCommand(sock, m, 'gsettings', [], ctx);
    }
  }

  // 9) الحماية والرقابة والإنذارات
  if (name === 'moderation_protection' || name === 'warn_user') {
    const action = String(args.action || (name === 'warn_user' ? 'warn' : 'warns')).toLowerCase();
    const target = resolveTargetJid(m, args.target);
    const text = String(args.text || args.reason || '').trim();

    switch (action) {
      case 'warn':
        return await dispatchBotCommand(sock, m, 'warn', [target || '', text].filter(Boolean), ctx);
      case 'warns':
        return await dispatchBotCommand(sock, m, 'warns', [target || ''].filter(Boolean), ctx);
      case 'mute':
        return await dispatchBotCommand(sock, m, 'mute', [target || ''].filter(Boolean), ctx);
      case 'unmute':
        return await dispatchBotCommand(sock, m, 'unmute', [target || ''].filter(Boolean), ctx);
      case 'ban':
        return await dispatchBotCommand(sock, m, 'ban', [target || ''].filter(Boolean), ctx);
      case 'unban':
        return await dispatchBotCommand(sock, m, 'unban', [target || ''].filter(Boolean), ctx);
      case 'tagall':
        return await dispatchBotCommand(sock, m, 'tagall', text ? text.split(/\s+/) : [], ctx);
      case 'hidetag':
        return await dispatchBotCommand(sock, m, 'hidetag', text ? text.split(/\s+/) : [], ctx);
      case 'admins':
        return await dispatchBotCommand(sock, m, 'admins', [], ctx);
      case 'antilink':
        return await dispatchBotCommand(sock, m, 'antilink', [], ctx);
      case 'antiflood':
        return await dispatchBotCommand(sock, m, 'antiflood', [], ctx);
      case 'blacklist':
        return await dispatchBotCommand(sock, m, 'blacklist', text ? text.split(/\s+/) : [], ctx);
      default:
        return await dispatchBotCommand(sock, m, 'warns', [target || ''].filter(Boolean), ctx);
    }
  }

  // 10) الأدوات والخدمات المساعدة
  if (name === 'tools_utility' || name === 'make_sticker') {
    const tool = String(args.tool || (name === 'make_sticker' ? 'sticker' : 'smart')).toLowerCase();
    const q = String(args.query || '').trim();
    const targetLang = String(args.target_lang || 'ar').trim();

    switch (tool) {
      case 'sticker':
        return await dispatchBotCommand(sock, m, 'sticker', [], ctx);
      case 'translate':
        return await dispatchBotCommand(sock, m, 'translate', [targetLang, q].filter(Boolean), ctx);
      case 'apk':
        return await dispatchBotCommand(sock, m, 'apk', q.split(/\s+/), ctx);
      case 'lyrics':
        return await dispatchBotCommand(sock, m, 'lyrics', q.split(/\s+/), ctx);
      case 'checknum':
        return await dispatchBotCommand(sock, m, 'checknum', [q], ctx);
      case 'reminder':
        return await dispatchBotCommand(sock, m, 'reminder', q.split(/\s+/), ctx);
      case 'smart':
        return await dispatchBotCommand(sock, m, 'smart', q.split(/\s+/), ctx);
      case 'run':
        return await dispatchBotCommand(sock, m, 'run', q.split(/\s+/), ctx);
      case 'say':
        return await dispatchBotCommand(sock, m, 'say', q.split(/\s+/), ctx);
      case 'voice':
        return await dispatchBotCommand(sock, m, 'voice', [q], ctx);
      case 'animevoice':
        return await dispatchBotCommand(sock, m, 'animevoice', q.split(/\s+/), ctx);
      case 'pin':
        return await dispatchBotCommand(sock, m, 'pin', q.split(/\s+/), ctx);
      case 'gif':
        return await dispatchBotCommand(sock, m, 'gif', q.split(/\s+/), ctx);
      case 'describe':
        return await dispatchBotCommand(sock, m, 'describe', [], ctx);
      default:
        return await dispatchBotCommand(sock, m, 'smart', q.split(/\s+/), ctx);
    }
  }

  // 11) الفرفشة والترفيه وأكوام
  if (name === 'entertainment_fun') {
    const type = String(args.type || 'joke').toLowerCase();
    const q = String(args.query || '').trim();
    if (type === 'joke') return await dispatchBotCommand(sock, m, 'joke', [], ctx);
    if (type === 'hookah') return await dispatchBotCommand(sock, m, 'hookah', [], ctx);
    if (type === 'akwam') return await dispatchBotCommand(sock, m, 'akwam', q.split(/\s+/), ctx);
  }

  // 12) الموسيقى والمحتوى
  if (name === 'music_content') {
    const action = String(args.action || 'shazam').toLowerCase();
    const q = String(args.query || '').trim();
    if (action === 'shazam') return await dispatchBotCommand(sock, m, 'shazam', [], ctx);
    if (action === 'novel') return await dispatchBotCommand(sock, m, 'novel', q.split(/\s+/), ctx);
    if (action === 'manga') return await dispatchBotCommand(sock, m, 'manga', q.split(/\s+/), ctx);
    if (action === 'vocal') return await dispatchBotCommand(sock, m, 'vocal', [], ctx);
  }

  // 13) صوت المشاهير
  if (name === 'celebrity_voice') {
    const voice = (args.voice || 'neymar').toLowerCase();
    const textToSpeak = String(args.text || '').trim();
    if (textToSpeak) {
      try {
        const audioUrl = await api.vexTts(textToSpeak, voice);
        if (audioUrl) {
          await sendVoice(sock, m.jid, audioUrl);
          return true;
        }
      } catch (err) {
        console.error('⚠️ فشل صوت المشاهير:', err.message);
      }
      await sendText(sock, m.jid, `🎙️ مقدرتش أنطق بصوت ${voice} دلوقتي، جرب تاني بعد شوية.`);
      return true;
    }
  }

  // 14) إعدادات واستعلامات النظام والمنيو
  if (name === 'bot_system' || name === 'show_menu') {
    const action = String(args.action || 'show_menu').toLowerCase();
    const val = String(args.value || args.section || '').trim();

    if (action === 'ping') return await dispatchBotCommand(sock, m, 'ping', [], ctx);
    if (action === 'stats') return await dispatchBotCommand(sock, m, 'stats', [], ctx);
    if (action === 'mode') return await dispatchBotCommand(sock, m, 'mode', [val], ctx);
    if (action === 'language') return await dispatchBotCommand(sock, m, 'language', [val], ctx);

    if (val) {
      await sectionMenu(sock, m.jid, val, ctx);
    } else {
      await mainMenu(sock, m.jid, '', ctx);
    }
    return true;
  }

  // 15) إرسال رسالة خاصة لشخص
  if (name === 'send_message') {
    const rawRecipient = String(args.recipient || '').trim().toLowerCase();
    const messageToSend = String(args.message || '').trim();

    if (!messageToSend) {
      await sendText(sock, m.jid, '💌 قولي عايزني أبعتله إيه بالظبط يا صاحبي؟');
      return true;
    }

    let targetJid = null;
    let targetName = args.recipient || 'المستلم';

    if (/شروق|shorouk|shrouk/i.test(rawRecipient)) {
      targetJid = '201002135088@s.whatsapp.net';
      targetName = 'شروق';
    } else if (/ادهم|أدهم|adham/i.test(rawRecipient)) {
      targetJid = '201273990719@s.whatsapp.net';
      targetName = 'أدهم';
    } else if (/عمرو|amr/i.test(rawRecipient)) {
      targetJid = '201044626335@s.whatsapp.net';
      targetName = 'عمرو';
    } else {
      const digits = rawRecipient.replace(/\D/g, '');
      if (digits.length >= 10) {
        const fullNum = digits.startsWith('0') ? `2${digits}` : (digits.startsWith('2') ? digits : `20${digits}`);
        targetJid = `${fullNum}@s.whatsapp.net`;
        targetName = digits;
      }
    }

    if (!targetJid) {
      await sendText(sock, m.jid, `🤔 معرفتش أوصل لرقم "${args.recipient}" يا صاحبي، اتأكد من الاسم (شروق / أدهم / عمرو) أو اكتب رقمه.`);
      return true;
    }

    try {
      const senderName = profile?.name && profile.name !== 'unknown'
        ? profile.name
        : (String(m.sender).includes('263488291246130') || String(m.sender).includes('201273990719') ? 'أدهم' : (m.pushName || 'صاحبك'));

      await sock.sendMessage(targetJid, {
        text: `💌 *رسالة واصلالك من ${senderName}:*\n\n"${messageToSend}"\n\n⚡ _تم التوصيل بواسطة استرو بـوت_`,
      });

      const confirmText = `💌 حاضر من عيني يا صاحبي! بعت رسالتك لـ *${targetName}* في الخاص:\n\n"${messageToSend}"\n\nوصلتها خلاص وعيوني ليك دايماً ❤️✨`;
      if (m.isGroup) {
        await sendText(sock, m.jid, confirmText, { quoted: m.msg });
      } else {
        await sendText(sock, m.jid, confirmText);
      }
      return true;
    } catch (err) {
      console.error('⚠️ فشل إرسال الرسالة للمستلم:', err.message);
      await sendText(sock, m.jid, `❌ حصلت مشكلة وأنا ببعت الرسالة لـ ${targetName} — جرب تاني كمان شوية.`);
      return true;
    }
  }

  // 🌐 16) أداة التنفيذ الشاملة (Universal Command Execution Bridge)
  if (name === 'execute_command') {
    const cmdName = String(args.command || '').trim();
    const cmdArgs = String(args.args || '').trim();
    if (!cmdName) {
      await sendText(sock, m.jid, '⚠️ يرجى تحديد اسم الأمر المراد تنفيذه.');
      return true;
    }
    const executed = await dispatchBotCommand(sock, m, cmdName, cmdArgs.split(/\s+/).filter(Boolean), ctx);
    if (!executed) {
      await sendText(sock, m.jid, `🤔 ملقتش أمر بالاسم ده "${cmdName}". تقدر تفتح .menu عشان تشوف قائمة الأوامر المتاحة.`);
      return true;
    }
    return true;
  }

  // 17) بحث المنصات المتخصصة القديم (للتوافق)
  if (name === 'search_media') {
    const platform = (args.platform || 'youtube').toLowerCase();
    const q = String(args.query || '').trim();
    if (!q) return false;

    if (platform === 'akwam') {
      return await dispatchBotCommand(sock, m, 'akwam', q.split(/\s+/), ctx);
    }
    if (platform === 'apk') {
      return await dispatchBotCommand(sock, m, 'apk', q.split(/\s+/), ctx);
    }
    if (platform === 'tiktok') {
      return await dispatchBotCommand(sock, m, 'ttsearch', q.split(/\s+/), ctx);
    }
    if (platform === 'pinterest') {
      return await dispatchBotCommand(sock, m, 'pin', q.split(/\s+/), ctx);
    }
    return await dispatchBotCommand(sock, m, 'song', q.split(/\s+/), ctx);
  }

  return false;
}

export default {
  AGENT_TOOLS_SPEC,
  executeAgentTool,
  dispatchBotCommand,
  resolveTargetJid,
};
