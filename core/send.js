import axios from 'axios';
import { MB } from '@rexxhayanasi/elaina-baileys';
import { config } from '../config.js';
import { bump } from './stats.js';
import { fetchMedia, toOggOpus, toMp4, toJpeg } from './fetchmedia.js';

// ⚠️ قواعد الأزرار في واتساب (من كود واتساب ويب نفسه):
// - الأزرار السريعة (quick_reply) لحد 10 لكل رسالة
// - الأنواع التانية (روابط/نسخ/مكالمات) لحد 3 لكل رسالة
// - الأنواع ممنوع تختلط مع بعض في رسالة واحدة — العميل بيرفض الرسالة كلها
// - قوائم single_select بتظهر على أندرويد بس، وباقي الأجهزة بتحوّلها نص
//
// عقد الـ helpers هنا: ولا دالة بترمي استثناء خام للمستدعي — أي فشل بيتسجّل
// في اللوج وبيترجّع fallback نصي بسيط. المنشن بيمرّ زي ما هو في extra
// (mentions) — واتساب بيفهم LID ورقم على السواء.

function defaultFooter() {
  return `${config.botName} ${config.botEmoji}`;
}

// 🔁 إعادة محاولة الأخطاء العابرة — ومضة شبكة واحدة ما تضيعش رد المستخدم.
// الأخطاء الدايمة (وسائط مرفوضة/رابط بايظ) بترجع فورًا من غير تأخير.
const TRANSIENT_RE = /timed? ?out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|socket hang up|connection closed|stream errored|precondition failed|rate-?over-?limit|too many requests|service unavailable|bad gateway|gateway time-?out|429|502|503|504/i;

function isTransient(err) {
  const code = err?.output?.statusCode ?? err?.status;
  if (code === 429 || code === 502 || code === 503 || code === 504) return true;
  return TRANSIENT_RE.test(String(err?.message ?? err ?? ''));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(label, fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isTransient(err)) break;
      const delay = 700 * 2 ** i; // 700ms → 1.4s → 2.8s
      console.warn(`⏳ ${label} فشل (${String(err?.message ?? err).slice(0, 50)}) — إعادة محاولة ${i + 2}/${attempts} بعد ${delay}ms`);
      await wait(delay);
    }
  }
  throw lastErr;
}

// 🛡️ سقف حجم الوسائط (64MB) موجود في fetchmedia.js — هنا بنستلم Buffer جاهز

// إرسال نص عادي — بإعادة محاولة للأخطاء العابرة
export async function sendText(sock, jid, text, extra = {}) {
  return withRetry('إرسال نص', () => sock.sendMessage(jid, { text, ...extra }));
}

// ─────────────────────────────────────────────────────────────
// 📥 إرسال الوسائط
//
// ⚠️ كان كله بيعمل `{ url }` وبيسلّم الرابط لواتساب يشيله بنفسه. ده بيفشل
// في حالات كتير: لينك بيتحوّل Redirect، سيرفر بيطلب headers، أو نتيجة
// الـAPI بترجّع صفحة HTML مش ملف. وWhatsApp بيطلّع رسالة "media upload
// failed" من غير سبب مفهوم.
//
// دلوقتي: بننزّل إحنا (مع User-Agent + تحويلات + meta-refresh)، نتأكد إن
// اللي نزل media فعلاً، نحوّله للصيغة اللي واتساب عايزها، وبعدين نبعت
// Buffer — فمفيش اعتماد على إن واتساب يقدر يوصل.
// ─────────────────────────────────────────────────────────────

// 🎙️ رسالة صوتية (voice note) — لازم OGG/Opus وإلا مش بيشتغل
export async function sendVoice(sock, jid, audioUrl, extra = {}) {
  try {
    const { buffer } = await fetchMedia(audioUrl, { expect: 'audio' });
    const ogg = await toOggOpus(buffer);
    const res = await withRetry('الإرسال الصوتي', () =>
      sock.sendMessage(jid, {
        audio: ogg,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
        ...extra,
      }));
    bump('voices'); // نعدّ الناجح بس — المحاولات الفاشلة مش صوت اتبعت
    return res;
  } catch (err) {
    console.error('⚠️ فشل الإرسال الصوتي:', err.message?.slice(0, 70));
    // احتياطي: ابعت الملف زي ما هو كـ audio عادي (مش voice note)
    try {
      const { buffer, type } = await fetchMedia(audioUrl, {});
      const res = await withRetry('الإرسال الصوتي الاحتياطي', () =>
        sock.sendMessage(jid, {
          audio: buffer,
          mimetype: type,
          ...extra,
        }));
      bump('voices');
      return res;
    } catch {
      return fallbackText(sock, jid, '🎙️ مقدرتش أبعت الصوت ده — اللينك مش صالح');
    }
  }
}

