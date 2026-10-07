import api from './api.js';
import { sendText, sendImage, sendVideo, sendVoice, sendQuickReplies } from './send.js';
import { db } from './db.js';
import { speak } from './tts.js';
import { imageToUrl } from './protection.js';

// 🤖 AI Tool Calling & Intent Orchestrator لـ Astro / Nova
// يكتشف نوايا وأفعال المستخدم الطبيعية في المحادثة وينفذ الأدوات التفاعلية فوراً

/**
 * توحيد ومعايرة النص العربي والإنجليزي للتعرف الدقيق
 */
export function normalizeText(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F\u0670]/g, '') // حذف التشكيل
    .replace(/[،,.:;!؟?]/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * تنظيف نداءات البوت وكلمات المجاملة الزائدة
 */
export function cleanUserInput(str) {
  let s = String(str || '').trim();
  // إزالة مناداة البوت
  s = s.replace(/^(?:يا\s*(?:استرو|نوفا|بوت|عم\s*استرو|عم\s*نوفا)|astro|nova)\s*[,:،-]?\s*/i, '');
  // إزالة كلمات الرجاء والمجاملات
  s = s.replace(/^(?:لو\s*سمحت|من\s*فضلك|بالله\s*عليك|بليز|ارجوك|أرجوك|عايزك|عاوزك|ممكن|تقدر|please|can\s*you|could\s*you)\s*[,:،-]?\s*/i, '');
  s = s.replace(/[,:،-]?\s*(?:لو\s*سمحت|من\s*فضلك|بالله\s*عليك|بليز|ارجوك|أرجوك|please)$/i, '');
  return s.trim();
}

/**
 * فحص ما إذا كانت الرسالة الحالية تحتوي على صورة أو تقتبس صورة
 * @param {object} m - كائن الرسالة
 * @returns {boolean}
 */
export function hasAttachedImage(m) {
  if (!m) return false;
  return Boolean(
    m?.message?.imageMessage ||
    m?.msg?.imageMessage ||
    m?.msg?.message?.imageMessage ||
    m?.imageMessage ||
    m?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ||
    m?.quoted?.message?.imageMessage ||
    m?.quoted?.imageMessage ||
    m?.quoted?.isImage
  );
}

// قائمة المشاهير والشخصيات الصوتية المدعومة وألقابهم الشائعة
const CELEBRITY_VOICE_MAP = [
  { id: 'messi', aliases: ['ميسي', 'ليونيل ميسي', 'ليو ميسي', 'messi', 'lionel messi'] },
  { id: 'goku', aliases: ['غوكو', 'كوكو', 'جوكو', 'goku', 'son goku'] },
  { id: 'eminem', aliases: ['ايمينيم', 'امينيم', 'eminem', 'slim shady'] },
  { id: 'therock', aliases: ['ذا روك', 'روك', 'the rock', 'therock', 'صخرة', 'دواين جونسون', 'dwayne johnson'] },
  { id: 'neymar', aliases: ['نيمار', 'نيمار جونيور', 'neymar', 'neymar jr'] },
  { id: 'mbappe', aliases: ['مبابي', 'كيليان مبابي', 'mbappe', 'kylian mbappe'] },
  { id: 'kanye', aliases: ['كانيه', 'كاني', 'كانيي', 'كانيه ويست', 'كاني ويست', 'kanye', 'kanye west'] },
  { id: 'drake', aliases: ['دريك', 'drake'] },
  { id: 'snoop', aliases: ['سنوب', 'سنوب دوج', 'سنوب دوغ', 'سنوب دوجي', 'snoop', 'snoop dogg'] },
  { id: 'ronaldo', aliases: ['رونالدو', 'كريستيانو', 'الدون', 'ronaldo', 'cr7'] },
  { id: 'trump', aliases: ['ترامب', 'دونالد ترامب', 'trump', 'donald trump'] },
  { id: 'biden', aliases: ['بايدن', 'جو بايدن', 'biden', 'joe biden'] },
  { id: 'bellingham', aliases: ['بيلينغهام', 'بيلينجهام', 'bellingham'] },
];

/**
 * فحص وتصنيف نية المستخدم (Intent Detection)
 * @param {string} rawText - النص الأصلي للرسالة
 * @param {object} [m=null] - كائن الرسالة للتحقق من المرفقات والصور المقتبسة
 * @returns {object|null} النية المكتشفة مع بارامتراتها المنظفة
 */
export function detectIntent(rawText, m = null) {
  const norm = normalizeText(rawText);
  if (!norm) return null;

  // ─────────────────────────────────────────────────────────────
  // 1. 🎙️ Celebrity & Athlete Voice Intent (صوت المشاهير والرياضيين والأنمي)
  // "قول بصوت ميسي", "اتكلم بصوت ميسي", "بصوت غوكو", "بصوت ايمينيم", "بصوت ذا روك", "بصوت نيمار", "بصوت مبابي", "بصوت كانيه", "بصوت دريك", "بصوت سنوب"
  // ─────────────────────────────────────────────────────────────
  const ttsPrefixRegex = /^(?:قول|اتكلم|انطق|احكي|غرد|say|speak)?\s*(?:لي\s+|ليا\s+)?(?:بصوت|صوت|in(?:\s+the)?\s+voice\s+of|as)\s+(.+)$/i;
  const ttsPrefixMatch = norm.match(ttsPrefixRegex);
  if (ttsPrefixMatch) {
    const remainder = ttsPrefixMatch[1].trim();
    let matchedVoice = null;
    let textAfterVoice = '';

    // البحث عن تطابق مع المشاهير المعروفين
    for (const item of CELEBRITY_VOICE_MAP) {
      for (const alias of item.aliases) {
        const nAlias = normalizeText(alias);
        if (
          remainder === nAlias ||
          remainder.startsWith(nAlias + ' ') ||
          remainder.startsWith(nAlias + ':') ||
          remainder.startsWith(nAlias + '،') ||
          remainder.startsWith(nAlias + '-')
        ) {
          matchedVoice = item.id;
          textAfterVoice = remainder.slice(nAlias.length).trim().replace(/^[:،,-]\s*/, '');
          break;
        }
      }
      if (matchedVoice) break;
    }

    // إذا لم تكن شخصية في القائمة، نأخذ الكلمة الأولى كاسم شخصية عامة
    if (!matchedVoice) {
      const fallbackMatch = remainder.match(/^([ء-يa-zA-Z0-9]+)(?:[\s:،,-]+(.*))?$/);
      if (fallbackMatch) {
        matchedVoice = fallbackMatch[1].trim();
        textAfterVoice = (fallbackMatch[2] || '').trim();
      }
    }

    if (matchedVoice) {
      // استخراج النص الأصلي بدقة للحفاظ على الحروف الكبيرة والإنجليزية
      let cleanText = textAfterVoice;
      const rawAfterVoice = rawText.match(/(?:بصوت|صوت|in(?:\s+the)?\s+voice\s+of|as)\s+[^\s:،,-]+(?:\s+[^\s:،,-]+)?[\s:،,-]+(.+)$/i);
      if (rawAfterVoice && rawAfterVoice[1]) {
        cleanText = rawAfterVoice[1].trim();
      }

      return {
        type: 'celebrity_tts',
        voice: matchedVoice,
        character: matchedVoice,
        text: cleanText,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 2. 🎨 Image Editing Intent (تعديل وتغيير الصور بالذكاء الاصطناعي)
  // Triggers: "عدل الصورة", "عدلي الصورة", "غير الصورة", "خلي الصورة", "عدل دي", "غير الخلفية لـ", "edit image", "modify image", "change image"
  // ─────────────────────────────────────────────────────────────
  const imageEditTriggers = [
    'عدل الصورة', 'عدلي الصورة', 'عدللي الصورة', 'عدل لي الصورة', 'عدل في الصورة', 'عدل علي الصورة', 'عدل على الصورة',
    'غير الصورة', 'غيرلي الصورة', 'غير لي الصورة',
    'خلي الصورة', 'خليلي الصورة', 'خلي لي الصورة',
    'عدل دي', 'عدلي دي', 'عدللي دي', 'عدل لي دي',
    'غير الخلفية لـ', 'غير الخلفيه لـ', 'غير الخلفية ل', 'غير الخلفيه ل', 'غير الخلفية', 'غير الخلفيه', 'غير خلفية لـ', 'غير خلفيه لـ', 'غير خلفية ل', 'غير خلفيه ل', 'غير خلفية', 'غير خلفيه',
    'edit image', 'edit the image', 'edit this image', 'edit photo', 'edit the photo', 'edit picture',
    'modify image', 'modify the image', 'modify photo', 'modify picture',
    'change image', 'change the image', 'change photo', 'change picture',
  ];

  const hasImageEditTrigger = imageEditTriggers.some((tr) => norm.includes(normalizeText(tr)));
  if (hasImageEditTrigger) {
    let prompt = cleanUserInput(rawText);
    for (const tr of imageEditTriggers) {
      const reg = new RegExp(tr.replace(/[\s\-_]+/g, '[\\s\\-_]+'), 'gi');
      prompt = prompt.replace(reg, ' ');
    }
    prompt = prompt
      .trim()
      .replace(/^(?:دي\s+|هذه\s+|الصورة\s+|الصوره\s+)/i, '')
      .replace(/^(?:و\s+|وخليها\s+|وخلي\s+|خليها\s+|خليه\s+|لـ|ل\s+|عن|to\s+|into\s+)/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      type: 'image_edit',
      prompt,
      hasImage: hasAttachedImage(m),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 3. 📱 APK Search/Download Intent (تطبيقات وبرامج أندرويد)
  // Triggers: "حمللي تطبيق", "حملي تطبيق", "عايز تطبيق", "هاتلي برنامج", "عايز برنامج", "نزل تطبيق", "ابحث عن تطبيق", "تطبيق كذا", "download apk", "get app"
  // ─────────────────────────────────────────────────────────────
  const apkTriggers = [
    'حمللي تطبيق', 'حملي تطبيق', 'حمل لي تطبيق', 'حمل تطبيق',
    'حمللي برنامج', 'حملي برنامج', 'حمل لي برنامج', 'حمل برنامج',
    'عايز تطبيق', 'عاوز تطبيق', 'بدي تطبيق', 'محتاج تطبيق',
    'هاتلي برنامج', 'هات لي برنامج', 'هات برنامج',
    'هاتلي تطبيق', 'هات لي تطبيق', 'هات تطبيق',
    'عايز برنامج', 'عاوز برنامج', 'بدي برنامج', 'محتاج برنامج',
    'نزل تطبيق', 'نزلي تطبيق', 'نزللي تطبيق', 'نزل لي تطبيق',
    'نزل برنامج', 'نزلي برنامج', 'نزللي برنامج', 'نزل لي برنامج',
    'ابحث عن تطبيق', 'ابحثلي عن تطبيق', 'ابحث عن برنامج', 'ابحثلي عن برنامج',
    'دور على تطبيق', 'دورلي على تطبيق', 'دور على برنامج', 'دورلي على برنامج',
    'download apk', 'download app', 'get app', 'get apk',
  ];

  const hasApkTrigger = apkTriggers.some((tr) => norm.includes(normalizeText(tr)));
  const directApkMatch = norm.match(/^(?:تطبيق|برنامج|app|apk)\s+(.+)$/i);

  if (hasApkTrigger || directApkMatch) {
    let query = cleanUserInput(rawText);
    for (const tr of apkTriggers) {
      const reg = new RegExp(tr.replace(/[\s\-_]+/g, '[\\s\\-_]+'), 'gi');
      query = query.replace(reg, ' ');
    }
    query = query
      .trim()
      .replace(/^(?:تطبيق|برنامج|app|apk)\s+/i, '')
      .replace(/^(?:لـ|ل\s+|عن|اسم\s+|for\s+)/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      type: 'apk_search',
      query: query || (directApkMatch ? directApkMatch[1].trim() : ''),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 4. 🍿 Akwam Movie/Series Intent (أفلام ومسلسلات موقع أكوام)
  // Triggers: "عايز فيلم", "ابحث عن فيلم", "هات فيلم", "مسلسل كذا", "فيلم كذا على اكوام", "فيلم كذا", "watch movie", "find movie"
  // ─────────────────────────────────────────────────────────────
  const movieTriggers = [
    'عايز فيلم', 'عاوز فيلم', 'بدي فيلم', 'محتاج فيلم',
    'عايز مسلسل', 'عاوز مسلسل', 'بدي مسلسل', 'محتاج مسلسل',
    'ابحث عن فيلم', 'ابحثلي عن فيلم', 'ابحث عن مسلسل', 'ابحثلي عن مسلسل',
    'دور على فيلم', 'دورلي على فيلم', 'دور على مسلسل', 'دورلي على مسلسل',
    'هات فيلم', 'هاتلي فيلم', 'هات لي فيلم',
    'هات مسلسل', 'هاتلي مسلسل', 'هات لي مسلسل',
    'watch movie', 'watch a movie', 'watch film', 'watch series',
    'find movie', 'find a movie', 'find film', 'find series',
    'search movie', 'get movie',
  ];

  const hasMovieTrigger = movieTriggers.some((tr) => norm.includes(normalizeText(tr)));
  const directMovieMatch = norm.match(/^(?:فيلم|مسلسل)\s+(.+)$/i);
  const akwamKeywordMatch = /(?:فيلم|مسلسل)\s+.+?\s+(?:علي|على|في|من)\s+(?:اكوام|أكوام)/i.test(norm);

  if (hasMovieTrigger || directMovieMatch || akwamKeywordMatch) {
    let query = cleanUserInput(rawText);
    for (const tr of movieTriggers) {
      const reg = new RegExp(tr.replace(/[\s\-_]+/g, '[\\s\\-_]+'), 'gi');
      query = query.replace(reg, ' ');
    }
    query = query
      .replace(/[\s\-_]*(?:علي|على|في|من)\s+(?:اكوام|أكوام|موقع\s+اكوام|موقع\s+أكوام)[\s\-_]*/gi, ' ')
      .trim()
      .replace(/^(?:فيلم|مسلسل|movie|series|film)\s+/i, '')
      .replace(/^(?:لـ|ل\s+|عن|اسم\s+|of\s+|about\s+)/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      type: 'movie_search',
      query,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 5. 📝 كلمات الأغاني (Song Lyrics)
  // "كلمات اغنية...", "كلمات تراك...", "lyrics of..."
  // ─────────────────────────────────────────────────────────────
  const lyricsPattern = /^(?:عايز|عاوز|بدي|محتاج|هات|جيب|ابحث\s+عن|ابحثلي\s+عن|وريني)?\s*كلمات\s+(?:اغنيه|تراك|انشوده|لحن|song)?\s*(?:لـ|ل|عن)?\s*(.+)$/i;
  const lyricsEnPattern = /^(?:lyrics\s+(?:of|for)|song\s+lyrics(?:\s+for)?)\s*(.+)$/i;
  if (lyricsPattern.test(norm) || lyricsEnPattern.test(norm)) {
    let clean = norm
      .replace(/^(?:عايز|عاوز|بدي|محتاج|هات|جيب|ابحث\s+عن|ابحثلي\s+عن|وريني)\s*/, '')
      .replace(/^كلمات\s*(?:اغنيه|تراك|انشوده|لحن|song)?\s*(?:لـ|ل|عن)?\s*/, '')
      .replace(/^(?:lyrics\s+(?:of|for)|song\s+lyrics(?:\s+for)?)\s*/, '')
      .trim();

    // استخراج من النص الأصلي للحفاظ على الحروف الإنجليزية بدقة
    let originalQuery = cleanUserInput(rawText)
      .replace(/^(?:عايز|عاوز|بدي|محتاج|هات|جيب|ابحث\s+عن|ابحثلي\s+عن|وريني)\s*/i, '')
      .replace(/^كلمات\s*(?:اغنية|أغنية|اغنيه|تراك|انشودة|أنشودة|song)?\s*(?:لـ|ل|عن)?\s*/i, '')
      .replace(/^(?:lyrics\s+(?:of|for)|song\s+lyrics(?:\s+for)?)\s*/i, '')
      .trim();

    return {
      type: 'lyrics',
      query: originalQuery || clean,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 6. 🔍 أدوات البحث (تيك توك، بينترست، يوتيوب)
  // ─────────────────────────────────────────────────────────────
  // a) تيك توك: "ابحثلي في تيك توك عن...", "ابحث في تيك توك عن...", "دور في تيك توك عن..."
  const ttSearchPattern = /(?:ابحثلي|ابحث\s+لي|ابحث|دورلي|دور\s+لي|دور|سيرش|search)\s+(?:في|علي|على|بـ|ب)?\s*(?:تيك\s*توك|tiktok)\s*(?:عن|علي|على|for)?\s*(.+)/i;
  const ttDirectPattern = /^(?:تيك\s*توك|tiktok)\s+(?:عن|for)\s*(.+)$/i;
  if (ttSearchPattern.test(norm) || ttDirectPattern.test(norm)) {
    let query = cleanUserInput(rawText)
      .replace(/.*?(?:تيك\s*توك|tiktok)\s*(?:عن|علي|على|for)?\s*/i, '')
      .trim();
    return {
      type: 'tiktok_search',
      query,
    };
  }

  // b) بينترست: "صور من بينترست عن...", "ابحث في بينترست عن...", "صور بينترست عن..."
  const pinSearchPattern = /(?:صور(?:ه)?\s+(?:من\s+)?|ابحثلي\s+في\s+|ابحث\s+في\s+|دور\s+في\s+|سيرش\s+)?(?:بينترست|بنترست|بينتريست|pinterest)\s*(?:عن|لـ|ل|for|of)?\s*(.+)/i;
  if (/بينترست|بنترست|بينتريست|pinterest/i.test(norm) && pinSearchPattern.test(norm)) {
    let query = cleanUserInput(rawText)
      .replace(/.*?(?:بينترست|بنترست|بينتريست|pinterest)\s*(?:عن|لـ|ل|for|of)?\s*/i, '')
      .trim();
    return {
      type: 'pinterest_search',
      query,
    };
  }

  // c) يوتيوب: "ابحث في يوتيوب عن...", "ابحثلي في يوتيوب عن...", "دور في يوتيوب عن..."
  const ytSearchPattern = /(?:ابحثلي|ابحث\s+لي|ابحث|دورلي|دور\s+لي|دور|سيرش|search)\s+(?:في|علي|على|بـ|ب)?\s*(?:يوتيوب|اليوتيوب|youtube|yt)\s*(?:عن|علي|على|for)?\s*(.+)/i;
  const ytDirectPattern = /^(?:يوتيوب|youtube)\s+(?:عن|for)\s*(.+)$/i;
  if (ytSearchPattern.test(norm) || ytDirectPattern.test(norm)) {
    let query = cleanUserInput(rawText)
      .replace(/.*?(?:يوتيوب|اليوتيوب|youtube|yt)\s*(?:عن|علي|على|for)?\s*/i, '')
      .trim();
    return {
      type: 'youtube_search',
      query,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 7. 🎬 Video Generation (صناعة الفيديو بالذكاء الاصطناعي)
  // "اعمللي فيديو", "سويلي فيديو", "عايز فيديو", "فيديو لـ", "توليد فيديو", "اصنع فيديو", "make video", "generate video"
  // ─────────────────────────────────────────────────────────────
  const videoTriggers = [
    'اعمللي فيديو', 'اعمل لي فيديو', 'اعملي فيديو', 'اعمل فيديو',
    'سويلي فيديو', 'سوي لي فيديو', 'سوي فيديو',
    'عايز فيديو', 'عاوز فيديو', 'بدي فيديو', 'محتاج فيديو',
    'فيديو لـ', 'فيديو ل', 'فيديو عن',
    'توليد فيديو', 'ولد فيديو', 'اصنعلي فيديو', 'اصنع لي فيديو', 'اصنع فيديو', 'صمملي فيديو', 'صمم فيديو', 'انشئ فيديو', 'أنشئ فيديو',
    'make video', 'make a video', 'generate video', 'generate a video', 'create video', 'create a video', 'video of',
  ];

  const hasVideoTrigger = videoTriggers.some((tr) => norm.includes(normalizeText(tr)));
  if (hasVideoTrigger) {
    // كشف أبعاد الفيديو: بالطول / ريلز / تيك توك / ستوري -> 9:16 ، غير ذلك -> 16:9
    const isPortrait = /(?:بالطول|طولي|ريلز|ريل|تيك\s*توك|تيكتوك|ستوري|قصة|portrait|vertical|reels|reel|tiktok|story|9:16|9\/16)/i.test(rawText);
    const ratio = isPortrait ? '9:16' : '16:9';

    // تنظيف الوصف من كلمات التشغيل والأبعاد
    let prompt = cleanUserInput(rawText);
    // إزالة عبارات التوليد
    for (const tr of videoTriggers) {
      const reg = new RegExp(tr.replace(/[\s\-_]+/g, '[\\s\\-_]+'), 'gi');
      prompt = prompt.replace(reg, ' ');
    }
    // إزالة كلمات الأبعاد
    const ratioPattern = /(?:^|\s+)(?:بالطول|طولي|ريلز|ريل|تيك\s*توك|تيكتوك|ستوري|قصة|بالعرض|عرضي|افقي|أفقي|portrait|vertical|landscape|horizontal|reels|reel|tiktok|story|9:16|16:9|9\/16|16\/9)(?=\s+|$)/gi;
    while (ratioPattern.test(prompt)) {
      prompt = prompt.replace(ratioPattern, ' ');
    }
    prompt = prompt
      .trim()
      .replace(/^(?:لـ|ل\s+|عن|of\s+|about\s+)/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      type: 'video_gen',
      prompt,
      ratio,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 8. 🎨 Image Generation (رسم الصور بالذكاء الاصطناعي)
  // "ارسم لي", "ارسم", "عايز صورة", "اعملي صورة", "صورة لـ", "توليد صورة", "draw me", "generate image"
  // ─────────────────────────────────────────────────────────────
  const imageTriggers = [
    'ارسم لي صورة', 'ارسم لي', 'ارسملي', 'ارسم ليا', 'ارسم صورة', 'ارسم',
    'عايز صورة', 'عاوز صورة', 'بدي صورة', 'محتاج صورة',
    'اعمللي صورة', 'اعملي صورة', 'اعمل لي صورة', 'اعمل صورة',
    'سويلي صورة', 'سوي لي صورة', 'سوي صورة',
    'صورة لـ', 'صورة ل', 'صورة عن',
    'توليد صورة', 'ولد صورة', 'اصنع صورة', 'صمم صورة',
    'draw me', 'draw a', 'draw', 'paint me', 'paint',
    'generate image', 'generate an image', 'create image', 'create an image', 'make an image',
    'image of', 'picture of',
  ];

  // تأكد ألا يكون فيديو أولاً
  const hasImageTrigger = imageTriggers.some((tr) => {
    const ntr = normalizeText(tr);
    // لو الكلمة "ارسم" أو "draw"، نتأكد من مطابقتها كبداية أو كلمة مستقلة
    if (ntr === 'ارسم' || ntr === 'draw' || ntr === 'paint') {
      return new RegExp(`(?:^|\\s)${ntr}(?:\\s|$)`).test(norm);
    }
    return norm.includes(ntr);
  });

  if (hasImageTrigger) {
    let prompt = cleanUserInput(rawText);
    for (const tr of imageTriggers) {
      const reg = new RegExp(`(^|\\s)${tr.replace(/[\\s\\-_]+/g, '[\\s\\-_]+')}(\\s|$)`, 'gi');
      prompt = prompt.replace(reg, ' ');
    }
    prompt = prompt
      .trim()
      .replace(/^(?:لـ|ل\s+|عن|of\s+|about\s+)/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      type: 'image_gen',
      prompt,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 9. 🎵 Song & Music Search/Download (الأغاني والموسيقى)
  // "حملي اغنية", "شغللي اغنية", "عايز اغنية", "اسمع اغنية", "هات اغنية", "نزل اغنية"
  // ─────────────────────────────────────────────────────────────
  const songTriggers = [
    'حمللي اغنية', 'حملي اغنية', 'حمل لي اغنية', 'حمل اغنية', 'حمللي تراك', 'حمل تراك',
    'شغللي اغنية', 'شغل لي اغنية', 'شغل اغنية', 'شغللي تراك', 'شغل تراك',
    'عايز اغنية', 'عاوز اغنية', 'بدي اغنية', 'محتاج اغنية',
    'اسمع اغنية', 'عايز اسمع اغنية', 'عاوز اسمع اغنية', 'اسمعني اغنية',
    'هات اغنية', 'هاتلي اغنية', 'هات لي اغنية',
    'نزل اغنية', 'نزل لي اغنية', 'نزلي اغنية', 'نزل تراك', 'نزلي تراك',
    'play song', 'download song', 'get song', 'listen to song',
  ];

  const hasSongTrigger = songTriggers.some((tr) => norm.includes(normalizeText(tr)));
  if (hasSongTrigger) {
    let query = cleanUserInput(rawText);
    for (const tr of songTriggers) {
      const reg = new RegExp(tr.replace(/[\s\-_]+/g, '[\\s\\-_]+'), 'gi');
      query = query.replace(reg, ' ');
    }
    query = query
      .trim()
      .replace(/^(?:لـ|ل\s+|عن|بتاعت|حق|of\s+|for\s+)/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      type: 'song_download',
      query,
    };
  }

  return null;
}

/**
 * 🚀 الموزع الذكي لتنفيذ الأدوات (Tool Dispatcher)
 * @param {object} sock - اتصال Baileys
 * @param {object} m - كائن الرسالة
 * @param {string} text - نص الرسالة
 * @param {object} profile - بروفايل المستخدم
 * @returns {Promise<boolean>} true إذا تم التعرف على الأداة وتنفيذها، false للمحادثة العادية
 */
export async function dispatchToolAction(sock, m, text, profile) {
  if (!text || typeof text !== 'string') return false;

  const intent = detectIntent(text, m);
  if (!intent) return false;

  console.log(`🎯 [Tool-Caller] تم اكتشاف أداة ذكية: ${intent.type} للرسالة: "${text.slice(0, 50)}"`);

  // ─────────────────────────────────────────────────────────────
  // a) Image Editing Intent (تعديل الصور بالذكاء الاصطناعي)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'image_edit') {
    let imageUrl = null;
    try {
      imageUrl = (await imageToUrl(m).catch(() => null)) || (m.quoted ? await imageToUrl(m.quoted).catch(() => null) : null);
    } catch {
      imageUrl = null;
    }

    // إذا لم تكن هناك صورة مرفقة أو مقتبسة
    if (!imageUrl) {
      await sendText(
        sock,
        m.jid,
        '🖼️ ابعتلي الصورة أو رد عليها بطلب التعديل يا فنان عشان أعدلهالك بالذكاء الاصطناعي! 🎨✨\nمثال: رد على صورتك واكتب "عدل الصورة خليها أنمي"',
      );
      return true;
    }

    const cleanPrompt = intent.prompt || 'تعديل وتحسين الصورة بالذكاء الاصطناعي';

    // رسالة الانتظار بلهجة مصرية محببة
    await sendText(sock, m.jid, '🎨 حاضر يا فنان! جاري تعديل صورتك بالذكاء الاصطناعي... ⏳');

    try {
      let editedUrl = await api.vexEditImage(imageUrl, cleanPrompt);
      let isFallback = false;
      if (!editedUrl) {
        editedUrl = (await api.vexAiImage(cleanPrompt, { model: 'flux' })) || (await api.image(cleanPrompt));
        isFallback = true;
      }
      if (!editedUrl) throw new Error('لم يرجع رابط صورة من سيرفر التعديل');

      await sendImage(sock, m.jid, editedUrl, `🎨 *${cleanPrompt}*${isFallback ? '\n✨ (تم تجسيدها بالذكاء الاصطناعي Flux)' : ''}`);

      // أزرار المتابعة التفاعلية
      await sendQuickReplies(sock, m.jid, {
        title: '🎨 خيارات الصورة',
        text: 'عجبك التعديل يا فنان؟ تقدر تحول الصورة لفيديو أو ترسم نسخة ثانية بالذكاء الاصطناعي 👇',
        buttons: [
          { label: '🎬 تحويل إلى فيديو', id: `اعمللي فيديو ${cleanPrompt}` },
          { label: '🎨 رسم نسخة ثانية', id: `ارسم لي ${cleanPrompt}` },
        ],
      });
    } catch (err) {
      console.warn('⚠️ فشل تعديل الصورة المباشر، جاري التوليد الاحتياطي:', err.message);
      try {
        const fallback = await api.image(cleanPrompt);
        if (fallback) {
          await sendImage(sock, m.jid, fallback, `🎨 *${cleanPrompt}*`);
          return true;
        }
      } catch {}
      await sendText(
        sock,
        m.jid,
        '🥴 معلش يا فنان، سيرفر تعديل الصور مضغوط دلوقتي أو الصورة غير واضحة، جرّب تاني بعد لحظات!',
      );
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // b) APK Search/Download Intent (تطبيقات وبرامج أندرويد)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'apk_search') {
    const cleanQuery = intent.query;

    if (!cleanQuery || cleanQuery.length < 2) {
      await sendText(
        sock,
        m.jid,
        '📱 قولي اسم التطبيق أو اللعبة اللي عايز تبحث عنها يا غالي! 🚀\nمثال: "عايز تطبيق WhatsApp" أو "حمللي تطبيق سناب شات"',
      );
      return true;
    }

    // رسالة الانتظار
    await sendText(sock, m.jid, '📱 ثواني يا غالي، بجيبلك ملف التطبيق الأصلي من المتجر... ⏳');

    try {
      const results = await api.vexApk(cleanQuery, 3).catch(() => []);
      if (!results || !results.length) {
        await sendText(
          sock,
          m.jid,
          `😕 ملقتش تطبيق "${cleanQuery}" في المتجر يا صاحبي، اتأكد من كتابة الاسم صح وجرب تاني!`,
        );
        return true;
      }

      // حفظ في الكاش عشان الأزرار
      const all = db.get('searchCache', {});
      all[m.jid] = { type: 'apk', results, at: Date.now() };
      db.set('searchCache', all);

      const details = results.slice(0, 3).map((app, i) => {
        const sizeStr = app.sizeHuman ? ` • 📦 ${app.sizeHuman}` : '';
        const verStr = app.version ? ` (v${app.version})` : '';
        const ratingStr = app.rating ? ` • ⭐ ${app.rating}` : '';
        const devStr = app.developer ? `\n👤 المطور: ${app.developer}` : '';
        const linkStr = app.apkUrl ? `\n🔗 التحميل المباشر: ${app.apkUrl}` : (app.pageUrl ? `\n🔗 الصفحة: ${app.pageUrl}` : '');
        return `${i + 1}. 📱 *${app.name}*${verStr}${sizeStr}${ratingStr}${devStr}${linkStr}`;
      }).join('\n\n───────────────────\n\n');

      const buttons = results.slice(0, 3).map((app, i) => ({
        label: `📥 تحميل ${String(app.name).slice(0, 20)}`,
        id: `.apk dl-${i}`,
      }));

      await sendQuickReplies(sock, m.jid, {
        title: `📱 نتائج تطبيق: ${cleanQuery.slice(0, 25)}`,
        text: `${details}\n\nاختر التطبيق لتحميله فوراً 👇`,
        buttons,
      });
    } catch (err) {
      console.error('❌ فشل بحث التطبيقات في tool-caller:', err.message);
      await sendText(sock, m.jid, '🥴 تعذر البحث عن التطبيق حالياً، جرب تاني كمان شوية!');
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // c) Akwam Movie/Series Intent (أفلام ومسلسلات أكوام)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'movie_search') {
    const cleanQuery = intent.query;

    if (!cleanQuery || cleanQuery.length < 2) {
      await sendText(
        sock,
        m.jid,
        '🍿 قولي اسم الفيلم أو المسلسل اللي عايز تسهر عليه يا نجم! 🎬\nمثال: "عايز فيلم The Batman" أو "مسلسل قيامة عثمان"',
      );
      return true;
    }

    // رسالة الانتظار
    await sendText(sock, m.jid, '🍿 أحلى سهرة سينمائية لعيونك! بدورلك في أكوام على الفيلم... ⏳');

    try {
      const results = await api.vexAkwam(cleanQuery).catch(() => []);
      if (!results || !results.length) {
        await sendText(
          sock,
          m.jid,
          `😕 ملقتش فيلم أو مسلسل باسم "${cleanQuery}" على أكوام، اتأكد من الاسم وجرب تاني!`,
        );
        return true;
      }

      const all = db.get('searchCache', {});
      all[m.jid] = { type: 'akwam', results, at: Date.now() };
      db.set('searchCache', all);

      const first = results[0];
      const posterUrl = first?.poster;

      const listText = results.slice(0, 3).map((item, i) => {
        const yearStr = item.year ? ` (${item.year})` : '';
        const rateStr = item.rating ? ` • ⭐ ${item.rating}` : '';
        const qualStr = item.quality ? ` • 🎞️ ${item.quality}` : '';
        const typeStr = item.type ? ` [${item.type}]` : '';
        const linkStr = item.url ? `\n🔗 المشاهدة والتحميل: ${item.url}` : '';
        return `${i + 1}. 🎬 *${item.title}*${yearStr}${typeStr}${rateStr}${qualStr}${linkStr}`;
      }).join('\n\n───────────────────\n\n');

      const fullText = `🍿 *نتائج البحث في أكوام: ${cleanQuery}*\n\n${listText}`;

      // إرسال بوستر الفيلم مع التفاصيل
      if (posterUrl) {
        await sendImage(sock, m.jid, posterUrl, fullText);
      } else {
        await sendText(sock, m.jid, fullText);
      }

      const buttons = results.slice(0, 3).map((item, i) => ({
        label: `🍿 ${String(item.title).slice(0, 22)}`,
        id: `.akwam watch-${i}`,
      }));

      if (buttons.length > 0) {
        await sendQuickReplies(sock, m.jid, {
          title: `🍿 سهرة أكوام: ${cleanQuery.slice(0, 25)}`,
          text: 'اختر العمل لعرض تفاصيل التحميل والمشاهدة السريعة 👇',
          buttons,
        });
      }
    } catch (err) {
      console.error('❌ فشل بحث أكوام في tool-caller:', err.message);
      await sendText(sock, m.jid, '🥴 تعذر البحث في أكوام حالياً، جرب تاني كمان شوية!');
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // d) Celebrity & Athlete Voice Intent (صوت المشاهير والشخصيات)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'celebrity_tts' || intent.type === 'anime_tts') {
    const voice = intent.voice || intent.character || 'messi';
    const cleanText = intent.text;

    if (!cleanText || cleanText.length < 2) {
      await sendText(
        sock,
        m.jid,
        `🎙️ قولي يا فنان تحب ${voice} يقول إيه بالظبط؟ ⚽🔥\nمثال: "قول بصوت ${voice} أنا الأفضل في التاريخ"`,
      );
      return true;
    }

    try {
      let audioUrl = null;
      if (typeof api.vexTts === 'function') {
        audioUrl = await api.vexTts(cleanText.slice(0, 400), voice).catch(() => null);
      }
      if (!audioUrl && typeof api.animeTts === 'function') {
        audioUrl = await api.animeTts(cleanText.slice(0, 400), voice).catch(() => null);
      }

      if (audioUrl) {
        await sendVoice(sock, m.jid, audioUrl);
      } else {
        await speak(sock, m.jid, cleanText, { voice });
      }
    } catch (err) {
      console.error('❌ فشل صوت المشاهير في tool-caller:', err.message);
      await sendText(sock, m.jid, `🥴 معلش يا صاحبي حصل مشكلة في تقليد صوت ${voice} دلوقتي، جرب تاني!`);
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // e) Video Generation (صناعة الفيديو)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'video_gen') {
    const cleanPrompt = intent.prompt;
    const ratio = intent.ratio;

    if (!cleanPrompt || cleanPrompt.length < 2) {
      await sendText(
        sock,
        m.jid,
        '🎬 قولي يا صاحبي فكرة الفيديو أو المشهد اللي في خيالك عشان أصنعهولك! 🚀\nمثال: "اعمللي فيديو قطة بتلعب كورة في الشارع بالطول"',
      );
      return true;
    }

    // رد فوري بشخصية استرو المصرية
    await sendText(
      sock,
      m.jid,
      `🎬 حاضر من عيني يا صاحبي! ثواني وأصنعلك أحلى فيديو بالذكاء الاصطناعي... ⏳\n(الأبعاد: ${ratio === '9:16' ? '📱 ريلز/تيك توك 9:16' : '🎬 بالعرض 16:9'})`,
    );

    try {
      const url = await api.video(cleanPrompt, { ratio });
      if (!url) throw new Error('لم يرجع رابط فيديو من الـ API');

      await sendVideo(sock, m.jid, url, `🎬 *${cleanPrompt}*`);

      // أزرار المتابعة التفاعلية
      await sendQuickReplies(sock, m.jid, {
        title: '🎬 خيارات الفيديو',
        text: 'عايز تعيد توليد المشهد بأبعاد تانية؟ اختار من هنا 👇',
        buttons: [
          { label: '🎬 إعادة بالعرض 16:9', id: `اعمللي فيديو بالعرض ${cleanPrompt}` },
          { label: '📱 إعادة بالطول 9:16', id: `اعمللي فيديو بالطول ${cleanPrompt}` },
        ],
      });
    } catch (err) {
      console.error('❌ فشل توليد الفيديو في tool-caller:', err.message);
      await sendText(
        sock,
        m.jid,
        '🥴 معلش يا صاحبي سيرفر الفيديو مضغوط دلوقتي أو المشهد معقد شوية، جرّب تاني بعد لحظات أو بسّط الوصف!',
      );
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // f) Image Generation (رسم الصور)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'image_gen') {
    const cleanPrompt = intent.prompt;

    if (!cleanPrompt || cleanPrompt.length < 2) {
      await sendText(
        sock,
        m.jid,
        '🎨 قولي تحب أرسم لك إيه بالتفصيل يا فنان؟ 🖌️\nمثال: "ارسم لي قطة سيامية بتشرب قهوة على شاطئ البحر"',
      );
      return true;
    }

    // رد بشخصية استرو
    await sendText(sock, m.jid, '🎨 حالا يا سيدي، ببدأ أرسمها بالذكاء الاصطناعي... ⏳');

    try {
      const url = await api.image(cleanPrompt, { pretty: false });
      if (!url) throw new Error('فشل رابط الصورة');

      await sendImage(sock, m.jid, url, `🎨 *${cleanPrompt}*`);

      // أزرار متابعة تفاعلية: تحويل لفيديو أو رسم نسخة تانية
      await sendQuickReplies(sock, m.jid, {
        title: '🎨 خيارات الصورة',
        text: 'عجبتك الصورة؟ تقدر تحولها لفيديو أو ترسم نسخة تانية 👇',
        buttons: [
          { label: '🎬 تحويل لفيديو', id: `اعمللي فيديو ${cleanPrompt}` },
          { label: '🎨 رسم نسخة أخرى', id: `ارسم لي ${cleanPrompt}` },
        ],
      });
    } catch (err) {
      console.error('❌ فشل توليد الصورة في tool-caller:', err.message);
      await sendText(
        sock,
        m.jid,
        '🥴 معلش يا صاحبي حصل ضغط على رسام الذكاء الاصطناعي، جرّب تاني كمان ثواني!',
      );
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // g) Song & Music Search/Download (الأغاني والموسيقى)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'song_download') {
    const cleanQuery = intent.query;

    if (!cleanQuery || cleanQuery.length < 2) {
      await sendText(
        sock,
        m.jid,
        '🎵 قولي اسم الأغنية أو المغني اللي عايز تسمعه يا سكرة! 🎧\nمثال: "شغللي اغنية عمرو دياب تملي معاك"',
      );
      return true;
    }

    await sendText(sock, m.jid, `🎵 ثواني يا فنان، بدورلك على "${cleanQuery}" وبجهزلك أحلى جودة... ⏳`);

    try {
      let results = await api.ytSearch(cleanQuery, 3).catch(() => []);
      if (!results || !results.length) {
        // تجربة سبوتيفاي احتياط
        const sp = await api.spotifySearch(cleanQuery, 3).catch(() => []);
        if (sp?.length) {
          results = sp.map((item, idx) => ({
            index: idx,
            id: item.id || String(idx),
            title: item.title || item.name || cleanQuery,
            duration: item.duration,
            author: item.artist || item.artists?.[0]?.name,
            url: item.url,
          }));
        }
      }

      if (!results || !results.length) {
        await sendText(
          sock,
          m.jid,
          `😕 ملقتش الأغنية دي يا صاحبي، اتأكد من الاسم أو اكتب اسم المغني وجرب تاني!`,
        );
        return true;
      }

      // حفظ في الكاش عشان الزرار يحملها على طول
      const all = db.get('searchCache', {});
      all[m.jid] = { type: 'song', results, at: Date.now() };
      db.set('searchCache', all);

      const buttons = results.slice(0, 3).map((r, i) => ({
        label: `🎧 ${String(r.title).slice(0, 30)}`,
        id: `.song dl-${r.index ?? i}-audio`,
      }));

      await sendQuickReplies(sock, m.jid, {
        title: `🎵 نتايج أغنية: ${cleanQuery.slice(0, 25)}`,
        text:
          results
            .slice(0, 3)
            .map((r, i) => `${i + 1}. 🎵 *${r.title}*\n⏱️ ${r.duration || ''} • 👤 ${r.author || ''}`)
            .join('\n\n') + '\n\nاضغط على الزر لتحميل الصوت فوراً 👇',
        buttons,
      });
    } catch (err) {
      console.error('❌ فشل بحث الأغاني:', err.message);
      await sendText(sock, m.jid, '🥴 حصل خطأ أثناء البحث عن الأغنية، جرب تاني!');
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // h) Search Tools (بحث تيك توك، بينترست، يوتيوب)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'tiktok_search') {
    const query = intent.query;
    if (!query) {
      await sendText(sock, m.jid, '📱 قولي عايز تبحث عن إيه في تيك توك؟\nمثال: "ابحثلي في تيك توك عن مقالب مضحكة"');
      return true;
    }

    await sendText(sock, m.jid, `📱 ثواني يا غالي، بدورلك في تيك توك على "${query}"... ⏳`);

    try {
      const results = await api.tiktokSearch(query).catch(() => []);
      if (!results || !results.length) {
        await sendText(sock, m.jid, '😕 ملقيتش أي مقاطع في تيك توك مطابقة للبحث ده.');
        return true;
      }

      const all = db.get('searchCache', {});
      all[m.jid] = { type: 'ttsearch', results, at: Date.now() };
      db.set('searchCache', all);

      const top = results.slice(0, 3);
      const buttons = top.map((r, i) => ({
        label: `🎬 مقطع ${i + 1}`,
        id: `.ttsearch dl-${i}-video`,
      }));

      const summary = top
        .map((r, i) => `${i + 1}. 📱 *${(r.desc || 'مقطع تيك توك').slice(0, 45)}*\n👤 ${r.author?.name ?? ''}`)
        .join('\n\n');

      await sendQuickReplies(sock, m.jid, {
        title: `📱 تيك توك: ${query.slice(0, 25)}`,
        text: `${summary}\n\nاختر مقطع لتنزيله فوراً بدون علامة مائية 👇`,
        buttons,
      });
    } catch (err) {
      console.error('❌ فشل بحث تيك توك:', err.message);
      await sendText(sock, m.jid, '🥴 تعذر البحث في تيك توك حالياً، جرب كمان شوية.');
    }
    return true;
  }

  if (intent.type === 'pinterest_search') {
    const query = intent.query;
    if (!query) {
      await sendText(sock, m.jid, '📌 قولي عايز صور إيه من بينترست؟\nمثال: "صور من بينترست عن ديكور غرف نوم"');
      return true;
    }

    await sendText(sock, m.jid, `📌 حاضر يا سيدي، بدورلك في بينترست على أجمل الصور لـ "${query}"... ⏳`);

    try {
      const results = await api.pinimg(query, 6).catch(() => []);
      if (!results || !results.length) {
        await sendText(sock, m.jid, '😕 ملقيتش صور في بينترست بالكلمات دي.');
        return true;
      }

      const all = db.get('searchCache', {});
      all[m.jid] = { type: 'pin', results, at: Date.now() };
      db.set('searchCache', all);

      // إرسال أول صورة فوراً
      const first = results[0];
      const imgUrl = first?.image ?? first?.url;
      if (imgUrl) {
        await sendImage(sock, m.jid, imgUrl, `📌 *${first.title || query}*`);
      }

      // إرسال أزرار لباقي الصور
      const buttons = results.slice(1, 4).map((r, i) => ({
        label: `🖼️ صورة أخرى ${i + 1}`,
        id: `.pin img-${i + 1}`,
      }));

      if (buttons.length) {
        await sendQuickReplies(sock, m.jid, {
          title: `📌 صور بينترست: ${query.slice(0, 25)}`,
          text: 'عايز تشوف صور تانية من نفس البحث؟ اختار من هنا 👇',
          buttons,
        });
      }
    } catch (err) {
      console.error('❌ فشل بحث بينترست:', err.message);
      await sendText(sock, m.jid, '🥴 تعذر جلب صور بينترست حالياً، جرب تاني بعد قليل.');
    }
    return true;
  }

  if (intent.type === 'youtube_search') {
    const query = intent.query;
    if (!query) {
      await sendText(sock, m.jid, '🎬 قولي عايز تبحث عن إيه في يوتيوب؟\nمثال: "ابحث في يوتيوب عن ملخص أهداف اليوم"');
      return true;
    }

    await sendText(sock, m.jid, `🎬 حالا يا برو، ببحثلك في يوتيوب على "${query}"... ⏳`);

    try {
      const results = await api.ytSearch(query, 5).catch(() => []);
      if (!results || !results.length) {
        await sendText(sock, m.jid, '😕 ملقيتش فيديوهات في يوتيوب مطابقة للبحث ده.');
        return true;
      }

      const all = db.get('searchCache', {});
      all[m.jid] = { type: 'song', results, at: Date.now() };
      db.set('searchCache', all);

      const buttons = results.slice(0, 3).map((r, i) => ({
        label: `🎬 تحميل ${i + 1}`,
        id: `.song dl-${r.index ?? i}`,
      }));

      const summary = results
        .slice(0, 3)
        .map((r, i) => `${i + 1}. 🎬 *${r.title}*\n⏱️ ${r.duration || ''} • 👤 ${r.author || ''}`)
        .join('\n\n');

      await sendQuickReplies(sock, m.jid, {
        title: `🎬 نتائج يوتيوب: ${query.slice(0, 25)}`,
        text: `${summary}\n\nاختر فيديو للمشاهدة أو التحميل 👇`,
        buttons,
      });
    } catch (err) {
      console.error('❌ فشل بحث يوتيوب:', err.message);
      await sendText(sock, m.jid, '🥴 تعذر البحث في يوتيوب حالياً، جرب تاني بعد شوية.');
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // i) Song Lyrics (كلمات الأغاني)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'lyrics') {
    const query = intent.query;
    if (!query) {
      await sendText(
        sock,
        m.jid,
        '📝 قولي اسم الأغنية اللي عايز كلماتها يا غالي! 🎶\nمثال: "كلمات اغنية تملي معاك عمرو دياب"',
      );
      return true;
    }

    await sendText(sock, m.jid, `📝 حاضر يا صاحبي، ثواني وأجيبلك كلمات "${query}"... ⏳`);

    try {
      const res = await api.lyrics(query).catch(() => null);
      if (!res || !res.lyrics) {
        await sendText(
          sock,
          m.jid,
          `😕 ملقتش كلمات لأغنية "${query}" يا صاحبي، اتأكد من كتابة الاسم صح أو اكتب المغني جنبها!`,
        );
        return true;
      }

      const header = `📝 *${res.title ?? query}*\n${res.artist && res.artist !== res.title ? `🎤 الفنان: *${res.artist}*\n` : ''}───────────────────\n\n`;
      const body = res.lyrics.length > 3500 ? res.lyrics.slice(0, 3500) + '\n\n... (تم اختصار الكلمات لطولها)' : res.lyrics;
      await sendText(sock, m.jid, header + body);
    } catch (err) {
      console.error('❌ فشل جلب كلمات الأغنية:', err.message);
      await sendText(sock, m.jid, '🥴 حصل خطأ أثناء جلب كلمات الأغنية، جرب تاني!');
    }
    return true;
  }

  return false;
}

export default {
  dispatchToolAction,
  detectIntent,
  normalizeText,
  cleanUserInput,
  hasAttachedImage,
};
