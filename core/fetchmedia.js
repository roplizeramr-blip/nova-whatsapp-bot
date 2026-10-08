import axios from 'axios';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

// 🌐 جلب الوسائط من غير ما نتعامل مع واتساب
//
// ⚠️ المشكلة:الـ API بيرجّع لينك زي savenow.to بيحوّل (redirect) لصفحة
// HTML فيها meta-refresh — مش ملف صوت/فيديو. لو بعتنا اللينك لواتساب على طول
// فيرفض (media upload failed)، ولو نزّلناه إحنا كنا بنجيب HTML وبنحاول نحوّله
// بـ ffmpeg فبفشل. الحل: ننزّل إحنا، نتبع التحويلات، نتأكد إن اللي
// نزل media فعلاً، وبعدين نبعت الـ buffer.

const MAX_BYTES = 64 * 1024 * 1024; // 64MB
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const isAudio = (t) => /^(audio|application\/ogg)/i.test(t ?? '');
const isVideo = (t) => /^video/i.test(t ?? '');
const isImage = (t) => /^image\//i.test(t ?? '');

// 📁 امتداد الملف من اللينك
function extOf(url = '') {
  try {
    const clean = String(url).split(/[?#]/)[0];
    const last = clean.slice(clean.lastIndexOf('/') + 1);
    const dot = last.lastIndexOf('.');
    return dot > -1 ? last.slice(dot + 1).toLowerCase() : '';
  } catch {
    return '';
  }
}

const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'mpeg', 'mpg', 'amr', 'weba']);
const VIDEO_EXT = new Set(['mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', '3gp']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'ico']);

