import axios from 'axios';
import { config } from '../config.js';

// عميل موحد لـ API البوت — كل الأشكال هنا موثقة من التقرير الفعلي للـ API
const http = axios.create({
  baseURL: config.apiBaseUrl ?? 'https://engez.a7a.online',
  headers: { Accept: '*/*' },
  timeout: 30000,
});

// كشف "الفشل الصامت": HTTP 200 + success:false أو فشل داخلي
function unwrap(data, path) {
  if (!data || typeof data !== 'object') throw new Error(`رد غير متوقع من ${path}`);
  if (data.success === false) throw new Error(data.message ?? `فشل ${path}`);
  return data;
}

// 🔴 دائرة أمان — لكل endpoint لوحده.
//
// ⚠️ كانت العدّاد عام على الـ 22 endpoint كلهم: 5 إخفاقات من أي مصدر (حتى
// endpoint واحد ميت أو خطأ في بارامتر) كانت بتقفل الشات والصور والتحميل
// لكل الناس 3 دقايق كاملة. دلوقتي كل endpoint ليه عدّاده، فميت endpoint
// ميأثرش على الباقي. والـ endpoint لوحده بيختبر نفسه لما الوقت يخلص.
const FAIL_LIMIT = 4;
const OPEN_MS = 180000; // 3 دقايق

const breakers = new Map(); // path → { fails, openUntil, notified, state }
let ownerNotifier = null;
let statusListeners = new Set();

export function setOwnerNotifier(fn) {
  ownerNotifier = fn;
}

// الداشبورد كان بيقول "شغال" دايمًا (setApiStatus معرّفة ومش متنادى)
export function onApiStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function publishStatus() {
  const now = Date.now();
  const open = [...breakers.values()].filter((b) => b.openUntil > now).length;
  const status = open ? 'degraded' : 'ok';
  for (const fn of statusListeners) {
    try {
      fn(status, open);
    } catch {}
  }
  return status;
}

function notifyOwner(text) {
  try {
    ownerNotifier?.(text);
  } catch {}
}

function breakerOf(path) {
  let b = breakers.get(path);
  if (!b) {
    b = { fails: 0, openUntil: 0, notified: false, state: 'unknown' };
    breakers.set(path, b);
  }
  return b;
}

async function get(path, params = {}, timeout = 30000) {
  const b = breakerOf(path);

  if (Date.now() < b.openUntil) {
    throw new Error('الـ API في وضع آمن مؤقت — استنى شوية');
  }

  try {
    const { data } = await http.get(path, { params, timeout });
    const result = unwrap(data, path); // success:false يعتبر فشلًا، لا تعافياً
    // ✅ لم نعلن التعافي إلا بعد رد سليم فعلاً
    if (b.notified) notifyOwner(`🟢 الـ API رجع يشتغل: ${path}`);
    b.notified = false;
    b.state = 'ok';
    b.fails = 0;
    publishStatus();
    return result;
  } catch (err) {
    b.state = 'degraded';
    b.fails++;
    if (b.fails >= FAIL_LIMIT && Date.now() >= b.openUntil) {
      b.openUntil = Date.now() + OPEN_MS;
      b.state = 'open';
      b.fails = 0;
      b.notified = true;
      console.error(`🔴 ${path} دخل وضع آمن ${OPEN_MS / 1000} ثانية (فشل متكرر)`);
      notifyOwner(`🔴 تنبيه: ${path} فشل ${FAIL_LIMIT} مرات — وضع آمن ${OPEN_MS / 1000} ثانية`);
    }
    publishStatus();
    throw err;
  }
}

async function post(path, body = {}, timeout = 30000) {
  const b = breakerOf(path);

  if (Date.now() < b.openUntil) {
    throw new Error('الـ API في وضع آمن مؤقت — استنى شوية');
  }

  try {
    const { data } = await http.post(path, body, { timeout });
    const result = unwrap(data, path);
    if (b.notified) notifyOwner(`🟢 الـ API رجع يشتغل: ${path}`);
    b.notified = false;
    b.state = 'ok';
    b.fails = 0;
    publishStatus();
    return result;
  } catch (err) {
    b.state = 'degraded';
    b.fails++;
    if (b.fails >= FAIL_LIMIT && Date.now() >= b.openUntil) {
      b.openUntil = Date.now() + OPEN_MS;
      b.state = 'open';
      b.fails = 0;
      b.notified = true;
      console.error(`🔴 ${path} دخل وضع آمن ${OPEN_MS / 1000} ثانية (فشل متكرر)`);
      notifyOwner(`🔴 تنبيه: ${path} فشل ${FAIL_LIMIT} مرات — وضع آمن ${OPEN_MS / 1000} ثانية`);
    }
    publishStatus();
    throw err;
  }
}

