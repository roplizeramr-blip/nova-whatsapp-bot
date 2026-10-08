import api from './api.js';
import { sendText, sendImage, sendVideo, sendVoice, sendQuickReplies } from './send.js';
import { db } from './db.js';
import { speak } from './tts.js';
import { imageToUrl, getSettings, isAdmin } from './protection.js';
import { getMediaSource, uploadBuffer } from './media.js';
import { requireAdmin, targetOf, listParticipants } from './groupadmin.js';
import { showSongChoices, saveSongCache } from '../commands/download/song.js';

// 🎮 استيراد الألعاب والأدوات للتشغيل الذاتي السلس (Autonomous Agent Loop)
import xoCmd from '../commands/games/xo.js';
import guessCmd from '../commands/games/guess.js';
import quizCmd from '../commands/games/quiz.js';
import mathCmd from '../commands/games/math.js';
import rpsCmd from '../commands/games/rps.js';
import truthDareCmd from '../commands/games/truth-dare.js';
import hangCmd from '../commands/games/hang.js';
import scrambleCmd from '../commands/games/scramble.js';
import flagsCmd from '../commands/games/flags.js';
import stickerCmd from '../commands/tools/sticker.js';
import translateCmd from '../commands/tools/translate.js';
import reminderCmd from '../commands/tools/reminder.js';
import checknumCmd from '../commands/tools/checknum.js';
import bankCmd from '../commands/economy/bank.js';
import topCmd from '../commands/economy/top.js';
import menuCmd from '../commands/general/menu.js';
import pingCmd from '../commands/general/ping.js';
import jokeCmd from '../commands/fun/joke.js';

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
 * استخراج رابط الصورة بجودة عالية سواء من الرسالة الحالية أو من الاقتباس والرد
 * @param {object} m - كائن الرسالة
 * @returns {Promise<string|null>} رابط الصورة المرفوعة
 */
export async function extractImageUrl(m) {
  if (!m) return null;

  // 1) الطريقة المباشرة والأكثر دقة: تحميل buffer عبر getMediaSource ثم رفعه
  try {
    const media = await getMediaSource(m);
    if (media?.buffer && media.kind === 'image') {
      const url = await uploadBuffer(media.buffer);
      if (url) return url;
    }
  } catch {}

  // 2) تجربة imageToUrl للرسالة الحالية
  try {
    const direct = await imageToUrl(m);
    if (direct) return direct;
  } catch {}

  // 3) تجربة imageToUrl للرسالة المقتبسة
  try {
    const ctx = m.message?.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage || m.quoted;
    if (quoted) {
      const fromQuoted = await imageToUrl(quoted);
      if (fromQuoted) return fromQuoted;
    }
  } catch {}

  return null;
}

/**
 * فحص ما إذا كانت الرسالة الحالية تحتوي على صورة أو تقتبس صورة
 * @param {object} m - كائن الرسالة
 * @returns {boolean}
 */
export function hasAttachedImage(m) {
  if (!m) return false;
  const ctx = m.message?.extendedTextMessage?.contextInfo;
  const quoted = ctx?.quotedMessage || m.quoted;
  return Boolean(
    m?.message?.imageMessage ||
    m?.msg?.imageMessage ||
    m?.msg?.message?.imageMessage ||
    m?.imageMessage ||
    ctx?.quotedMessage?.imageMessage ||
    quoted?.imageMessage ||
    quoted?.isImage ||
    m?.quoted?.imageMessage ||
    m?.quoted?.isImage
  );
}

