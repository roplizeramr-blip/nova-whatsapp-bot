import { downloadContentFromMessage } from '@rexxhayanasi/elaina-baileys';
import { spawn } from 'node:child_process';
import axios from 'axios';
import ffmpegPath from 'ffmpeg-static';

// 🖼️ محرك الوسائط: تحميل الميديا من الرسايل + رفعها + تحويلها لملصقات

// ⚠️ كان Buffer.concat جوه اللوب = O(n²): كل chunk بيعيد نسخ Buffer كله.
// الصورة 15MB كانت بتعمل آلاف النسخ. نجمّع chunks ونضمّهم مرة واحدة في الآخر.
async function streamToBuffer(stream) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    total += chunk.length;
    if (total > MAX_MEDIA) {
      throw new Error('الملف كبير أوي (أكتر من 64 ميجا)');
    }
  }
  return Buffer.concat(chunks, total);
}

// 🛡️ سقف حجم الميديا — Railway معاه ذاكرة محدودة
const MAX_MEDIA = 64 * 1024 * 1024; // 64MB

// 🎙️ استخراج buffer الرسالة الصوتية (من الرسالة نفسها أو من رد عليها)
export async function voiceBuffer(m) {
  const ctx = m.message?.extendedTextMessage?.contextInfo;
  const quoted = ctx?.quotedMessage;
  const voice = quoted?.audioMessage ?? m.message?.audioMessage;
  if (!voice) return null;
  try {
    return await streamToBuffer(await downloadContentFromMessage(voice, 'audio'));
  } catch {
    return null;
  }
}

// ⬆️ رفع buffer لاستضافة مؤقتة مع خوادم احتياطية متعددة (Uguu -> Catbox -> Tmpfiles)
export async function uploadBuffer(buffer, fileName = 'media.jpg', mimeType = 'image/jpeg') {
  // 1) خادم Uguu
  try {
    const form = new FormData();
    form.append('files[]', new Blob([buffer], { type: mimeType }), fileName);
    const { data } = await axios.post('https://uguu.se/upload?output=json', form, { timeout: 25000 });
    const url = data?.url ?? data?.files?.[0]?.url;
    if (url) return url;
  } catch (err) {
    console.warn('⚠️ رفع Uguu تعذر، المحاولة مع الخادم الاحتياطي Catbox');
  }

  // 2) خادم Catbox الاحتياطي
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', new Blob([buffer], { type: mimeType }), fileName);
    const { data } = await axios.post('https://catbox.moe/user/api.php', form, { timeout: 25000 });
    if (typeof data === 'string' && data.startsWith('http')) return data.trim();
  } catch (err) {
    console.warn('⚠️ رفع Catbox تعذر، المحاولة مع Tmpfiles');
  }

  // 3) خادم Tmpfiles الاحتياطي
  try {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), fileName);
    const { data } = await axios.post('https://tmpfiles.org/api/v1/upload', form, { timeout: 25000 });
    const rawUrl = data?.data?.url;
    if (rawUrl) {
      // tmpfiles direct download link: insert /dl/ after domain
      return rawUrl.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
    }
  } catch (err) {
    console.error('❌ فشل رفع الملف على جميع خوادم الاستضافة:', err.message?.slice(0, 80));
  }

  return null;
}

// 🎙️ رسالة صوتية → رابط مؤقت (للشظام وفصل الصوت)
export async function audioToUrl(m) {
  const ctx = m.message?.extendedTextMessage?.contextInfo;
  const q = ctx?.quotedMessage;
  const voice = q?.audioMessage ?? m.message?.audioMessage;
  if (!voice) return null;
  try {
    const buffer = await streamToBuffer(await downloadContentFromMessage(voice, 'audio'));
    return await uploadBuffer(buffer, 'audio.mp3', 'audio/mpeg');
  } catch {
    return null;
  }
}