const vexHttp = axios.create({
  baseURL: 'https://johan-vex-apis.vercel.app',
  headers: { Accept: '*/*' },
  timeout: 60000,
});

async function vexGet(path, params = {}, timeout = 60000) {
  const b = breakerOf(`vex:${path}`);

  if (Date.now() < b.openUntil) {
    throw new Error('خدمة VEX في وضع آمن مؤقت — استنى شوية');
  }

  try {
    const res = await vexHttp.get(path, {
      params,
      timeout,
      validateStatus: (status) => status < 500,
    });
    const data = res.data;

    // 404 في البحث يعني مفيش نتائج مطابقة — ليس عطلاً في الخادم
    if (
      res.status === 404 ||
      (data && data.success === false && /لا توجد نتائج|not found/i.test(data.error || data.message || ''))
    ) {
      b.state = 'ok';
      b.fails = 0;
      return { success: true, results: [], data: [] };
    }

    const result = unwrap(data, path);
    if (b.notified) notifyOwner(`🟢 VEX API رجع يشتغل: ${path}`);
    b.notified = false;
    b.state = 'ok';
    b.fails = 0;
    publishStatus();
    return result;
  } catch (err) {
    b.state = 'degraded';
    b.fails++;
    if (b.fails >= FAIL_LIMIT && Date.now() >= b.openUntil) {
      b.openUntil = Date.now() + OPEN_MS;
      b.state = 'open';
      b.fails = 0;
      b.notified = true;
      console.error(`🔴 VEX ${path} دخل وضع آمن ${OPEN_MS / 1000} ثانية`);
      notifyOwner(`🔴 تنبيه: VEX ${path} فشل ${FAIL_LIMIT} مرات — وضع آمن ${OPEN_MS / 1000} ثانية`);
    }
    publishStatus();
    throw err;
  }
}

// حالة الـ API كلها (للسجل والداشبورد)
export function apiHealth() {
  const now = Date.now();
  const down = [...breakers.entries()]
    .filter(([, b]) => b.openUntil > now)
    .map(([p]) => p);
  return { status: down.length ? 'degraded' : 'ok', down, openCount: down.length };
}

// 🛑 هل الـ endpoint ده في وضع آمن دلوقتي؟
// ai.js بيسأل ده قبل ما يحاول: مزوّد ميت (GPT 500 كل مرة) كان بيكلّف
// 2-3 ثواني في كل رسالة قبل ما يوصل لـ Groq.
export function isOpen(path) {
  const b = breakers.get(path);
  return !!b && b.openUntil > Date.now();
}

// 🕳️ مزوّد رجّع success بمحتوى فاضي = فشل، مش نجاح.
// ما نعدّش الرد الفاضي كأنه رجع سليم؛ وإلا الخدمة المعطلة تعيد نفسها كل طلب.
export function noteEmpty(path) {
  const b = breakerOf(path);
  if (b.openUntil > Date.now()) return;

  b.fails++;
  b.state = 'degraded';
  if (b.fails >= FAIL_LIMIT) {
    b.openUntil = Date.now() + OPEN_MS;
    b.state = 'open';
    b.fails = 0;
    b.notified = true;
    console.log(`🟡 ${path} بيرجّع رد فاضي — نقفله ${OPEN_MS / 1000} ثانية`);
    notifyOwner(`🟡 ${path} بيرجّع رد فاضي — وضع آمن ${OPEN_MS / 1000} ثانية`);
  }
  publishStatus();
}

// أي مزوّد ذكاء اصطناعي شغال فعلاً دلوقتي
export function aiProviderStatus() {
  const status = (path) => {
    const b = breakerOf(path);
    if (b.openUntil > Date.now()) return 'open';
    return b.state;
  };
  return {
    gpt: status('/api/v1/ai/gpt'),
    gemini: status('/api/v1/ai/gemini'),
  };
}

const s = (v) => (v == null ? 'null' : String(v));