// 🎵 صوت/أغنية (مش voice note) — MP3 هو المقبول
export async function sendAudio(sock, jid, audioUrl, extra = {}) {
  try {
    const { buffer, type } = await fetchMedia(audioUrl, { expect: 'audio' });
    return await withRetry('إرسال الأغنية', () =>
      sock.sendMessage(jid, {
        audio: buffer,
        mimetype: /mp3|mpeg/i.test(type) ? 'audio/mpeg' : type,
        ...extra,
      }));
  } catch (err) {
    console.error('⚠️ فشل الإرسال الصوتي:', err.message?.slice(0, 70));
    return fallbackText(sock, jid, '🎵 مقدرتش أحمّل الصوت ده — جرّب تاني');
  }
}

// 🖼️ صورة
export async function sendImage(sock, jid, imageUrl, caption, extra = {}) {
  // ⚡ دعم فوري للـ Buffer المباشر بدون أي طلبات شبكة
  if (Buffer.isBuffer(imageUrl)) {
    const isPng = imageUrl[0] === 0x89 && imageUrl[1] === 0x50;
    return await withRetry('إرسال صورة Buffer', () =>
      sock.sendMessage(jid, {
        image: imageUrl,
        mimetype: isPng ? 'image/png' : 'image/jpeg',
        caption,
        ...extra,
      }));
  }

  try {
    const { buffer, type } = await fetchMedia(imageUrl, { expect: 'image' });
    const isPng = (buffer && buffer[0] === 0x89 && buffer[1] === 0x50) || /png/i.test(type);
    const mime = isPng ? 'image/png' : 'image/jpeg';
    return await withRetry('إرسال الصورة', () =>
      sock.sendMessage(jid, {
        image: buffer,
        mimetype: mime,
        caption,
        ...extra,
      }));
  } catch (err) {
    console.warn('⚠️ فشل جلب الصورة عبر fetchMedia:', err.message?.slice(0, 70));

    // ⚡ محاولة تنزيل مباشر كـ Buffer مع User-Agent لتخطي أي حظر من CDN
    if (typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl)) {
      try {
        const { data } = await axios.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 15000,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        const directBuf = Buffer.from(data);
        if (directBuf.length >= 500) {
          const isPng = directBuf[0] === 0x89 && directBuf[1] === 0x50;
          return await withRetry('إرسال الصورة المباشرة', () =>
            sock.sendMessage(jid, {
              image: directBuf,
              mimetype: isPng ? 'image/png' : 'image/jpeg',
              caption,
              ...extra,
            }));
        }
      } catch (eDirect) {
        console.warn('⚠️ فشل التنزيل المباشر بالـ Buffer:', eDirect.message?.slice(0, 70));
      }

      // محاولة إرسال الرابط مباشرة لـ Baileys ليتكفل واتساب بتحميله
      try {
        return await withRetry('إرسال رابط الصورة لـ Baileys', () =>
          sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption,
            ...extra,
          }));
      } catch (e2) {
        console.warn('⚠️ فشل إرسال رابط الصورة لـ Baileys:', e2.message?.slice(0, 70));
      }
    }

    return fallbackText(sock, jid, '🎨 معلش يا غالي، تعذر إرسال الصورة حالياً بسبب ضغط في السيرفر. جرب تطلبها تاني بعد لحظات.');
  }
}

// 🎬 فيديو — WhatsApp بيقبل MP4 بس عمليًا
export async function sendVideo(sock, jid, videoUrl, caption, extra = {}) {
  try {
    const { buffer, type } = await fetchMedia(videoUrl, { expect: 'video' });
    if (/mp4/i.test(type)) {
      return await withRetry('إرسال الفيديو', () =>
        sock.sendMessage(jid, { video: buffer, mimetype: 'video/mp4', caption, ...extra }));
    }
    // webm/mkv — حوّله
    const mp4 = await toMp4(buffer, { height: 720 });
    return await withRetry('إرسال الفيديو المحوّل', () =>
      sock.sendMessage(jid, { video: mp4, mimetype: 'video/mp4', caption, ...extra }));
  } catch (err) {
    console.error('⚠️ فشل الفيديو:', err.message?.slice(0, 70));
    return fallbackText(sock, jid, '🎬 مقدرتش أبعت الفيديو — جرّب تاني');
  }
}

