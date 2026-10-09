import api from './api.js';
import { sendText, sendImage, sendVideo, sendVoice, sendQuickReplies } from './send.js';
import { extractImageUrl } from './tool-caller.js';
import xoCmd from '../commands/games/xo.js';
import guessCmd from '../commands/games/guess.js';
import quizCmd from '../commands/games/quiz.js';
import mathCmd from '../commands/games/math.js';
import rpsCmd from '../commands/games/rps.js';
import truthDareCmd from '../commands/games/truth-dare.js';
import hangCmd from '../commands/games/hang.js';
import scrambleCmd from '../commands/games/scramble.js';
import flagsCmd from '../commands/games/flags.js';
import songCmd from '../commands/download/song.js';
import { mainMenu, sectionMenu } from './menu.js';

/**
 * 🛠️ مواصفات الأدوات الذكية بنظام OpenAI / MCP المعياري
 * هذه القائمة تمرر للنموذج (Mercury 2.5 / Groq) ليفهم إمكانيات البوت
 * ويستدعي الأداة المناسبة ببارامتراتها الدقيقة بناءً على فهم سياق المحادثة
 */
export const AGENT_TOOLS_SPEC = [
  {
    type: 'function',
    function: {
      name: 'play_game',
      description: 'بدء أو تشغيل لعبة تفاعلية مثل إكس أو (xo)، تخمين الرقم (guess)، مسابقات (quiz)، رياضيات (math)، المشنقة (hang)، حجر ورقة مقص (rps)، صراحة وجرأة (truth_dare)، ترتيب الحروف (scramble)، خمن العلم (flags). استدعِ هذه الأداة فوراً عندما يطلب المستخدم "العب معايا" أو "شغل لعبة" أو "عايز العب" أو "اكس او" أو "xo".',
      parameters: {
        type: 'object',
        properties: {
          game: {
            type: 'string',
            enum: ['xo', 'guess', 'quiz', 'math', 'hang', 'rps', 'truth_dare', 'scramble', 'flags'],
            description: 'اسم اللعبة المطلوبة',
          },
        },
        required: ['game'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'download_song',
      description: 'البحث عن أغنية أو مهرجان أو تراك موسيقي وتحميله بصيغة صوت أو فيديو وعرض قائمة النتائج في واتساب. استدعِ هذه الأداة فوراً عندما يطلب المستخدم "حمل اغنية" أو "شغل اغنية" أو "عايز اغنية" أو "نزل اغنية" أو "مهرجان كذا" أو "اغنية كذا" أو "اسمع كذا".',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'اسم الأغنية أو التراك أو المطرب',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'رسم وتوليد صورة بالذكاء الاصطناعي بناءً على وصف المستخدم. استدعِ هذه الأداة فوراً عندما يطلب المستخدم: "ارسم", "ارسم لي", "عايز صورة", "صورة لـ", "توليد صورة", "رسمة", "اصنع صورة", "draw", "generate image".',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'وصف تفصيلي للصورة المراد رسمها بالإنجليزية أو العربية',
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_video',
      description: 'صناعة وتوليد مقطع فيديو بالذكاء الاصطناعي. استدعِ هذه الأداة فوراً عندما يطلب المستخدم: "فيديو لـ", "اعملي فيديو", "سوي فيديو", "اصنع فيديو", "توليد فيديو", "generate video".',
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
  {
    type: 'function',
    function: {
      name: 'edit_image',
      description: 'تعديل أو تغيير الصورة المرفقة أو المقتبسة بالذكاء الاصطناعي (مثل تغيير الخلفية أو إضافة عناصر).',
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
  {
    type: 'function',
    function: {
      name: 'remove_bg',
      description: 'إزالة وتفريغ خلفية الصورة المرفقة أو المقتبسة وجعلها شفافة.',
      parameters: {
        type: 'object',
        properties: {
          image_url: {
            type: 'string',
            description: 'رابط الصورة اختياري إذا لم تكن مرفقة بالرسالة',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'celebrity_voice',
      description: 'نطق جملة بصوت شخصية مشهورة أو لاعب كرة قدم (نيمار neymar، ميسي messi، غوكو goku، إيمينيم eminem، ذا روك therock، رونالدو ronaldo).',
      parameters: {
        type: 'object',
        properties: {
          voice: {
            type: 'string',
            enum: ['neymar', 'messi', 'goku', 'eminem', 'therock', 'ronaldo', 'adam'],
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
  {
    type: 'function',
    function: {
      name: 'search_media',
      description: 'البحث عن محتوى متخصص في منصات خارجية (يوتيوب youtube، تيك توك tiktok، بينترست pinterest، أفلام أكوام akwam، تطبيقات APK أندرويد apk).',
      parameters: {
        type: 'object',
        properties: {
          platform: {
            type: 'string',
            enum: ['youtube', 'tiktok', 'pinterest', 'akwam', 'apk'],
            description: 'المنصة المراد البحث فيها',
          },
          query: {
            type: 'string',
            description: 'كلمات البحث المطلوبة',
          },
        },
        required: ['platform', 'query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_menu',
      description: 'فتح قائمة الأوامر التفاعلية للبوت أو عرض قسم معين.',
      parameters: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            description: 'القسم المطلوب (ai, download, games, economy, tools, etc.) أو فارغ للرئيسية',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'group_action',
      description: 'تنفيذ أوامر إدارة ومشرفي الجروب في واتساب مثل: ترقية عضو لمشرف/أدمن (promote)، تنزيل مشرف لعضو عادي (demote)، أو طرد عضو من الجروب (kick). استدعِ هذه الأداة فوراً عندما يطلب المستخدم في الجروب: "ارفع ده مشرف", "رقي ده", "خليه ادمن", "نزله من الاشراف", "شيل الادمن", "اطرد ده", "طرد", "خرجه بره".',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['promote', 'demote', 'kick'],
            description: 'نوع الإجراء الإداري المطلوب',
          },
          target: {
            type: 'string',
            description: 'رقم أو منشن العضو المستهدف (اختياري)',
          },
        },
        required: ['action'],
      },
    },
  },
];

/**
 * ⚡ الموزع التنفيذي للأدوات (Agent Tool Dispatcher)
 * يقوم بتنفيذ الأداة الحقيقية التي استدعاها النموذج وإرسال نتيجتها مباشرة إلى الشات
 */
export async function executeAgentTool(sock, m, toolCall, profile = {}) {
  if (!toolCall) return false;

  const name = (toolCall.name || '').toLowerCase();
  const args = toolCall.arguments || {};
  console.log(`🤖 [Agent Tool Executing] -> [${name}] with args:`, JSON.stringify(args));

  // 1) تشغيل الألعاب التفاعلية
  if (name === 'play_game') {
    const game = (args.game || 'xo').toLowerCase();
    const gameMap = {
      xo: xoCmd,
      guess: guessCmd,
      quiz: quizCmd,
      math: mathCmd,
      rps: rpsCmd,
      truth_dare: truthDareCmd,
      hang: hangCmd,
      scramble: scrambleCmd,
      flags: flagsCmd,
    };
    const handler = gameMap[game] || xoCmd;
    await handler.execute(sock, m, []);
    return true;
  }

  // 2) تحميل الأغاني والمهرجانات
  if (name === 'download_song') {
    const query = String(args.query || '').trim();
    if (query) {
      await songCmd.execute(sock, m, query.split(/\s+/));
      return true;
    }
  }

  // 3) توليد ورسم الصور
  if (name === 'generate_image') {
    const prompt = String(args.prompt || '').trim();
    if (prompt) {
      await sendText(sock, m.jid, '🎨 حاضر من عيني يا فنان! ثواني وأرسمهالك بالذكاء الاصطناعي... ⏳');
      try {
        const url = await api.image(prompt);
        if (url) {
          await sendImage(sock, m.jid, url, `🎨 تم رسم: *${prompt}*\n⚡ بواسطة *استرو بـوت*`);
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
      await sendText(sock, m.jid, '😵 معلش يا صاحبي، سيرفر معالجة الفيديو بطيء شوية دلوقتي، جرب كمان دقيقة.');
      return true;
    }
  }

  // 5) تعديل الصور
  if (name === 'edit_image') {
    const prompt = String(args.prompt || '').trim();
    const imgUrl = await extractImageUrl(m);
    if (!imgUrl) {
      await sendText(sock, m.jid, '🎨 يا فنان ابعت الصورة الأول أو رد عليها عشان أقدر أعدلهالك بالذكاء الاصطناعي! 📸');
      return true;
    }
    await sendText(sock, m.jid, `🎨 جاري تعديل صورتك: *${prompt}*... ثواني يا باشا ⏳`);
    try {
      const edited = await api.vexEditImage(imgUrl, prompt);
      if (edited) {
        await sendImage(sock, m.jid, edited, `✨ تم تعديل الصورة بنجاح!\n⚡ بواسطة *استرو بـوت*`);
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

  // 7) صوت المشاهير
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

  // 8) البحث في المنصات (أكوام، APK، يوتيوب، تيك توك، بينترست)
  if (name === 'search_media') {
    const platform = (args.platform || 'youtube').toLowerCase();
    const q = String(args.query || '').trim();
    if (!q) return false;

    if (platform === 'akwam') {
      await sendText(sock, m.jid, `🍿 بدورلك في موقع أكوام على: *${q}*... ⏳`);
      const movies = await api.vexAkwam(q).catch(() => []);
      if (movies && movies.length > 0) {
        const top = movies[0];
        const caption = [
          `🍿 *${top.title}* (${top.year || ''})`,
          `⭐ *التقييم:* ${top.rating || 'غير متوفر'}`,
          `🎬 *النوع:* ${top.type || 'فيلم'} • 💿 *الجودة:* ${top.quality || 'HD'}`,
          `🔗 *رابط المشاهدة والتحميل:* ${top.url}`,
        ].join('\n');
        if (top.poster) await sendImage(sock, m.jid, top.poster, caption);
        else await sendText(sock, m.jid, caption);
        return true;
      }
      await sendText(sock, m.jid, `😕 ملقيتش الفيلم ده على أكوام، جرب تكتب اسمه بالإنجليزي أو العربي بدقة.`);
      return true;
    }

    if (platform === 'apk') {
      await sendText(sock, m.jid, `📱 بجيبلك روابط تحميل تطبيق: *${q}* من المتجر... ⏳`);
      const apps = await api.vexApk(q, 3).catch(() => []);
      if (apps && apps.length > 0) {
        const top = apps[0];
        const caption = [
          `📱 *${top.name}*`,
          `📦 *الإصدار:* ${top.version || 'الأحدث'} • 💾 *الحجم:* ${top.sizeHuman || 'غير محدد'}`,
          `⭐ *التقييم:* ${top.rating || '4.5'} • 🛡️ *الحماية:* آمن 100%`,
          `📥 *رابط التحميل المباشر:* ${top.apkUrl || top.pageUrl}`,
        ].join('\n');
        if (top.icon) await sendImage(sock, m.jid, top.icon, caption);
        else await sendText(sock, m.jid, caption);
        return true;
      }
      await sendText(sock, m.jid, `😕 ملقيتش التطبيق ده، اتأكد من الاسم وجرب تاني.`);
      return true;
    }

    if (platform === 'tiktok') {
      await sendText(sock, m.jid, `🎵 بدورلك في تيك توك عن: *${q}*... ⏳`);
      const results = await api.tiktokSearch(q).catch(() => []);
      if (results && results.length > 0) {
        const video = results[0];
        await sendVideo(sock, m.jid, video.url, `🎵 *تيك توك:* ${q}\n⚡ بواسطة *استرو بـوت*`);
        return true;
      }
    }

    if (platform === 'pinterest') {
      await sendText(sock, m.jid, `📌 بجيبلك صور من بينترست عن: *${q}*... ⏳`);
      const pins = await api.pinimg(q).catch(() => []);
      if (pins && pins.length > 0) {
        await sendImage(sock, m.jid, pins[0], `📌 *بينترست:* ${q}\n⚡ بواسطة *استرو بـوت*`);
        return true;
      }
    }

    // افتراضي: يوتيوب
    await songCmd.execute(sock, m, q.split(/\s+/));
    return true;
  }

  // 9) عرض القائمة
  if (name === 'show_menu') {
    const section = (args.section || '').trim();
    if (section) {
      await sectionMenu(sock, m.jid, section);
    } else {
      await mainMenu(sock, m.jid);
    }
    return true;
  }

  // 10) إدارة الجروب (ترقية / تنزيل / طرد)
  if (name === 'group_action') {
    if (!m.isGroup) {
      await sendText(sock, m.jid, '👥 الأوامر دي بتتنفذ جوه الجروبات بس يا صاحبي!');
      return true;
    }
    const action = String(args.action || 'promote').toLowerCase();
    const info = m.message?.extendedTextMessage?.contextInfo;
    const target = (args.target && String(args.target).includes('@'))
      ? String(args.target).trim()
      : (info?.mentionedJid?.[0] ?? info?.participant ?? null);

    if (!target) {
      await sendText(sock, m.jid, '⚠️ منشن الشخص أو اعمل رد على رسالته عشان أعرف أنفذ عليه الإجراء!');
      return true;
    }

    const { isAdmin } = await import('./protection.js');
    const { isOwner } = await import('../lib/utils.js');
    const { config } = await import('../config.js');

    const isSenderAdmin = (await isAdmin(sock, m.jid, m.sender)) || isOwner(m, config);
    if (!isSenderAdmin) {
      await sendText(sock, m.jid, '🔐 الأمر ده مخصص لأدمن الجروب فقط يا غالي.');
      return true;
    }

    const targetMention = '@' + String(target).split('@')[0];

    try {
      if (action === 'promote') {
        await sock.groupParticipantsUpdate(m.jid, [target], 'promote');
        await sock.sendMessage(m.jid, {
          text: `👑 تم ترقية ${targetMention} لمشرف الجروب بنجاح! 🎉`,
          mentions: [target],
        });
        return true;
      }
      if (action === 'demote') {
        await sock.groupParticipantsUpdate(m.jid, [target], 'demote');
        await sock.sendMessage(m.jid, {
          text: `⬇️ تم تنزيل ${targetMention} من الإشراف.`,
          mentions: [target],
        });
        return true;
      }
      if (action === 'kick') {
        await sock.groupParticipantsUpdate(m.jid, [target], 'remove');
        await sock.sendMessage(m.jid, {
          text: `🦶 تم طرد ${targetMention} من الجروب.`,
          mentions: [target],
        });
        return true;
      }
    } catch (err) {
      console.error(`⚠️ فشل تنفيذ ${action}:`, err.message);
      await sendText(sock, m.jid, '❌ مقدرتش أنفذ الأمر — اتأكد إني أدمن في الجروب وصلاحياتي كافية.');
      return true;
    }
    return true;
  }

  return false;
}

export default {
  AGENT_TOOLS_SPEC,
  executeAgentTool,
};