export const api = {
  // ━━━━━━━━━ 🤖 الذكاء ━━━━━━━━━
  async gpt(q) {
    const d = await get('/api/v1/ai/gpt', { q }, 60000);
    return d.response?.result?.message ?? d.response?.raw ?? '';
  },

  async gemini(q, { instruction, sessionId } = {}) {
    const d = await get(
      '/api/v1/ai/gemini',
      { action: 'تحدث', q, instruction: s(instruction), sessionId: s(sessionId) },
      90000,
    );
    return { reply: d.response?.reply ?? '', sessionId: d.response?.sessionId ?? null };
  },

  async simsimi(message) {
    const d = await get('/api/v1/ai/ai/simsimi', { action: 'تكلم', message }, 30000);
    return d.response?.reply ?? '';
  },

  // صورة بالذكاء الاصطناعي — VEX Flux أساسي، Engez Flux احتياطي، MagicStudio احتياطي ثانٍ
  async image(prompt, { model = '1', pretty = false, ratio = '1:1' } = {}) {
    let lastErr;
    // 1. الأساسي: VEX AI (Flux 100% شغال ومتحقق)
    try {
      const vexUrl = await this.vexAiImage(prompt, { model: 'flux', ratio });
      if (vexUrl) return vexUrl;
    } catch (err) {
      lastErr = err;
    }

    // 2. الاحتياطي: Flux عبر Engez /api/v1/ai/imageai
    try {
      const d = await get(
        '/api/v1/ai/imageai',
        { action: 'توليد', prompt, model: String(model) },
        30000,
      );
      if (d.response?.url) return d.response.url;
    } catch (err) {
      lastErr = err;
    }

    // 3. الاحتياطي الثاني: MagicStudio عبر /api/v1/ai/image-generator
    try {
      const d = await get(
        '/api/v1/ai/image-generator',
        { action: 'generate', prompt, model: '4' },
        30000,
      );
      if (d.response?.url) return d.response.url;
    } catch (err) {
      lastErr = err;
    }

    throw lastErr ?? new Error('فشل توليد الصورة');
  },

  async chatgpt(prompt) {
    try {
      const d = await get('/api/v1/ai/chatgpt', { prompt }, 60000);
      return d.response?.result?.message ?? d.response?.reply ?? d.response?.raw ?? d.response ?? '';
    } catch {
      const d = await get('/api/v1/ai/gpt', { q: prompt }, 60000);
      return d.response?.result?.message ?? d.response?.raw ?? '';
    }
  },

  async copilot(q) {
    try {
      const d = await get('/api/v1/ai/copilot', { q }, 60000);
      return d.response?.result?.message ?? d.response?.message ?? d.response?.raw ?? d.response ?? '';
    } catch {
      const d = await get('/api/v1/ai/', { q }, 60000);
      return d.response?.result?.message ?? d.response?.message ?? d.response?.raw ?? d.response ?? '';
    }
  },

  async video(prompt, { ratio = '16:9', duration = 5, fps = 8, motion = 50, aiSound = false } = {}) {
    const d = await get(
      '/api/v1/ai/video-gen',
      { action: 'txt2video', prompt, duration, fps, motion, ratio, aiSound },
      120000,
    );
    return d.response?.url ?? null;
  },

  // ━━━━━━━━━ 🎙️ الصوت ━━━━━━━━━
  // 🎙️ TTS بصوت طبيعي — بارامترات محسّنة: stability أقل = حي أكتر + سرعة أقل = دافي
  async tts(text, { voice = '12', dialect = 'fusha', stability = 0.35, speed = 0.92 } = {}) {
    const d = await get(
      '/api/v1/tools/elevenlab',
      {
        action: 'توليد',
        text,
        voice,
        dialect,
        model: 'faseeh-v1-preview',
        stability,
        speed,
        sampleRate: 48000,
      },
      60000,
    );
    return d.response?.url ?? null;
  },

  async animeTts(text, voice = 'غوكو') {
    const d = await get('/api/v1/tools/anime-tts', { action: 'تكلم', text, voice }, 60000);
    return d.response?.url ?? d.response?.audio ?? (typeof d.response === 'string' ? d.response : null);
  },

  // ━━━━━━━━━ 📥 التحميل والبحث ━━━━━━━━━
  async ytSearch(q, limit = 5) {
    // 1) سكرابر يوتيوب المباشر فائق السرعة (~1.2 ثانية) — يمنع تماماً أخطاء الـ Timeout 30s
    try {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
      const { data } = await axios.get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'ar,en;q=0.9',
        },
        timeout: 9000,
      });
      const match = data.match(/var ytInitialData = ({.*?});<\/script>/) || data.match(/ytInitialData\s*=\s*({.+?});/);
      if (match) {
        const json = JSON.parse(match[1]);
        const contents =
          json?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]
            ?.itemSectionRenderer?.contents || [];
        const results = [];
        for (const item of contents) {
          const v = item?.videoRenderer;
          if (!v?.videoId) continue;
          results.push({
            index: results.length,
            id: v.videoId,
            title: String(v.title?.runs?.[0]?.text || 'فيديو يوتيوب'),
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            thumbnail: v.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            duration: v.lengthText?.simpleText || '',
            author: v.ownerText?.runs?.[0]?.text || '',
          });
          if (results.length >= limit) break;
        }
        if (results.length > 0) return results;
      }
    } catch (err) {
      console.warn('⚠️ تعذر سكرابر يوتيوب المباشر، جاري التبديل لمحرك yt-dlp:', err.message);
    }

    // 2) المحرك الاحتياطي: yt-dlp flat-search
    try {
      const youtubedl = (await import('youtube-dl-exec')).default;
      const res = await youtubedl(`ytsearch${limit}:${q}`, {
        dumpSingleJson: true,
        flatPlaylist: true,
        noWarnings: true,
        defaultSearch: 'ytsearch',
      });
      const results = (res.entries || []).map((e, i) => ({
        index: i,
        id: e.id,
        title: String(e.title || 'فيديو يوتيوب'),
        url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
        thumbnail: e.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
        duration: e.duration ? `${Math.floor(e.duration / 60)}:${String(e.duration % 60).padStart(2, '0')}` : '',
        author: e.uploader || '',
      }));
      if (results.length > 0) return results;
    } catch (err) {
      console.warn('⚠️ تعذر محرك yt-dlp للبحث:', err.message);
    }

    return [];
  },

  // type: 'audio' | 'video' — الجودة: 128 للصوت، 360/720 للفيديو
  async ytDownload(url, { type = 'audio', quality = '128' } = {}) {
    const d = await get('/api/v1/download/youtube', { url, type, quality }, 120000);
    const out = d.data ?? {};
    return { title: out.title, url: out.download_url ?? null, source: out.source_used };
  },

  async tiktokDownload(url) {
    const d = await get('/api/v1/download/tiktok', { url, quality: 'hd', source: 'musicaldown' }, 60000);
    return d.response?.video ?? d.response?.wm ?? null;
  },

  // ━━━━━━━━━ 🛠️ أدوات ━━━━━━━━━
  async translate(text, to = 'ar', from = 'auto') {
    const d = await get('/api/v1/tools/translate', { action: 'translate', text, to, from, engine: 'google' });
    return { translated: d.response?.translated ?? '', from: d.response?.fromName ?? from };
  },

  async lyrics(query, artist = '', title = '') {
    const params = { action: 'search', query };
    if (artist) params.artist = artist;
    if (title) params.title = title;
    const d = await get('/api/v1/tools/lyrics', params);
    const resp = d.response ?? d.data ?? d;
    return {
      title: resp?.title ?? query ?? '',
      artist: resp?.artist ?? '',
      lyrics: resp?.lyrics ?? '',
    };
  },

  async gifSearch(q, limit = 5) {
    const d = await get('/api/v1/tools/gif-search', { action: 'بحث', q, limit });
    return (d.results ?? []).map((r) => r.url);
  },

  async nsfwCheck(imageUrl) {
    const d = await get('/api/v1/tools/nsfw-checker', { action: 'تحقق', imageUrl }, 15000);
    return { isNSFW: !!d.response?.isNSFW, label: d.response?.label, confidence: d.response?.confidence };
  },

  async checkNum(num) {
    const d = await get('/api/v1/tools/checknum', { num });
    return d.response ?? {};
  },

  // 👁️ وصف صورة بالذكاء الاصطناعي (لرؤية الصور)
  async img2prompt(imageUrl, { language = 'ar' } = {}) {
    const d = await get(
      '/api/v1/tools/img2prompt',
      { action: 'توليد', imageUrl, language, translate: true, instruction: 'detail' },
      60000,
    );
    return { arabic: d.response?.arabic ?? '', english: d.response?.english ?? '' };
  },

  // 🎵 التعرف على الأغنية من صوت
  async shazem(audioUrl) {
    const d = await get(
      '/api/v1/tools/shazem',
      { action: 'تعرف', audioUrl, startTime: 0, clipSeconds: 30 },
      90000,
    );
    return d.response ?? null;
  },

  // 🎤 فصل الغناء عن الموسيقى
  async vocalRemover(url) {
    const d = await get('/api/v1/tools/vocal-remover', { action: 'فصل', url }, 120000);
    return { vocal: d.response?.vocal ?? null, music: d.response?.music ?? null };
  },

  // 📚 مانجا ومانهوا
  async manhwaSearch(q) {
    const d = await get('/api/v1/anime/manhwa', { action: 'بحث', q });
    return d.response?.results ?? [];
  },

  async manhwaInfo(slug) {
    const d = await get('/api/v1/anime/manga-1', { action: 'معلومات', slug, type: 'manhwa' });
    // ⚠️ كان بيرجّع الـ envelope كله (success + response) — وكل الـ methods
    // التانية بترجّع d.response، فـ manga.js كان بيقرا info.cover و
    // info.title من على الغلاف فكانوا undefined وبيطلع كارت فاضي.
    return d.success ? (d.response ?? d) : null;
  },

  // 📖 روايات وات باد
  async wattpadSearch(q, limit = 5) {
    const d = await get('/api/v1/reading/wattpad', { action: 'بحث', q, limit });
    return d.results ?? [];
  },

  async removeBg(imageUrl) {
    const d = await get('/api/v1/tools/removebg', { action: 'ازالة', imageUrl }, 120000);
    return d.response?.url ?? null;
  },

  // 🎵 سبوتيفاي — بحث رسمي بالأغاني والتراكات
  async spotifySearch(q, limit = 10) {
    const d = await get('/api/v1/search/spotify', { q, limit });
    const items = d.response?.results ?? d.results ?? d.response ?? [];
    return (Array.isArray(items) ? items : [])
      .filter((r) => r && (r.url || r.name || r.title))
      .map((r, i) => ({
        index: r.index ?? i,
        name: String(r.name ?? r.title ?? 'بدون عنوان').trim(),
        title: String(r.name ?? r.title ?? 'بدون عنوان').trim(),
        artist: String(r.artist ?? r.artists ?? 'غير معروف').trim(),
        album: String(r.album ?? '').trim(),
        duration: String(r.duration ?? '').trim(),
        cover: r.cover ?? r.thumbnail ?? r.image ?? null,
        url: r.url ?? '',
      }));
  },

  // 📱 تيك توك — بحث بالمحتوى والفيديوهات
  async tiktokSearch(query) {
    const d = await get('/api/v1/search/tiktok', { query });
    const items = d.response?.results ?? d.results ?? d.response ?? [];
    return (Array.isArray(items) ? items : [])
      .filter((r) => r && typeof r === 'object')
      .map((r, i) => ({
        index: r.index ?? i,
        id: r.id ?? String(i),
        desc: String(r.desc ?? r.title ?? '').trim(),
        title: String(r.desc ?? r.title ?? 'فيديو تيك توك').trim(),
        hashtags: Array.isArray(r.hashtags) ? r.hashtags : [],
        author: {
          name: String(r.author?.name ?? r.author?.username ?? 'مجهول'),
          username: String(r.author?.username ?? ''),
          avatar: r.author?.avatar ?? null,
        },
        stats: {
          plays: String(r.stats?.plays ?? '0'),
          likes: String(r.stats?.likes ?? '0'),
          comments: String(r.stats?.comments ?? '0'),
          shares: String(r.stats?.shares ?? '0'),
        },
        video: {
          download_url: r.video?.download_url ?? r.video?.url ?? r.url ?? '',
          download_url_hd: r.video?.download_url_hd ?? '',
          thumbnail: r.video?.thumbnail ?? r.thumbnail ?? null,
          duration: String(r.video?.duration ?? ''),
        },
        music: {
          title: String(r.music?.title ?? ''),
          author: String(r.music?.author ?? ''),
          download_url: r.music?.download_url ?? null,
        },
        url: r.url ?? r.video?.download_url ?? '',
      }));
  },

  // 📌 بينترست — بحث صور
  async pinimg(q, limit = 6) {
    const d = await get('/api/v1/search/pinimg', { q, limit });
    const items = d.response?.results ?? d.results ?? d.response ?? [];
    return (Array.isArray(items) ? items : [])
      .filter((r) => r && (r.image || r.url))
      .map((r, i) => ({
        index: r.index ?? i,
        id: r.id ?? String(i),
        title: String(r.title ?? r.description ?? 'صورة بينترست').trim() || 'صورة بينترست',
        description: String(r.description ?? '').trim(),
        image: r.image ?? r.url ?? null,
        url: r.url ?? r.image ?? null,
      }));
  },

  // 📦 ميديا فاير — فك وتحميل الروابط
  async mediafire(url) {
    const d = await get('/api/v1/download/mediafire', { url }, 60000);
    return d.response ?? d.data ?? null;
  },

  // 👥 فيسبوك — تحميل احتياطي
  async fbDownload(url) {
    const d = await get('/api/v1/download/facebook', { url }, 60000);
    return d.response ?? d.data ?? null;
  },

  // 💻 تشغيل كود — Remote Code Runner
  async executeCode(code) {
    const d = await post('/api/__v0/_execute', { code }, 30000);
    return d.result ?? d;
  },

  // ━━━━━━━━━ 🌐 VEX API (https://johan-vex-apis.vercel.app) ━━━━━━━━━

  // 🎨 تعديل الصور بالذكاء الاصطناعي — Nano Banana AI مع حماية من أخطاء الـ Upstream 500
  async vexEditImage(imageUrl, prompt) {
    try {
      const d = await vexGet('/api/tools/nanobanan', { url: imageUrl, prompt }, 30000);
      return d?.data?.result_url ?? d?.result_url ?? d?.url ?? null;
    } catch {
      return null;
    }
  },

  // 🎨 توليد الصور المباشر فائق الجودة عبر VEX AI (Flux)
  async vexAiImage(prompt, { model = 'flux', ratio = '1:1' } = {}) {
    try {
      const d = await vexGet(
        '/api/ai/ai-image',
        { prompt, model, aspect_ratio: ratio },
        35000,
      );
      return d?.result ?? d?.data?.result ?? d?.url ?? null;
    } catch {
      return null;
    }
  },

  // 📱 تطبيقات وألعاب أندرويد APK
  async vexApk(q, limit = 3) {
    const d = await vexGet('/api/search/apk', { q, limit });
    const items = d.results ?? d.data ?? [];
    return (Array.isArray(items) ? items : []).map((app) => ({
      name: String(app.name ?? '').trim(),
      uname: String(app.uname ?? '').trim(),
      package: String(app.package ?? '').trim(),
      version: String(app.version ?? '').trim(),
      sizeHuman: String(app.sizeHuman ?? app.size ?? '').trim(),
      malware: String(app.malware ?? '').trim(),
      rating: Number(app.rating) || 0,
      downloads: Number(app.downloads) || 0,
      apkUrl: String(app.apkUrl ?? app.download_url ?? app.url ?? '').trim(),
      pageUrl: String(app.pageUrl ?? '').trim(),
      icon: app.icon ?? null,
    }));
  },

  // 🗣️ تحويل النص إلى صوت مشاهير وشخصيات
  async vexTts(text, voice = 'messi') {
    const d = await vexGet('/api/ai/tts', { text, voice, format: 'json' });
    return d.audio_url ?? d.data?.audio_url ?? d.url ?? null;
  },

  // 🎬 أفلام ومسلسلات من موقع أكوام
  async vexAkwam(q) {
    const d = await vexGet('/api/search/akwam', { q });
    const items = d.results ?? d.data ?? [];
    return (Array.isArray(items) ? items : []).map((m) => ({
      title: String(m.title ?? '').trim(),
      type: String(m.type ?? '').trim(),
      year: String(m.year ?? '').trim(),
      rating: String(m.rating ?? '').trim(),
      quality: String(m.quality ?? '').trim(),
      poster: m.poster ?? m.image ?? null,
      url: String(m.url ?? '').trim(),
    }));
  },

  // 🎵 بحث ساوندكلاود
  async vexSoundcloud(q, action = 'search') {
    const d = await vexGet('/api/search/soundcloud', { q, action });
    return d.results ?? d.data ?? [];
  },

  // 🤖 جيميناي السريع فائق الاستجابة — VEX Gemini
  async vexGemini(prompt) {
    const d = await vexGet('/api/ai/gemini', { prompt }, 12000);
    return d.reply ?? d.data?.reply ?? d.response ?? '';
  },
};

export default api;