export function detectKindFromBuffer(buf) {
  if (!buf || buf.length < 4) return null;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image';
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image';
  // GIF: GIF8
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image';
  // WebP: RIFF....WEBP
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image';
  // MP4: ....ftyp
  if (buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') return 'video';
  // OGG: OggS
  if (buf.toString('ascii', 0, 4) === 'OggS') return 'audio';
  // MP3: ID3 or sync frame
  if (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'audio';
  return null;
}

/**
 * تصنيف الملف — بالامتداد الأول، لأن الـ content-type بيغلط كتير:
 * elevenlabs بيرجّع `.mpeg` صوتي بس السيرفر بيبعته `video/mpeg`، فكان
 * بيتصنّف فيديو ويت رفض مع إن الملف سليم.
 */
function kindOf(type = '', url = '') {
  const t = String(type).split(';')[0].trim();
  const ext = extOf(url);

  if (ext && AUDIO_EXT.has(ext)) return 'audio';
  if (ext && VIDEO_EXT.has(ext)) return 'video';
  if (ext && IMAGE_EXT.has(ext)) return 'image';

  if (/^audio\//i.test(t)) return 'audio';
  if (/^video\//i.test(t)) return 'video';
  if (/^image\//i.test(t)) return 'image';
  if (/application\/ogg/i.test(t)) return 'audio';
  if (/application\/(mp4|x-matroska)/i.test(t)) return 'video';
  return null;
}

// 🔁 meta refresh في HTML: <meta http-equiv="refresh" content="0; url=...">
function metaRefresh(html) {
  const m = html.match(/http-equiv=["']?refresh["']?[^>]*content=["']?[^"']*url=([^"';]+)/i);
  if (!m) return null;
  // الرابط قد يكون نسبيًا؛ joinUrl يحله نسبةً لعنوان الصفحة الحالية.
  return m[1].trim();
}

function joinUrl(base, href) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * ينزّل الوسائط ويحل التحويلات (HTTP + meta-refresh)
 * @returns {{buffer: Buffer, type: string, kind: string}}
 */
export async function fetchMedia(url, { expect = null, headers = {}, timeout = 25000, maxRedirects = 6 } = {}) {
  if (Buffer.isBuffer(url)) {
    const kind = detectKindFromBuffer(url) || expect || 'image';
    return { buffer: url, type: kind === 'image' ? 'image/jpeg' : 'application/octet-stream', kind };
  }

  let current = String(url || '').trim();
  if (!current) throw new Error('رابط الوسائط غير صالح');

  // ⚡ مسار الجلب السريع والمباشر عبر native fetch (أسرع وأضمن مع خوادم الصور مثل i.ibb.co)
  if (typeof fetch === 'function' && /^https?:\/\//i.test(current)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(timeout, 12000));
      const res = await fetch(current, {
        signal: controller.signal,
        headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
      });
      clearTimeout(timer);
      if (res.ok) {
        const type = res.headers.get('content-type') || '';
        if (!/^text\/html/i.test(type)) {
          const ab = await res.arrayBuffer();
          const buf = Buffer.from(ab);
          if (buf.length >= 500) {
            let kind = kindOf(type, current) || detectKindFromBuffer(buf);
            if (!kind && expect && /octet-stream|binary/i.test(type)) kind = expect;
            if (kind && (!expect || kind === expect)) {
              return { buffer: buf, type: type || 'image/jpeg', kind };
            }
          }
        }
      }
    } catch {}
  }

  for (let hop = 0; hop < maxRedirects; hop++) {
    const res = await axios.get(current, {
      responseType: 'arraybuffer',
      timeout,
      maxRedirects: 0, // بنتابعها بنفسنا عشان نلمس meta-refresh كمان
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
    });

    // ↪️ تحويل HTTP عادي
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      const next = joinUrl(current, res.headers.location);
      if (!next) throw new Error('رابط التحويل تالف');
      current = next;
      continue;
    }

    const type = res.headers['content-type'] ?? '';
    const buf = Buffer.from(res.data);

    // 📄 صفحة HTML = غالبًا meta-refresh → نتبعها
    if (/^text\/html/i.test(type) && buf.length < 200000) {
      const html = buf.toString('utf8');
      const next = metaRefresh(html);
      if (next) {
        const abs = joinUrl(current, next);
        if (abs) {
          current = abs;
          continue;
        }
      }
      // HTML مش redirect = صفحة خطأ/كابشن
      throw new Error('الرابط رجّع صفحة ويب مش ملف (كابشن أو حماية)');
    }

    let kind = kindOf(type, current) || detectKindFromBuffer(buf);
    if (!kind && expect) {
      if (/octet-stream|binary/i.test(type)) {
        kind = expect;
      }
    }
    if (!kind) {
      throw new Error(`نوع ملف غير متوقع: ${type || 'مجهول'}`);
    }
    if (expect && kind !== expect) {
      throw new Error(`متوقع ${expect}—was ${kind}`);
    }
    if (buf.length < 500) {
      throw new Error('الملف صغير أوي أو فاضي');
    }

    return { buffer: buf, type, kind };
  }

  throw new Error('تحويلات كتير أوي — اللينك مش صالح');
}

import nodeFs from 'node:fs';

// 🔊 تحويل أي صوت لـ OGG/Opus (وده اللي WhatsApp بطلبه للـ voice note)
function getFfmpeg() {
  if (ffmpegPath) {
    try {
      if (nodeFs.existsSync(ffmpegPath)) return ffmpegPath;
    } catch {}
  }
  return 'ffmpeg';
}

function requireFfmpeg() {
  const bin = getFfmpeg();
  if (!bin) throw new Error('ffmpeg غير موجود على الخادم');
}

export function toOggOpus(buffer, { bitrate = '64k', sampleRate = '48000' } = {}) {
  requireFfmpeg();
  return new Promise((resolve, reject) => {
    const p = spawn(getFfmpeg(), [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-c:a', 'libopus', '-b:a', bitrate, '-ar', sampleRate, '-ac', '1',
      '-vbr', 'on', '-compression_level', '10',
      '-f', 'ogg', 'pipe:1',
    ]);
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', () => {});
    p.on('error', reject);
    p.on('close', (code) => {
      const out = Buffer.concat(chunks);
      if (code === 0 && out.length > 100) resolve(out);
      else reject(new Error(`ffmpeg فشل (كود ${code})`));
    });
    // ffmpeg ممكن يقفل بدري → EPIPE على stdin من غير handler = uncaughtException
    p.stdin.on('error', () => {});
    p.stdin.write(buffer);
    p.stdin.end();
  });
}

// 🎬 تحويل أي فيديو لـ MP4 (واتساب بيشترط H.264 و yuv420p و AAC و faststart)
export function toMp4(buffer, { height = 720 } = {}) {
  requireFfmpeg();
  return new Promise((resolve, reject) => {
    const p = spawn(getFfmpeg(), [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vf', `scale=trunc(iw/2)*2:trunc(ih/2)*2,scale=-2:min(${height},ih)`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-preset', 'veryfast', '-crf', '28',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-f', 'mp4', 'pipe:1',
    ]);
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', () => {});
    p.on('error', reject);
    p.on('close', (code) => {
      const out = Buffer.concat(chunks);
      if (code === 0 && out.length > 1000) resolve(out);
      else reject(new Error(`ffmpeg فشل (كود ${code})`));
    });
    p.stdin.on('error', () => {});
    p.stdin.write(buffer);
    p.stdin.end();
  });
}

// 🖼️ تحويل لـ WebP/JPEG (لصور اللي رجعتها APIs بشكل غريب)
export function toJpeg(buffer) {
  requireFfmpeg();
  return new Promise((resolve, reject) => {
    const p = spawn(getFfmpeg(), [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vf', "scale='min(1280,iw)':-2",
      '-q:v', '4',
      '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1',
    ]);
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', () => {});
    p.on('error', reject);
    p.on('close', (code) => {
      const out = Buffer.concat(chunks);
      if (code === 0 && out.length > 200) resolve(out);
      else reject(new Error(`ffmpeg فشل (كود ${code})`));
    });
    p.stdin.on('error', () => {});
    p.stdin.write(buffer);
    p.stdin.end();
  });
}

export { isAudio, isVideo, isImage, kindOf };