// 🌀 GIF — لازم MP4 مع gifPlayback (مش رابط .gif خام)
export async function sendGif(sock, jid, gifUrl, caption, extra = {}) {
  try {
    const { buffer, type } = await fetchMedia(gifUrl, { expect: 'video' });
    const mp4 = /mp4/i.test(type) ? buffer : await toMp4(buffer, { height: 480 });
    return await withRetry('إرسال الـGIF', () =>
      sock.sendMessage(jid, {
        video: mp4,
        mimetype: 'video/mp4',
        gifPlayback: true,
        caption,
        ...extra,
      }));
  } catch (err) {
    console.error('⚠️ فشل الـGIF:', err.message?.slice(0, 70));
    return fallbackText(sock, jid, '🌀 مقدرتش أبعت الـGIF');
  }
}

// 🧹 رسالة خطأ قصيرة من غير ما نكسر المسار — وبتعدّ فشل الإرسال للإحصائيات
function fallbackText(sock, jid, text) {
  bump('sendFailures');
  return sock.sendMessage(jid, { text }).catch(() => {});
}

// ═════════════════════════════════════════════════════════════
// 📩 كارت تفاعلي: أزرار سريعة + (اختياري) قائمة منسدلة + (اختياري) منشن
//
// ⚠️ لازم نمرّ على MB.Button مش sock.sendMessage مباشرة:
// sendMessage مش بيسلّم (serialize) الـ interactiveMessage صح، وبيضيّع عقدة
// biz/native_flow اللي بتقول لواتساب إن الأزرار تفاعلية → الرسالة بتوصل والأزرار ميتة.
//
// buttons  → [{ label, id }]           أزرار سريعة (لحد 10)
// sections → [{ title, rows: [...] }]  قائمة منسدلة (single_select)
// mentions → ['jid@s.whatsapp.net']    عشان يوصّل الإشعارات للمنشن
export async function sendQuickReplies(sock, jid, {
  text,
  title,
  footer,
  buttons = [],
  sections = null,
  selectTitle = 'اختر من القائمة',
  mentions = null,
  quoted = null,
}) {
  const list = [...buttons];
  if (list.length > 10) list.length = 10; // حد واتساب 10 أزرار
  const extra = mentions?.length ? { mentions } : {};

  // مفيش أزرار ولا قوائم → نص عادي (أرخص وأضمن من كارت فاضي)
  if (!list.length && !sections?.length) {
    return withRetry('إرسال نص', () => sock.sendMessage(jid, { text: String(text ?? ''), ...extra }, quoted ? { quoted } : {}));
  }

  try {
    const b = new MB.Button(sock);
    if (title) b.setTitle(title);
    b.setBody(String(text ?? '')).setFooter(footer ?? defaultFooter());

    // لازم تتبني الأول عشان تيجي في البايان
    if (sections?.length) {
      b.addSelection(selectTitle);
      for (const s of sections) {
        b.makeSection(s.title ?? '');
        for (const r of s.rows ?? []) b.makeRow(r.header ?? '', r.title, r.description ?? '', r.id);
      }
    }

    for (const btn of list) {
      const label = String(btn.label).slice(0, 40);
      // 📋 زر نسخ حقيقي في واتساب — بينسخ الصيغة لما تدوس عليه
      if (typeof btn.id === 'string' && btn.id.startsWith('copy:')) {
        b.addCopy(label, btn.id.slice(5));
      } else {
        b.addReply(label, btn.id);
      }
    }

    return await withRetry('إرسال الأزرار', () => b.send(jid, quoted ? { quoted } : {}));
  } catch (err) {
    console.error('⚠️ الأزرار فشلت، هرجّع نص:', err.message?.slice(0, 80));
    let fallback = title ? `╭─「 ${title} 」\n\n` : '';
    fallback += String(text ?? '');
    for (const btn of list) fallback += `\n▸ ${String(btn.id ?? '').replace('copy:', '')}`;
    for (const s of sections ?? []) {
      fallback += `\n\n◆ ${s.title ?? ''}`;
      for (const r of s.rows ?? []) fallback += `\n  • ${r.id ?? r.title ?? ''}`;
    }
    fallback += '\n╰───────────';
    return withRetry('إرسال النص الاحتياطي', () => sock.sendMessage(jid, { text: fallback, ...extra }));
  }
}

