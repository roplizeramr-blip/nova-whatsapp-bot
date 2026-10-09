import { sendImage, sendText, sendQuickReplies } from '../../core/send.js';
import { imageToUrl } from '../../core/protection.js';
import { getMediaSource, uploadBuffer } from '../../core/media.js';
import { db } from '../../core/db.js';
import api from '../../core/api.js';

// 🎨 .editimage / .edit — تعديل الصور بالذكاء الاصطناعي
export default {
  name: 'editimage',
  aliases: ['تعديل_صورة', 'عدل_صورة', 'editimg', 'عدل', 'edit'],
  description: 'تعديل الصور بالذكاء الاصطناعي بواسطة برومبت — .edit [الوصف] (بالرد على صورة أو إرفاقها)',
  usage: '.edit [الوصف]  (رد على صورة أو مع صورة)',
  async execute(sock, m, args) {
    const media = await getMediaSource(m).catch(() => null);
    const quoted = m.quoted || m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const hasImage = !!(media?.buffer || m.message?.imageMessage || quoted?.imageMessage);

    let cachedUrl = null;
    if (!hasImage && !media?.buffer) {
      // 🧠 فحص ذاكرة الصور السياقية للشات (آخر 30 دقيقة)
      const chatImages = db.get('chatImages', {});
      const cached = chatImages[m.jid];
      if (cached && (Date.now() - (cached.at || 0) < 1800000)) {
        cachedUrl = cached.url;
      }
    }

    if (!hasImage && !media?.buffer && !cachedUrl) {
      return m.reply(
        '📷 *تعديل وتجسيد الصور بالذكاء الاصطناعي*\n\n' +
        'قم بالرد على صورة أو إرفاق صورة مع كتابة الوصف:\n' +
        '`.edit [الوصف المطلوب]`\n\n' +
        '💡 *أمثلة:*\n' +
        '• `.edit خليه لابس بدلة فضاء فخمة نيون`\n' +
        '• `.edit حول الصورة لكرتون أنمي 3D`\n' +
        '• `.edit ضيف خلفية شاطئ وغروب شمس سينمائي`'
      );
    }

    const prompt = args.join(' ').trim();
    if (!prompt) {
      return m.reply('✍️ اكتب الوصف أو التعديل المطلوب مع الصورة!\nمثال: `.edit حولها لكرتون 3D`');
    }

    await sendText(sock, m.jid, '🎨 جاري تعديل وتجسيد صورتك بالذكاء الاصطناعي... استنى شوية ⏳');

    let url = cachedUrl;
    if (media?.buffer) {
      url = await uploadBuffer(media.buffer).catch(() => null);
    }
    if (!url) {
      url = await imageToUrl(m).catch(() => null);
    }

    try {
      let editedUrl = null;
      if (url) {
        editedUrl = await api.vexEditImage(url, prompt).catch(() => null);
      }
      let isFallback = false;

      // 🛡️ بديل فوري مضمون: التجسيد الذكي عبر Flux أو MagicStudio
      if (!editedUrl) {
        editedUrl = (await api.vexAiImage(prompt, { model: 'flux' }).catch(() => null)) ||
                    (await api.image(prompt).catch(() => null));
        isFallback = true;
      }

      if (!editedUrl) {
        return m.reply('⚠️ تعذر تعديل الصورة حالياً — جرب بوصف أوضح');
      }

      // 💾 تحديث ذاكرة الصور السياقية في الشات
      const chatImages = db.get('chatImages', {});
      chatImages[m.jid] = { url: editedUrl, prompt, at: Date.now() };
      db.set('chatImages', chatImages);

      await sendImage(
        sock,
        m.jid,
        editedUrl,
        `🎨 *تم ${isFallback ? 'تجسيد الصورة' : 'تعديل الصورة'} بالذكاء الاصطناعي!*\n📝 *الوصف:* ${prompt}`,
      );

      await sendQuickReplies(sock, m.jid, {
        text: '✨ اختيارات سريعة:',
        buttons: [
          { label: '🎬 تحويل إلى فيديو', id: `.video ${prompt}` },
          { label: '🎨 تعديل آخر', id: `.edit ${prompt}` },
        ],
      }).catch(() => {});
    } catch (err) {
      console.warn('⚠️ محاولة التعديل تعذرت، جاري التوليد الاحتياطي:', err.message);
      try {
        const fallbackUrl = await api.image(prompt);
        if (fallbackUrl) {
          return await sendImage(
            sock,
            m.jid,
            fallbackUrl,
            `🎨 *تم توليد وتجسيد الصورة بالذكاء الاصطناعي!*\n📝 *الوصف:* ${prompt}`,
          );
        }
      } catch {}
      return m.reply('❌ تعذر تعديل الصورة حالياً، يرجى المحاولة بوصف مختلف.');
    }
  },
};