// قائمة المشاهير والشخصيات الصوتية المدعومة وألقابهم الشائعة
const CELEBRITY_VOICE_MAP = [\n  // 🌟 أصوات ElevenLabs الطبيعية فائقة الدقة (عربي ومصري بطلاقة)\n  { id: 'adam', aliases: ['ادم', 'آدم', 'adam', 'استرو', 'صوتك', 'نوفا'] },\n  { id: 'liam', aliases: ['ليام', 'liam'] },\n  { id: 'antoni', aliases: ['انطوني', 'أنطوني', 'antoni'] },\n  { id: 'bella', aliases: ['بيلا', 'bella'] },\n  { id: 'matilda', aliases: ['ماتيلدا', 'matilda'] },\n\n  // ⚽🎭 مشاهير VoxBox\n  { id: 'messi', aliases: ['ميسي', 'ليونيل ميسي', 'ليو ميسي', 'messi', 'lionel messi'] },\n  { id: 'goku', aliases: ['غوكو', 'كوكو', 'جوكو', 'goku', 'son goku'] },\n  { id: 'eminem', aliases: ['ايمينيم', 'امينيم', 'eminem', 'slim shady'] },\n  { id: 'therock', aliases: ['ذا روك', 'روك', 'the rock', 'therock', 'صخرة', 'دواين جونسون', 'dwayne johnson'] },\n  { id: 'neymar', aliases: ['نيمار', 'نيمار جونيور', 'neymar', 'neymar jr'] },\n  { id: 'mbappe', aliases: ['مبابي', 'كيليان مبابي', 'mbappe', 'kylian مبابي'] },\n  { id: 'kanye', aliases: ['كانيه', 'كاني', 'كانيي', 'كانيه ويست', 'كاني ويست', 'kanye', 'kanye west'] },\n  { id: 'drake', aliases: ['دريك', 'drake'] },\n  { id: 'snoop', aliases: ['سنوب', 'سنوب دوج', 'سنوب دوغ', 'سنوب دوجي', 'snoop', 'snoop dogg'] },\n  { id: 'morgan', aliases: ['مورغان', 'مورجان', 'مورغان فريمان', 'morgan', 'morgan freeman'] },\n  { id: 'ronaldo', aliases: ['رونالدو', 'كريستيانو', 'الدون', 'ronaldo', 'cr7'] },\n  { id: 'trump', aliases: ['ترامب', 'دونالد ترامب', 'trump', 'donald trump'] },\n  { id: 'biden', aliases: ['بايدن', 'جو بايدن', 'biden', 'joe biden'] },\n  { id: 'bellingham', aliases: ['بيلينغهام', 'بيلينجهام', 'bellingham'] },\n];

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
  // 1. 🎙️ Celebrity & Natural Voice Intent (صوت المشاهير والذكاء الاصطناعي الطبيعي)
  // ─────────────────────────────────────────────────────────────
  // a) "بصوتك", "اتكلم بصوتك", "قول بصوتك", "رد بصوتك"
  const botVoicePattern = /^(?:قول|اتكلم|انطق|رد|احكي|غرد|تكلم)?\s*(?:لي\s+|ليا\s+|معايا\s+|علي\s+|عليا\s+)?(?:بصوتك|صوتك|بالصوت)\s*(.*)$/i;
  const botVoiceMatch = norm.match(botVoicePattern);
  if (botVoiceMatch) {
    let cleanText = cleanUserInput(rawText)
      .replace(/^(?:قول|اتكلم|انطق|رد|احكي|غرد|تكلم)?\s*(?:لي\s+|ليا\s+|معايا\s+|علي\s+|عليا\s+)?(?:بصوتك|صوتك|بالصوت)\s*/i, '')
      .trim();
    return {
      type: 'celebrity_tts',
      voice: 'adam',
      character: 'adam',
      text: cleanText || 'يا هلا بيك يا صاحبي! أنا استرو، اتفضل أؤمرني وسامعك بكل وضوح',
    };
  }

  // b) صوت المشاهير والرياضيين: "قول بصوت ميسي", "اتكلم بصوت ميسي", "بصوت غوكو", "بصوت ادم"
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
  // 2. ✂️ Remove Background Intent (إزالة وتفريغ خلفية الصورة)
  // ─────────────────────────────────────────────────────────────
  const removeBgTriggers = [
    'شيل الخلفية', 'شيل الخلفيه', 'ازالة الخلفية', 'ازالة الخلفيه', 'ازل الخلفية', 'ازل الخلفيه',
    'مسح الخلفية', 'مسح الخلفيه', 'فرغ الصورة', 'فرغ الصوره', 'فرغ دي', 'فرغلي دي', 'تفريغ الصورة', 'تفريغ الصوره',
    'شيل خلفية الصورة', 'شيل خلفيه الصوره', 'شيل خلفية دي',
    'remove bg', 'remove background', 'erase background', 'clear background',
  ];
  const hasRemoveBgTrigger = removeBgTriggers.some((tr) => norm.includes(normalizeText(tr)));
  if (hasRemoveBgTrigger) {
    return {
      type: 'remove_bg',
      hasImage: hasAttachedImage(m),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 3. 🎨 Image Editing Intent (تعديل وتغيير الصور بالذكاء الاصطناعي بدون بادئة)
  // ─────────────────────────────────────────────────────────────
  const imageEditTriggers = [
    'عدل الصورة', 'عدلي الصورة', 'عدللي الصورة', 'عدل لي الصورة', 'عدل في الصورة', 'عدل علي الصورة', 'عدل على الصورة', 'عدل ع الصورة',
    'عدل الصوره', 'عدلي الصوره', 'عدللي الصوره', 'عدل لي الصوره', 'عدل في الصوره', 'عدل علي الصوره', 'عدل على الصوره', 'عدل ع الصوره',
    'غير الصورة', 'غيرلي الصورة', 'غير لي الصورة', 'غير الصوره', 'غيرلي الصوره', 'غير لي الصوره',
    'خلي الصورة', 'خليلي الصورة', 'خلي لي الصورة', 'خلي الصوره', 'خليلي الصوره', 'خلي لي الصوره',
    'عدل دي', 'عدلي دي', 'عدللي دي', 'عدل لي دي', 'عدل ديه', 'عدلي ديه',
    'غير دي', 'غيرلي دي', 'غير لي دي',
    'عدلها', 'عدليها', 'عدلهالي', 'عدلها لي', 'غيرها', 'غيرليها', 'غيرهالي',
    'ظبط الصورة', 'ظبطلي الصورة', 'ظبط الصوره', 'ظبطلي الصوره', 'ظبط دي', 'ظبطلي دي',
    'عايز اعدل الصورة', 'عاوز اعدل الصورة', 'بدي اعدل الصورة', 'محتاج اعدل الصورة',
    'عايز اعدل الصوره', 'عاوز اعدل الصوره', 'بدي اعدل الصوره',
    'تعديل الصورة', 'تعديل الصوره', 'تعديل صورة', 'تعديل صوره',
    'حول الصورة', 'حول الصوره', 'حولها', 'حول دي',
    'غير الخلفية لـ', 'غير الخلفيه لـ', 'غير الخلفية ل', 'غير الخلفيه ل', 'غير الخلفية', 'غير الخلفيه',
    'غير خلفية لـ', 'غير خلفيه لـ', 'غير خلفية ل', 'غير خلفيه ل', 'غير خلفية', 'غير خلفيه',
    'بدل الخلفية', 'بدل الخلفيه',
    'edit image', 'edit the image', 'edit this image', 'edit photo', 'edit the photo', 'edit picture',
    'modify image', 'modify the image', 'modify photo', 'modify picture',
    'change image', 'change the image', 'change photo', 'change picture',
  ];

  const hasImageAttached = hasAttachedImage(m);
  const hasImageEditTrigger = imageEditTriggers.some((tr) => norm.includes(normalizeText(tr)));
  const contextualEditMatch = hasImageAttached && (
    /^(?:خليها|خلوها|حولها|غيرها|عدلها|ظبطها|بدلها|ضيف|حط|make it|turn into)\s+(.+)/i.test(norm) ||
    /^(?:انمي|أنمي|كرتون|فضاء|رسمة|رسمه|3d|neon|anime|cyberpunk)/i.test(norm)
  );

  if (hasImageEditTrigger || contextualEditMatch) {
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
      prompt: prompt || 'تعديل وتحسين الصورة بالذكاء الاصطناعي',
      hasImage: hasImageAttached,
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
  // 9. 🎵 Song & Music Search/Download (الأغاني، المهرجانات، الكليبات، والفيديوهات)
  // "حملي مهرجان اندال", "حملي اغنية", "شغللي اغنية", "عايز مهرجان", "هات تراك", "نزل كليب"
  // ─────────────────────────────────────────────────────────────
  const songTriggers = [
    'حمللي مهرجان', 'حملي مهرجان', 'حمل لي مهرجان', 'حمل مهرجان', 'نزللي مهرجان', 'نزلي مهرجان', 'نزل لي مهرجان', 'نزل مهرجان',
    'شغللي مهرجان', 'شغل لي مهرجان', 'شغل مهرجان', 'عايز مهرجان', 'عاوز مهرجان', 'بدي مهرجان', 'هات مهرجان', 'هاتلي مهرجان',
    'حمللي اغنية', 'حملي اغنية', 'حمل لي اغنية', 'حمل اغنية', 'حمللي تراك', 'حمل تراك',
    'شغللي اغنية', 'شغل لي اغنية', 'شغل اغنية', 'شغللي تراك', 'شغل تراك',
    'عايز اغنية', 'عاوز اغنية', 'بدي اغنية', 'محتاج اغنية',
    'اسمع اغنية', 'عايز اسمع اغنية', 'عاوز اسمع اغنية', 'اسمعني اغنية', 'سمعني اغنية', 'سمعني مهرجان',
    'هات اغنية', 'هاتلي اغنية', 'هات لي اغنية', 'هاتلي تراك', 'هات تراك',
    'نزل اغنية', 'نزل لي اغنية', 'نزلي اغنية', 'نزل تراك', 'نزلي تراك', 'نزللي تراك',
    'حمللي كليب', 'حمل كليب', 'نزل كليب', 'شغل كليب', 'هات كليب',
    'حمللي فيديو', 'حمل فيديو', 'نزل فيديو', 'نزلي فيديو', 'شغل فيديو',
    'play song', 'download song', 'get song', 'listen to song',
  ];

  const hasSongTrigger = songTriggers.some((tr) => norm.includes(normalizeText(tr)));
  const directSongMatch = norm.match(/^(?:حمل|نزل|شغل|هات|سمعني|اسمع|عايز\s+اسمع|عاوز\s+اسمع)\s*(?:لي\s+|ليا\s+)?(?:اغني[ةه]|تراك|مهرجان|كليب|فيديو|صوت|mp3)?\s*(.+)$/i);
  const directFestMatch = /^مهرجان\s+.+/i.test(norm);

  if (hasSongTrigger || directSongMatch || directFestMatch) {
    let query = cleanUserInput(rawText);
    for (const tr of songTriggers) {
      const reg = new RegExp(tr.replace(/[\s\-_]+/g, '[\\s\\-_]+'), 'gi');
      query = query.replace(reg, ' ');
    }
    query = query
      .trim()
      .replace(/^(?:حمل|نزل|شغل|هات|سمعني|اسمع|عايز|عاوز)\s*(?:لي\s+|ليا\s+)?/i, '')
      .replace(/^(?:اغني[ةه]|تراك|كليب|فيديو|صوت|mp3)\s+/i, '')
      .replace(/^(?:لـ|ل\s+|عن|بتاعت|بتاع|حق|of\s+|for\s+)/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    // إذا كان الطلب عن مهرجان، نحافظ على كلمة مهرجان لتكون نتيجة البحث في يوتيوب دقيقة
    if (norm.includes('مهرجان') && !query.includes('مهرجان')) {
      query = `مهرجان ${query}`;
    }

    if (query) {
      return {
        type: 'song_download',
        query,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 10. 🎮 Games Intent (تشغيل الألعاب التفاعلية بدون بادئة)
  // ─────────────────────────────────────────────────────────────
  // a) XO (إكس أو)
  if (
    /^(?:شغل|ابدا|العب|نلعب|عايز\s+العب)?\s*(?:لعب[ةه]\s+)?(?:xo|اكس\s*او|اكس\s*و\s*او)$/i.test(norm) ||
    norm === 'اكس او' || norm === 'لعبه xo' || norm === 'لعبة xo' ||
    (norm.includes('xo') && (norm.includes('لعب') || norm.includes('تحدي') || norm.includes('شغل')))
  ) {
    return { type: 'game_xo' };
  }

  // b) Guess (التخمين)
  if (
    /^(?:شغل|ابدا|العب|نلعب|عايز\s+العب)?\s*(?:لعب[ةه]\s+)?(?:التخمين|تخمين|خمن\s+الرقم|guess)$/i.test(norm) ||
    norm.includes('تخمين') || norm.includes('خمن الرقم')
  ) {
    return { type: 'game_guess' };
  }

  // c) Quiz (المسابقات والحزازير)
  if (
    /^(?:شغل|ابدا|العب|نلعب|عايز\s+العب)?\s*(?:لعب[ةه]\s+)?(?:مسابق[ةه]|المسابقات|حزور[ةه]|فزور[ةه]|اسئل[ةه]|quiz|مسابق[ةه]\s+ثقافي[ةه])$/i.test(norm) ||
    norm.includes('حزور') || norm.includes('فزور') || norm.includes('مسابق') || norm.includes('سؤال مسابق')
  ) {
    return { type: 'game_quiz' };
  }

  // d) Math (الحساب والرياضيات)
  if (
    /^(?:شغل|ابدا|العب|نلعب|عايز\s+العب)?\s*(?:لعب[ةه]\s+)?(?:رياضيات|الحساب|مسال[ةه]\s+رياضي[ةه]|تحدي\s+حساب|math)$/i.test(norm) ||
    norm.includes('تحدي حساب') || (norm.includes('مسال') && norm.includes('رياض'))
  ) {
    return { type: 'game_math' };
  }

  // e) RPS (حجر ورقة مقص)
  if (
    (norm.includes('حجر') && norm.includes('ورق') && norm.includes('مقص')) ||
    /^(?:شغل|ابدا|العب|نلعب)?\s*(?:لعب[ةه]\s+)?rps$/i.test(norm)
  ) {
    return { type: 'game_rps' };
  }

  // f) Truth or Dare (صراحة وجرأة)
  if (
    norm.includes('صراح') ||
    (norm.includes('حقيق') && norm.includes('تحدي')) ||
    (norm.includes('حقيق') && norm.includes('جراه')) ||
    norm.includes('truth')
  ) {
    return { type: 'game_truth_dare' };
  }

  // g) Hangman (المشنقة)
  if (
    norm.includes('مشنق') ||
    norm.includes('hangman')
  ) {
    return { type: 'game_hang' };
  }

  // h) Scramble (ترتيب الحروف)
  if (
    norm.includes('ترتيب حروف') || norm.includes('ترتيب الحروف') ||
    norm.includes('رتب الحروف') || norm.includes('فكك وركب') ||
    norm.includes('scramble')
  ) {
    return { type: 'game_scramble' };
  }

  // i) Flags (خمن علم الدولة)
  if (
    norm.includes('خمن العلم') || norm.includes('لعبة الاعلام') ||
    norm.includes('لعبة العلم') || norm.includes('تحدي الاعلام') ||
    norm.includes('علم الدولة') || norm.includes('flags')
  ) {
    return { type: 'game_flags' };
  }

  // ─────────────────────────────────────────────────────────────
  // 11. 🏷️ Sticker Intent (صناعة الملصقات التلقائية)
  // ─────────────────────────────────────────────────────────────
  const stickerTriggers = [
    'اعمللي استيكر', 'اعملي استيكر', 'اعمل استيكر', 'اعمللي ستيكر', 'اعملي ستيكر', 'اعمل ستيكر',
    'حول دي استيكر', 'حول دي ستيكر', 'حولها استيكر', 'حولها ستيكر',
    'استيكر من دي', 'ستيكر من دي', 'استيكر من الصورة', 'ستيكر من الصوره',
    'اعمللي ملصق', 'اعملي ملصق', 'اعمل ملصق', 'حول لملصق', 'حول دي لملصق', 'حولها ملصق',
    'make sticker', 'create sticker',
  ];
  if (
    stickerTriggers.some((t) => norm.includes(normalizeText(t))) ||
    norm === 'استيكر' || norm === 'ستيكر' || norm === 'ملصق'
  ) {
    return { type: 'sticker_make' };
  }

  // ─────────────────────────────────────────────────────────────
  // 12. 🌐 Translation Intent (الترجمة الفورية)
  // ─────────────────────────────────────────────────────────────
  const transPattern = /^(?:ترجملي|ترجم\s+لي|ترجم)\s+(.+)$/i;
  const transMatch = norm.match(transPattern);
  if (transMatch) {
    let remainder = cleanUserInput(rawText).replace(/^(?:ترجملي|ترجم\s+لي|ترجم)\s*/i, '').trim();
    let targetLang = 'ar';
    const langDetect = remainder.match(/^(?:لـ|ل|إلى|الي|to\s+)?(انجليزي|إنجليزي|عربي|فرنساوي|فرنسي|تركي|الماني|ألماني|روسي|اسباني|إسباني|en|ar|fr|tr|de|ru|es)\s*[:،,-]?\s*(.+)$/i;
    if (langDetect) {
      const l = langDetect[1].toLowerCase();
      if (/انجليزي|en/i.test(l)) targetLang = 'en';
      else if (/عربي|ar/i.test(l)) targetLang = 'ar';
      else if (/فرنساوي|فرنسي|fr/i.test(l)) targetLang = 'fr';
      else if (/تركي|tr/i.test(l)) targetLang = 'tr';
      else if (/الماني|ألماني|de/i.test(l)) targetLang = 'de';
      else if (/روسي|ru/i.test(l)) targetLang = 'ru';
      else if (/اسباني|إسباني|es/i.test(l)) targetLang = 'es';
      remainder = langDetect[2].trim();
    }
    return {
      type: 'translate_text',
      text: remainder,
      lang: targetLang,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 13. ⏰ Reminder Intent (التذكير بالمواعيد والمهام)
  // ─────────────────────────────────────────────────────────────
  const reminderPattern = /^(?:فكرني|ذكرني|نبهني)\s+(.+)$/i;
  const reminderMatch = norm.match(reminderPattern);
  if (reminderMatch) {
    return {
      type: 'set_reminder',
      rawReminder: cleanUserInput(rawText).replace(/^(?:فكرني|ذكرني|نبهني)\s*/i, '').trim(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 14. 📱 Check Phone Number Intent (فحص الأرقام واستخراج الهوية)
  // ─────────────────────────────────────────────────────────────
  const checkNumPattern = /(?:مين\s+صاحب\s+الرقم|افحص\s+الرقم|فحص\s+رقم|بيانات\s+الرقم|معلومات\s+الرقم|رقم)\s+(\+?\d[\d\s-]{6,16})/i;
  const checkNumMatch = rawText.match(checkNumPattern);
  if (checkNumMatch) {
    return {
      type: 'check_number',
      phone: checkNumMatch[1].replace(/\D/g, ''),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 15. 💰 Quick Status & Economy Utilities (رصيدي، ترتيبي، القائمة، البينج، النكت)
  // ─────────────────────────────────────────────────────────────
  if (/^(?:رصيدي\s*كام|معايا\s*كام|فلوسي\s*كام|حسابي\s*كام|كم\s*رصيدي)$/i.test(norm)) {
    return { type: 'quick_bank' };
  }
  if (/^(?:ترتيبي\s*ايه|توب\s*البوت|مين\s*اعلى\s*رصيد|لوحة\s*الشرف|المتصدرين)$/i.test(norm)) {
    return { type: 'quick_top' };
  }
  if (/^(?:الاوامر|المنيو|قائمة\s*الاوامر|وريني\s*الاوامر|افتح\s*المنيو|menu|help)$/i.test(norm)) {
    return { type: 'quick_menu' };
  }
  if (/^(?:البينج\s*كام|سرعة\s*البوت|سرعتك\s*كام|فحص\s*البينج|ping)$/i.test(norm)) {
    return { type: 'quick_ping' };
  }
  if (
    norm.includes('نكت') ||
    /^(?:قول|احكي|سمعني)?\s*(?:لي\s+|ليا\s+)?(?:نكت[ةه]|فزور[ةه]|حاج[ةه]\s+تضحك)$/i.test(norm)
  ) {
    return { type: 'quick_joke' };
  }
  // ─────────────────────────────────────────────────────────────
  // 16. 👥 Conversational Group Management (إدارة وحماية الجروبات التلقائية بالذكاء الاصطناعي)
  // ─────────────────────────────────────────────────────────────
  if (m?.isGroup) {
    // a) ترفيع أدمن: "ارفع ده ادمن", "ارفع ده", "رقيه ادمن", "خليه ادمن", "خليه مشرف", "ارفع دا"
    if (
      /^(?:ارفع|رقيه|رقي|خلي|خليه)\s*(?:ده|دا|هذا|الشخص)?\s*(?:ادمن|مشرف|مسؤول|ادارة|إدارة)?$/i.test(norm) ||
      norm.includes('ارفع ده ادمن') || norm.includes('ارفع دا ادمن') || norm.includes('رقيه ادمن') || norm.includes('خليه ادمن')
    ) {
      return { type: 'group_promote' };
    }

    // b) تنزيل من الإدارة: "نزل ده من الادمن", "نزل ده", "شيله من الادمن", "نزله من الاشراف"
    if (
      /^(?:نزل|نزله|شيل|شيله|اسحب)\s*(?:ده|دا|هذا)?\s*(?:من\s+)?(?:الادمن|الإدارة|الادارة|الاشراف|الإشراف|مشرف)?$/i.test(norm) ||
      norm.includes('نزل ده من الادمن') || norm.includes('نزل ده') || norm.includes('نزله من الادمن') || norm.includes('شيله من الادمن')
    ) {
      return { type: 'group_demote' };
    }

    // c) طرد عضو: "اطرد ده", "اطرده", "طرد ده", "كرش ده", "كرشه", "طلع ده برا"
    if (
      /^(?:اطرد|اطرده|طرد|كرش|كرشه|طلع|طلعه|خرج|خرجه)\s*(?:ده|دا|هذا)?\s*(?:برا|برة|من\s+الجروب)?$/i.test(norm) ||
      norm.includes('اطرد ده') || norm.includes('اطرده') || norm.includes('كرش ده') || norm.includes('طلعه برا')
    ) {
      return { type: 'group_kick' };
    }

    // d) إنذار عضو: "ادي ده انذار", "اديله انذار", "انذار لده", "حذره"
    if (
      /^(?:ادي|اديله|اعطي|اعطيه)?\s*(?:ده|دا|هذا)?\s*(?:انذار|إنذار|تحذير)$/i.test(norm) ||
      norm.includes('انذار') || norm.includes('اديله انذار')
    ) {
      return { type: 'group_warn' };
    }

    // e) منشن للكل: "منشن للكل", "منشن الكل", "نادي الكل", "نداء للكل", "منشن جماعي"
    if (
      /^(?:منشن|نادي|نداء|اعمل\s+منشن)\s+(?:لل?كل|للجميع|للاعضاء|للأعضاء|جماعي)$/i.test(norm) ||
      norm === 'منشن للكل' || norm === 'منشن الكل' || norm === 'نداء للكل' || norm === 'تاق للكل'
    ) {
      return {
        type: 'group_tagall',
        text: cleanUserInput(rawText).replace(/^(?:منشن|نادي|نداء|اعمل\s+منشن)\s+(?:لل?كل|للجميع|للاعضاء|للأعضاء|جماعي)\s*/i, '').trim(),
      };
    }

    // f) قفل / فتح الجروب
    if (/^(?:اقفل|قفل|اغلق|سكر)\s+(?:الجروب|الشات|المجموعة|المجموعه)$/i.test(norm) || norm === 'اقفل الجروب' || norm === 'قفل الجروب') {
      return { type: 'group_mute' };
    }
    if (/^(?:افتح|فتح)\s+(?:الجروب|الشات|المجموعة|المجموعه)$/i.test(norm) || norm === 'افتح الجروب' || norm === 'فتح الجروب') {
      return { type: 'group_unmute' };
    }

    // g) حذف رسالة: "امسح دي", "احذف دي", "امسح الرسالة دي", "احذف الرسالة"
    if (/^(?:امسح|احذف)\s*(?:دي|ديه|الرسال[ةه]|الرسال[ةه]\s*دي)?$/i.test(norm)) {
      return { type: 'group_delete' };
    }
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
  // ─────────────────────────────────────────────────────────────
  // ✂️ Remove Background Intent (إزالة وتفريغ خلفية الصورة)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'remove_bg') {
    const imageUrl = await extractImageUrl(m);
    if (!imageUrl) {
      await sendText(
        sock,
        m.jid,
        '🖼️ ابعتلي الصورة أو رد عليها واكتب "شيل الخلفية" عشان أفرغهالك فوراً يا فنان! ✂️✨',
      );
      return true;
    }

    await sendText(sock, m.jid, '✂️ حاضر يا سيدي، بثواني بفرغلك الصورة وبشيل الخلفية... ⏳');
    try {
      const transparentUrl = await api.removeBg(imageUrl);
      if (!transparentUrl) throw new Error('فشل سيرفر تفريغ الصورة');
      await sendImage(sock, m.jid, transparentUrl, '✂️ *تم تفريغ الصورة وإزالة الخلفية بنجاح!*');
      await sendQuickReplies(sock, m.jid, {\n        title: '✂️ خيارات الصورة المفرغة',\n        text: 'تحب تعمل إيه بالصورة المفرغة يا فنان؟ 👇',\n        buttons: [\n          { label: '🎬 تحويل لفيديو', id: 'اعمللي فيديو سينمائي' },\n          { label: '🎨 تعديل بالذكاء الاصطناعي', id: 'عدلي الصورة دي' },\n        ],\n      });
    } catch (err) {
      console.warn('⚠️ فشل تفريغ الصورة:', err.message);
      await sendText(sock, m.jid, '🥴 معلش يا فنان، تعذر تفريغ خلفية الصورة دي حالياً، اتأكد إن الصورة واضحة وجرب تاني!');
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // a) Image Editing Intent (تعديل الصور بالذكاء الاصطناعي بدون بادئة)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'image_edit') {
    const imageUrl = await extractImageUrl(m);

    // إذا لم تكن هناك صورة مرفقة أو مقتبسة
    if (!imageUrl) {
      await sendText(
        sock,
        m.jid,
        '🖼️ ابعتلي الصورة أو رد عليها بطلب التعديل يا فنان عشان أعدلهالك بالذكاء الاصطناعي! 🎨✨\nمثال: رد على صورتك واكتب "عدل الصورة خليها أنمي" أو "حولها لـ 3d"',
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
      await sendQuickReplies(sock, m.jid, {\n        title: '🎨 خيارات الصورة',\n        text: 'عجبك التعديل يا فنان؟ تقدر تحول الصورة لفيديو أو ترسم نسخة ثانية بالذكاء الاصطناعي 👇',\n        buttons: [\n          { label: '🎬 تحويل إلى فيديو', id: `اعمللي فيديو ${cleanPrompt}` },\n          { label: '🎨 رسم نسخة ثانية', id: `ارسم لي ${cleanPrompt}` },\n          { label: '🔄 تعديل آخر', id: `عدلي الصورة ${cleanPrompt}` },\n        ],\n      });
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

      const details = results.slice(0, 3).map((app, i) => {\n        const sizeStr = app.sizeHuman ? ` • 📦 ${app.sizeHuman}` : '';\n        const verStr = app.version ? ` (v${app.version})` : '';\n        const ratingStr = app.rating ? ` • ⭐ ${app.rating}` : '';\n        const devStr = app.developer ? `\\n👤 المطور: ${app.developer}` : '';\n        const linkStr = app.apkUrl ? `\\n🔗 التحميل المباشر: ${app.apkUrl}` : (app.pageUrl ? `\\n🔗 الصفحة: ${app.pageUrl}` : '');\n        return `${i + 1}. 📱 *${app.name}*${verStr}${sizeStr}${ratingStr}${devStr}${linkStr}`;\n      }).join('\n\n───────────────────\n\n');

      const buttons = results.slice(0, 3).map((app, i) => ({\n        label: `📥 تحميل ${String(app.name).slice(0, 20)}`,\n        id: `.apk dl-${i}`,\n      }));

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

      const listText = results.slice(0, 3).map((item, i) => {\n        const yearStr = item.year ? ` (${item.year})` : '';\n        const rateStr = item.rating ? ` • ⭐ ${item.rating}` : '';\n        const qualStr = item.quality ? ` • 🎞️ ${item.quality}` : '';\n        const typeStr = item.type ? ` [${item.type}]` : '';\n        const linkStr = item.url ? `\\n🔗 المشاهدة والتحميل: ${item.url}` : '';\n        return `${i + 1}. 🎬 *${item.title}*${yearStr}${typeStr}${rateStr}${qualStr}${linkStr}`;\n      }).join('\n\n───────────────────\n\n');

      const fullText = `🍿 *نتائج البحث في أكوام: ${cleanQuery}*\n\n${listText}`;

      // إرسال بوستر الفيلم مع التفاصيل
      if (posterUrl) {
        await sendImage(sock, m.jid, posterUrl, fullText);
      } else {
        await sendText(sock, m.jid, fullText);
      }

      const buttons = results.slice(0, 3).map((item, i) => ({\n        label: `🍿 ${String(item.title).slice(0, 22)}`,\n        id: `.akwam watch-${i}`,\n      }));

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
      await sendQuickReplies(sock, m.jid, {\n        title: '🎬 خيارات الفيديو',\n        text: 'عايز تعيد توليد المشهد بأبعاد تانية؟ اختار من هنا 👇',\n        buttons: [\n          { label: '🎬 إعادة بالعرض 16:9', id: `اعمللي فيديو بالعرض ${cleanPrompt}` },\n          { label: '📱 إعادة بالطول 9:16', id: `اعمللي فيديو بالطول ${cleanPrompt}` },\n        ],\n      });
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
      await sendQuickReplies(sock, m.jid, {\n        title: '🎨 خيارات الصورة',\n        text: 'عجبتك الصورة؟ تقدر تحولها لفيديو أو ترسم نسخة تانية 👇',\n        buttons: [\n          { label: '🎬 تحويل لفيديو', id: `اعمللي فيديو ${cleanPrompt}` },\n          { label: '🎨 رسم نسخة أخرى', id: `ارسم لي ${cleanPrompt}` },\n        ],\n      });
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
          results = sp.map((item, idx) => ({\n            index: idx,\n            id: item.id || String(idx),\n            title: item.title || item.name || cleanQuery,\n            duration: item.duration,\n            author: item.artist || item.artists?.[0]?.name,\n            url: item.url,\n          }));
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

      // حفظ النتائج في كاش الأغاني والمهرجانات
      saveSongCache(m.jid, results);

      // عرض أول نتيجة فوراً مع صورة الغلاف، البيانات، وأزرار الجودة والصيغ (PTT، MP3، مستند، فيديو)
      await showSongChoices(sock, m.jid, results[0], 0);
    } catch (err) {
      console.error('❌ فشل بحث الأغاني والمهرجانات:', err.message);
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
      const buttons = top.map((r, i) => ({\n        label: `🎬 مقطع ${i + 1}`,\n        id: `.ttsearch dl-${i}-video`,\n      }));

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
      const buttons = results.slice(1, 4).map((r, i) => ({\n        label: `🖼️ صورة أخرى ${i + 1}`,\n        id: `.pin img-${i + 1}`,\n      }));

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

      const buttons = results.slice(0, 3).map((r, i) => ({\n        label: `🎬 تحميل ${i + 1}`,\n        id: `.song dl-${r.index ?? i}`,\n      }));

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

  // ─────────────────────────────────────────────────────────────
  // 🎮 Games Execution (تشغيل الألعاب التفاعلية فورياً بدون بادئة)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'game_xo') {
    try {
      await xoCmd.execute(sock, m, ['new']);
    } catch (err) {
      console.error('❌ فشل تشغيل XO الذاتي:', err.message);
      await sendText(sock, m.jid, '🥴 حصل خطأ في تشغيل لعبة XO، جرب تاني!');
    }
    return true;
  }

  if (intent.type === 'game_guess') {
    try {
      await guessCmd.execute(sock, m, []);
    } catch (err) {
      console.error('❌ فشل تشغيل لعبة التخمين:', err.message);
      await sendText(sock, m.jid, '🥴 حصل خطأ في تشغيل لعبة التخمين، جرب تاني!');
    }
    return true;
  }

  if (intent.type === 'game_quiz') {
    try {
      await quizCmd.execute(sock, m, []);
    } catch (err) {
      console.error('❌ فشل تشغيل المسابقة:', err.message);
      await sendText(sock, m.jid, '🥴 حصل خطأ في تشغيل المسابقة، جرب تاني!');
    }
    return true;
  }

  if (intent.type === 'game_math') {
    try {
      await mathCmd.execute(sock, m, []);
    } catch (err) {
      console.error('❌ فشل تشغيل تحدي الرياضيات:', err.message);
      await sendText(sock, m.jid, '🥴 حصل خطأ في تشغيل تحدي الحساب، جرب تاني!');
    }
    return true;
  }

  if (intent.type === 'game_rps') {
    try {
      await rpsCmd.execute(sock, m, []);
    } catch (err) {
      console.error('❌ فشل تشغيل حجر ورقة مقص:', err.message);
      await sendText(sock, m.jid, '🥴 حصل خطأ في تشغيل حجر ورقة مقص، جرب تاني!');
    }
    return true;
  }

  if (intent.type === 'game_truth_dare') {
    try {
      await truthDareCmd.execute(sock, m, []);
    } catch (err) {
      console.error('❌ فشل تشغيل صراحة وجرأة:', err.message);
      await sendText(sock, m.jid, '🥴 حصل خطأ في تشغيل صراحة وجرأة، جرب تاني!');
    }
    return true;
  }

  if (intent.type === 'game_hang') {
    try {
      await hangCmd.execute(sock, m, []);
    } catch (err) {
      console.error('❌ فشل تشغيل لعبة المشنقة:', err.message);
      await sendText(sock, m.jid, '🥴 حصل خطأ في تشغيل لعبة المشنقة، جرب تاني!');
    }
    return true;
  }

  if (intent.type === 'game_scramble') {
    try {
      await scrambleCmd.execute(sock, m, []);
    } catch (err) {
      console.error('❌ فشل تشغيل لعبة ترتيب الحروف:', err.message);
      await sendText(sock, m.jid, '🥴 حصل خطأ في تشغيل لعبة ترتيب الحروف، جرب تاني!');
    }
    return true;
  }

  if (intent.type === 'game_flags') {
    try {
      await flagsCmd.execute(sock, m, []);
    } catch (err) {
      console.error('❌ فشل تشغيل لعبة الأعلام:', err.message);
      await sendText(sock, m.jid, '🥴 حصل خطأ في تشغيل لعبة الأعلام، جرب تاني!');
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // 🏷️ Sticker Execution (صناعة الملصقات)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'sticker_make') {
    try {
      await stickerCmd.execute(sock, m);
    } catch (err) {
      console.error('❌ فشل صناعة الملصق التلقائي:', err.message);
      await sendText(sock, m.jid, '🖼️ رد على أي صورة أو فيديو قصير واطلب "اعمللي استيكر" وهجهزهولك فوراً! ✨');
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // 🌐 Translation Execution (الترجمة الفورية)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'translate_text') {
    try {
      const args = [intent.lang, intent.text].filter(Boolean);
      await translateCmd.execute(sock, m, args);
    } catch (err) {
      console.error('❌ فشل الترجمة التلقائية:', err.message);
      await sendText(sock, m.jid, '🥴 تعذرت الترجمة حالياً، اتأكد من النص وجرب تاني!');
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // ⏰ Reminder Execution (التذكيرات)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'set_reminder') {
    try {
      const args = intent.rawReminder.split(/\s+/).filter(Boolean);
      await reminderCmd.execute(sock, m, args);
    } catch (err) {
      console.error('❌ فشل التذكير التلقائي:', err.message);
      await sendText(sock, m.jid, '⏰ اكتب التذكير كده يا غالي: "فكرني أذاكر بعد ساعة" أو "ذكرني بالميعاد بعد 10 دقايق"');
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // 📱 Check Number Execution (فحص الأرقام)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'check_number') {
    try {
      await checknumCmd.execute(sock, m, [intent.phone]);
    } catch (err) {
      console.error('❌ فشل فحص الرقم التلقائي:', err.message);
      await sendText(sock, m.jid, '🥴 تعذر فحص الرقم حالياً، اتأكد من صحته وجرب تاني!');
    }
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // 💰 Quick Utilities Execution (رصيدي، ترتيبي، القائمة، البينج، النكت)
  // ─────────────────────────────────────────────────────────────
  if (intent.type === 'quick_bank') {
    try {
      await bankCmd.execute(sock, m, []);
    } catch (err) {
      console.error('❌ فشل عرض الرصيد:', err.message);
    }
    return true;
  }

  if (intent.type === 'quick_top') {
    try {
      await topCmd.execute(sock, m, []);
    } catch (err) {
      console.error('❌ فشل عرض قائمة المتصدرين:', err.message);
    }
    return true;
  }

  if (intent.type === 'quick_menu') {
    try {
      await menuCmd.execute(sock, m, []);
    } catch (err) {
      console.error('❌ فشل عرض القائمة:', err.message);
    }
    return true;
  }

  if (intent.type === 'quick_ping') {
    try {
      await pingCmd.execute(sock, m, []);
    } catch (err) {
      console.error('❌ فشل فحص البينج:', err.message);
    }
    return true;
  }

  if (intent.type === 'quick_joke') {
    try {
      await jokeCmd.execute(sock, m, []);
    } catch (err) {
      console.error('❌ فشل إلقاء النكتة:', err.message);
    }
    return true;
  }
  // ─────────────────────────────────────────────────────────────
  // 👥 Conversational Group Management (إدارة الجروبات بالذكاء الاصطناعي)
  // ─────────────────────────────────────────────────────────────
  if (m?.isGroup) {
    // a) ترفيع أدمن: "ارفع ده ادمن", "ارفع ده", "رقيه ادمن", "خليه ادمن", "خليه مشرف", "ارفع دا"
    if (
      /^(?:ارفع|رقيه|رقي|خلي|خليه)\s*(?:ده|دا|هذا|الشخص)?\s*(?:ادمن|مشرف|مسؤول|ادارة|إدارة)?$/i.test(norm) ||
      norm.includes('ارفع ده ادمن') || norm.includes('ارفع دا ادمن') || norm.includes('رقيه ادمن') || norm.includes('خليه ادمن')
    ) {
      if (await requireAdmin(sock, m, 'الترقية')) return true;
      const target = targetOf(m);
      if (!target) {
        await sendText(sock, m.jid, '👥 منشن الشخص أو اعمل رد (Reply) على رسالته عشان أرقيه أدمن! 👑');
        return true;
      }
      try {
        await sock.groupParticipantsUpdate(m.jid, [target], 'promote');
        await sendText(sock, m.jid, `🎉 عيوني! رقيت @${target.split('@')[0]} وبقى أدمن في الجروب رسمي 👑`, { mentions: [target] });
      } catch {
        await sendText(sock, m.jid, '❌ مقدرتش أرقيه — اتأكد إني أدمن في الجروب ومعايا الصلاحيات الكافية!');
      }
      return true;
    }

    if (
      /^(?:نزل|نزله|شيل|شيله|اسحب)\s*(?:ده|دا|هذا)?\s*(?:من\s+)?(?:الادمن|الإدارة|الادارة|الاشراف|الإشراف|مشرف)?$/i.test(norm) ||
      norm.includes('نزل ده من الادمن') || norm.includes('نزل ده') || norm.includes('نزله من الادمن') || norm.includes('شيله من الادمن')
    ) {
      if (await requireAdmin(sock, m, 'التنزيل')) return true;
      const target = targetOf(m);
      if (!target) {
        await sendText(sock, m.jid, '👥 منشن الأدمن أو اعمل رد (Reply) على رسالته عشان أنزله عضو عادي!');
        return true;
      }
      try {
        await sock.groupParticipantsUpdate(m.jid, [target], 'demote');
        await sendText(sock, m.jid, `⬇️ من عيني! نزلت @${target.split('@')[0]} من الإدارة ورجع عضو عادي.`, { mentions: [target] });
      } catch {
        await sendText(sock, m.jid, '❌ مقدرتش أنزله — لازم مالك الجروب يعمل كده أو تكون رتبتي أعلى!');
      }
      return true;
    }

    if (
      /^(?:اطرد|اطرده|طرد|كرش|كرشه|طلع|طلعه|خرج|خرجه)\s*(?:ده|دا|هذا)?\s*(?:برا|برة|من\s+الجروب)?$/i.test(norm) ||
      norm.includes('اطرد ده') || norm.includes('اطرده') || norm.includes('كرش ده') || norm.includes('طلعه برا')
    ) {
      if (await requireAdmin(sock, m, 'طرد الأعضاء')) return true;
      const target = targetOf(m);
      if (!target) {
        await sendText(sock, m.jid, '👥 منشن العضو أو رد على رسالته عشان أطرده فوراً! 🦶');
        return true;
      }
      try {
        await sock.groupParticipantsUpdate(m.jid, [target], 'remove');
        await sendText(sock, m.jid, `🦶 مع السلامة! طردت @${target.split('@')[0]} من الجروب براحتكم بقا 😂`, { mentions: [target] });
      } catch {
        await sendText(sock, m.jid, '❌ مقدرتش أطرده — اتأكد إني أدمن في الجروب!');
      }
      return true;
    }

    if (
      /^(?:ادي|اديله|اعطي|اعطيه)?\s*(?:ده|دا|هذا)?\s*(?:انذار|إنذار|تحذير)$/i.test(norm) ||
      norm.includes('انذار') || norm.includes('اديله انذار')
    ) {
      if (await requireAdmin(sock, m, 'إعطاء إنذار')) return true;
      const target = targetOf(m);
      if (!target) {
        await sendText(sock, m.jid, '👥 منشن العضو أو رد على رسالته عشان أديله إنذار! ⚠️');
        return true;
      }
      const s = getSettings(m.jid);
      s.warns = s.warns || {};
      s.warns[target] = (s.warns[target] || 0) + 1;
      const currentWarns = s.warns[target];
      const maxWarns = s.maxWarns || 3;
      if (currentWarns >= maxWarns) {
        delete s.warns[target];
        await sock.groupParticipantsUpdate(m.jid, [target], 'remove').catch(() => {});
        await sendText(sock, m.jid, `⚠️ @${target.split('@')[0]} أخد الإنذار رقم (${currentWarns}/${maxWarns}) واتطرد تلقائياً لتجاوزه الحد الأقصى! 🚫`, { mentions: [target] });
      } else {
        await sendText(sock, m.jid, `⚠️ تنبيه يا @${target.split('@')[0]}! أخدت إنذار رسمي (${currentWarns}/${maxWarns}). لو وصلت ${maxWarns} هتتطرد! 🚨`, { mentions: [target] });
      }
      return true;
    }

    if (
      /^(?:منشن|نادي|نداء|اعمل\s+منشن)\s+(?:لل?كل|للجميع|للاعضاء|للأعضاء|جماعي)$/i.test(norm) ||
      norm === 'منشن للكل' || norm === 'منشن الكل' || norm === 'نداء للكل' || norm === 'تاق للكل'
    ) {
      if (await requireAdmin(sock, m, 'منشن الكل')) return true;
      const parts = await listParticipants(sock, m.jid);
      if (!parts?.length) {
        await sendText(sock, m.jid, '❌ مقدرتش أجيب أعضاء الجروب — اتأكد إني أدمن!');
        return true;
      }
      const jids = parts.slice(0, 100).map((p) => p.jid);
      const msgText = intent.text || 'يا شباب الجروب كله يجمع هنا في حاجة مهمة! 📢🔥';
      await sendQuickReplies(sock, m.jid, {
        title: '📢 نداء ومنشن جماعي',
        text: `${msgText}\n\n👥 عدد الأعضاء: ${jids.length}`,
        mentions: jids,
      });
      return true;
    }

    if (/^(?:اقفل|قفل|اغلق|سكر)\s+(?:الجروب|الشات|المجموعة|المجموعه)$/i.test(norm) || norm === 'اقفل الجروب' || norm === 'قفل الجروب') {
      if (await requireAdmin(sock, m, 'قفل الجروب')) return true;
      try {
        await sock.groupSettingUpdate(m.jid, 'announcement');
        await sendText(sock, m.jid, '🔒 تم قفل الجروب بنجاح! المشرفين بس هما اللي يقدروا يبعتوا رسايل دلوقتي 🤫');
      } catch {
        await sendText(sock, m.jid, '❌ مقدرتش أقفل الجروب — اتأكد إني أدمن!');
      }
      return true;
    }

    if (/^(?:افتح|فتح)\s+(?:الجروب|الشات|المجموعة|المجموعه)$/i.test(norm) || norm === 'افتح الجروب' || norm === 'فتح الجروب') {
      if (await requireAdmin(sock, m, 'فتح الجروب')) return true;
      try {
        await sock.groupSettingUpdate(m.jid, 'not_announcement');
        await sendText(sock, m.jid, '🔓 تم فتح الجروب بنجاح! الكل يقدر يشارك ويتكلم دلوقتي ونوروا الشات 🥳✨');
      } catch {
        await sendText(sock, m.jid, '❌ مقدرتش أفتح الجروب — اتأكد إني أدمن!');
      }
      return true;
    }

    if (/^(?:امسح|احذف)\s*(?:دي|ديه|الرسال[ةه]|الرسال[ةه]\s*دي)?$/i.test(norm)) {
      if (await requireAdmin(sock, m, 'حذف الرسائل')) return true;
      const ctx = m.message?.extendedTextMessage?.contextInfo;
      const quotedKey = ctx?.stanzaId ? {
        remoteJid: m.jid,
        fromMe: ctx.participant === sock.user?.id,
        id: ctx.stanzaId,
        participant: ctx.participant,
      } : null;
      if (!quotedKey) {
        await sendText(sock, m.jid, '🗑️ رد على الرسالة اللي عايز تمسحها واكتب "امسح دي"!');
        return true;
      }
      try {
        await sock.sendMessage(m.jid, { delete: quotedKey });
      } catch {
        await sendText(sock, m.jid, '❌ مقدرتش أمسح الرسالة — اتأكد إني أدمن في الجروب!');
      }
      return true;
    }
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