// رسالة تفاعلية (نفس sendQuickReplies — kept للتوافق مع الأوامر القديمة)
export async function sendInteractive(sock, jid, opts) {
  return sendQuickReplies(sock, jid, opts);
}

// نص احتياطي للكاروسيل/الريتش/البول — بيعرض نفس المحتوى شكل بسيط
function plainFallback(sock, jid, extra, ...parts) {
  const text = parts.filter((p) => p && String(p).trim()).join('\n');
  bump('sendFailures');
  return sock.sendMessage(jid, { text: text || '…', ...extra }).catch((err) => {
    console.error('⚠️ حتى الـ fallback النصي فشل:', err.message?.slice(0, 60));
  });
}

// 🎠 كاروسيل: كروت بتتقلب — كل كارو لازم يكون فيه صورة أو فيديو
export async function sendCarousel(sock, jid, { body, footer, cards = [] }) {
  const extra = {}; // الكاروسيل مبياخدش mentions مباشرة — كفاية إننا منكسرش
  try {
    const built = [];
    for (const c of cards) {
      const b = new MB.Button(sock)
        .setImage(c.image)
        .setBody(c.body ?? '')
        .setFooter(footer ?? defaultFooter());
      for (const btn of (c.buttons ?? []).slice(0, 3)) {
        if (btn.url) b.addUrl(btn.label, btn.url);
        else b.addReply(btn.label, btn.id);
      }
      built.push(await b.toCard());
    }
    const carousel = new MB.Carousel(sock)
      .setBody(body)
      .setFooter(footer ?? defaultFooter())
      .addCard(built);
    return await carousel.send(jid);
  } catch (err) {
    // ⚠️ كان بيرمي الاستثناء خام — الأمر اللي ناداه كان بيقع كله.
    // دلوقتي: بنعرض الكروت كنص بسيط.
    console.error('⚠️ الكاروسيل فشل، هرجّع نص:', err.message?.slice(0, 80));
    const lines = [String(body ?? '')];
    for (const c of cards) {
      lines.push(`◆ ${c.body ?? ''}`);
      for (const btn of (c.buttons ?? []).slice(0, 3)) {
        lines.push(`  ▸ ${btn.url ?? String(btn.id ?? '').replace('copy:', '')}`);
      }
    }
    return plainFallback(sock, jid, extra, ...lines);
  }
}

// 📊 استطلاع رأي (Poll)
export async function sendPoll(sock, jid, { name, values, selectableCount = 1 }) {
  try {
    return await sock.sendMessage(jid, { poll: { name, values, selectableCount } });
  } catch (err) {
    console.error('⚠️ الاستطلاع فشل، هرجّع نص:', err.message?.slice(0, 80));
    const lines = [`📊 *${name}*`, '', ...values.map((v) => `▫️ ${v}`), '', 'اكتب اختيارك كرد 😄'];
    return plainFallback(sock, jid, {}, ...lines);
  }
}

// 🤖 كارت غني بشكل Meta AI — نص + كود + جدول + اقتراحات
export async function sendRich(sock, jid, { title, footer, text, code, table, suggestions }) {
  try {
    const rich = new MB.AIRich(sock);
    if (title) rich.setTitle(title);
    if (footer) rich.setFooter(footer);
    if (text) rich.addText(text);
    if (code) rich.addCode(code.language ?? 'javascript', code.value ?? code);
    if (table) rich.addTable(table);
    if (suggestions) rich.addSuggest(suggestions);
    return await rich.send(jid);
  } catch (err) {
    console.error('⚠️ الكارت الغني فشل، هرجّع نص:', err.message?.slice(0, 80));
    const parts = [title ? `*${title}*` : '', String(text ?? '')];
    if (code) parts.push(`\`\`\`\n${code.value ?? code}\n\`\`\``);
    if (table?.length) {
      for (const row of table) parts.push(Array.isArray(row) ? row.join(' | ') : String(row));
    }
    if (suggestions?.length) parts.push('اقتراحات: ' + suggestions.join(' • '));
    return plainFallback(sock, jid, {}, ...parts);
  }
}