// الميديا المطلوبة: من رد على رسالة، أو من الصورة اللي مبعوطة مع الأمر نفسه
export async function getMediaSource(m) {
  if (!m) return null;
  const ctx = m.message?.extendedTextMessage?.contextInfo;
  const quoted = m.quoted || ctx?.quotedMessage;

  // 1) فحص الرسالة المقتبسة بجميع أشكالها (عادية، viewOnce، مستندات)
  const qImg =
    quoted?.imageMessage ||
    quoted?.viewOnceMessage?.message?.imageMessage ||
    quoted?.viewOnceMessageV2?.message?.imageMessage ||
    (quoted?.documentMessage?.mimetype?.startsWith('image/') ? quoted.documentMessage : null);

  if (qImg) {
    try {
      const buffer = await streamToBuffer(await downloadContentFromMessage(qImg, 'image'));
      if (buffer.length > 500) return { buffer, kind: 'image' };
    } catch {}\n    if (qImg.jpegThumbnail) {
      const thumb = Buffer.isBuffer(qImg.jpegThumbnail)
        ? qImg.jpegThumbnail
        : Buffer.from(qImg.jpegThumbnail);
      if (thumb.length > 300) return { buffer: thumb, kind: 'image' };
    }
  }

  const qVid =
    quoted?.videoMessage ||
    quoted?.viewOnceMessage?.message?.videoMessage ||
    quoted?.viewOnceMessageV2?.message?.videoMessage;

  if (qVid) {
    const seconds = qVid.seconds ?? 0;
    if (seconds > 8) return { error: 'الفيديو طويل — ابعت مقطع 8 ثواني أو أقل' };
    try {
      const buffer = await streamToBuffer(await downloadContentFromMessage(qVid, 'video'));
      return { buffer, kind: 'video' };
    } catch {}\n  }

  if (quoted?.stickerMessage) {
    try {
      return { buffer: await streamToBuffer(await downloadContentFromMessage(quoted.stickerMessage, 'sticker')), kind: 'sticker' };
    } catch {}\n  }

  // 2) فحص الرسالة الحالية نفسها
  const mImg =
    m.message?.imageMessage ||
    m.message?.viewOnceMessage?.message?.imageMessage ||
    m.message?.viewOnceMessageV2?.message?.imageMessage ||
    m.msg?.imageMessage ||
    (m.message?.documentMessage?.mimetype?.startsWith('image/') ? m.message.documentMessage : null);

  if (mImg) {
    try {
      const buffer = await streamToBuffer(await downloadContentFromMessage(mImg, 'image'));
      if (buffer.length > 500) return { buffer, kind: 'image' };
    } catch {}\n  }

  const mVid =
    m.message?.videoMessage ||
    m.message?.viewOnceMessage?.message?.videoMessage ||
    m.message?.viewOnceMessageV2?.message?.videoMessage ||
    m.msg?.videoMessage;

  if (mVid) {
    const seconds = mVid.seconds ?? 0;
    if (seconds > 8) return { error: 'الفيديو طويل — ابعت مقطع 8 ثواني أو أقل' };
    try {
      return { buffer: await streamToBuffer(await downloadContentFromMessage(mVid, 'video')), kind: 'video' };
    } catch {}\n  }

  return null;
}

// التحويل لملصق واتساب (webp 512×512) — صورة ثابتة أو متحركة من فيديو
export function toStickerWebp(buffer, kind) {
  return new Promise((resolve, reject) => {
    const pad = "scale='min(512,iw)':'min(512,ih)':force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white";
    const args =
      kind === 'video'
        ? ['-i', 'pipe:0', '-t', '6', '-vf', `fps=12,${pad}`, '-c:v', 'libwebp', '-lossless', '0', '-q:v', '75', '-loop', '0', '-an', '-preset', 'default', '-f', 'webp', 'pipe:1']
        : ['-i', 'pipe:0', '-vf', pad, '-c:v', 'libwebp', '-lossless', '0', '-q:v', '85', '-frames:v', '1', '-f', 'webp', 'pipe:1'];

    const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args]);
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', () => {});
    p.on('error', reject);
    p.on('close', (code) => {
      const out = Buffer.concat(chunks);
      if (code === 0 && out.length > 500) resolve(out);
      else reject(new Error(`فشل تحويل الملصق (كود ${code})`));
    });
    // ffmpeg ممكن يقفل بدري (باكرنج تالف) → EPIPE على stdin من غير handler = uncaughtException
    p.stdin.on('error', () => {});
    p.stdin.write(buffer);
    p.stdin.end();
  });
}
