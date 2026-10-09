import api from '../../core/api.js';
import { sendText, sendImage, sendVideo, sendAudio, sendQuickReplies } from '../../core/send.js';
import { config } from '../../config.js';

// 📥 .dl / .تحميل — المحمل الذكي الشامل لكافة المنصات والوسائط
export default {
  name: 'universal',
  aliases: ['dl', 'تحميل', 'تنزيل', 'تنزيل_فيديو', 'تحميل_فيديو', 'نزل'],
  description: 'المحمل الذكي الشامل — يكتشف روابط يوتيوب، تيك توك، انستا، فيس، ميديافاير، وتطبيقات APK تلقائياً ويحملها فوراً',
  usage: '.dl <رابط الفيديو أو الملف>  أو  .تحميل <اسم أغنية أو تطبيق>',
  cooldown: 3000,
  async execute(sock, m, args, ctx) {
    const input = args.join(' ').trim();

    // إذا لم يكتب المستخدم رابطاً أو طلباً: عرض كارت المنصات المدعومة
    if (!input) {
      const guideText = [
        '╭───────────────────────────────╮',
        '│   📥 *المـحـمـل الـشـامـل لـ آسـتـرو* ⚡   │',
        '╰───────────────────────────────╯',
        '',
        '✨ *يدعم التحميل المباشر من كافة المنصات:*',
        '• 🎬 *يوتيوب (YouTube):* فيديوهات HD وأغاني MP3',
        '• 📱 *تيك توك (TikTok):* بدون علامة مائية + صوت',
        '• 📸 *إنستغرام (Instagram):* ريلز وبوستات وقصص',
        '• 👥 *فيسبوك (Facebook):* جودة عادية وعالية HD',
        '• 📦 *ميديا فاير (MediaFire):* تحميل مباشر للملفات',
        '• 🎧 *ساوندكلاود وسبوتيفاي:* موسيقى وتراكات عالية النقاوة',
        '• 📱 *تطبيقات أندرويد (APK):* ألعاب وبرامج مباشرة',
        '• 🍿 *أكوام (Akwam):* أحدث الأفلام والمسلسلات',
        '',
        '💡 *طريقة الاستخدام السهلة:*',
        '`.dl <حط أي لينك هنا>`',
        'أو اكتب اسم الأغنية/التطبيق مباشرة وسيب الباقي على أسترو!',
      ].join('\n');

      return sendQuickReplies(sock, m.jid, {
        title: '📥 المحمل الشامل',
        text: guideText,
        buttons: [
          { label: '🎵 تحميل أغنية', id: '.song ' },
          { label: '📱 تحميل تطبيق APK', id: '.apk ' },
          { label: '🍿 سهرة أكوام', id: '.akwam ' },
          { label: '🔙 القائمة الرئيسية', id: '.menu' },
        ],
      });
    }

    const urlMatch = input.match(/https?:\/\/[^\s]+/i);
    const targetUrl = urlMatch ? urlMatch[0] : null;

    // ─────────────────────────────────────────────────────────────
    // 1. روابط يوتيوب (YouTube)
    // ─────────────────────────────────────────────────────────────
    if (targetUrl && /(?:youtube\.com|youtu\.be)/i.test(targetUrl)) {
      await sendText(sock, m.jid, '🎬 ثواني يا فنان، بجيبلك بيانات فيديو اليوتيوب... ⏳');
      try {
        const vid = await api.ytVideo(targetUrl, '720').catch(() => null);
        const title = vid?.title || 'فيديو يوتيوب';
        const thumb = vid?.thumbnail || null;
        const caption = `🎬 *${title}*\n⏱️ المدة: ${vid?.duration || 'غير محدد'}\n👁️ المشاهدات: ${vid?.views || 'غير محدد'}`;

        const buttons = [
          { label: '🎧 تحميل صوت MP3', id: `.song ${targetUrl}` },
          { label: '🎬 تحميل فيديو 720p', id: `.getlink 720` },
          { label: '📱 تحميل فيديو 360p', id: `.getlink 360` },
        ];

        const sections = [
          {
            title: '🎬 خيارات تحميل يوتيوب',
            rows: [
              { header: '🎧', title: 'صوت MP3 بجودة عالية', description: 'تحميل الصوت فقط بصيغة MP3', id: `.song ${targetUrl}` },
              { header: '🎬', title: 'فيديو بجودة 720p HD', description: 'مشاهدة عالية الدقة', id: `.getlink 720` },
              { header: '📱', title: 'فيديو بجودة 360p توفير', description: 'حجم خفيف مناسب للباقات', id: `.getlink 360` },
            ],
          },
        ];

        if (vid?.url) {
          await sendVideo(sock, m.jid, vid.url, caption);
          return sendQuickReplies(sock, m.jid, {
            title: '🎬 خيارات إضافية',
            text: 'تحب تنزل الصوت أو جودة تانية؟ 👇',
            buttons,
            sections,
            selectTitle: '📋 اختر صيغة التحميل',
          }).catch(() => {});
        }

        if (thumb) {
          await sendImage(sock, m.jid, thumb, caption);
        } else {
          await sendText(sock, m.jid, caption);
        }

        return sendQuickReplies(sock, m.jid, {
          title: '🎬 صيغ التحميل',
          text: 'اختر الصيغة اللي تناسبك 👇',
          buttons,
          sections,
          selectTitle: '📋 اختر صيغة التحميل',
        });
      } catch (err) {
        return m.reply('❌ تعذر جلب فيديو يوتيوب، اتأكد من الرابط أو جرب أمر `.song` للأغاني.');
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 2. روابط تيك توك (TikTok)
    // ─────────────────────────────────────────────────────────────
    if (targetUrl && /tiktok\.com/i.test(targetUrl)) {
      await sendText(sock, m.jid, '🎵 جاري تحميل فيديو تيك توك بدون علامة مائية... ⏳');
      try {
        const data = await api.tiktok(targetUrl);
        const videoUrl = data?.video || data?.nowm || data?.url;
        if (videoUrl) {
          const caption = `🎵 *${data.title || 'فيديو تيك توك'}*\n👤 الناشر: ${data.author || 'غير معروف'}`;
          await sendVideo(sock, m.jid, videoUrl, caption);

          if (data.audio) {
            await sendQuickReplies(sock, m.jid, {
              title: '🎧 استخراج الصوت',
              text: 'عايز الصوت بتاع الفيديو لوحده؟ 👇',
              buttons: [
                { label: '🎧 تحميل الصوت MP3', id: `.song ${data.title || 'tiktok audio'}` },
              ],
            }).catch(() => {});
          }
          return;
        }
      } catch {}
      return m.reply('❌ تعذر تحميل فيديو تيك توك، اتأكد إن الحساب عام مش خاص.');
    }

    // ─────────────────────────────────────────────────────────────
    // 3. روابط إنستغرام (Instagram)
    // ─────────────────────────────────────────────────────────────
    if (targetUrl && /instagram\.com/i.test(targetUrl)) {
      await sendText(sock, m.jid, '📸 ثواني بجيبلك ريلز/بوست إنستغرام بأعلى جودة... ⏳');
      try {
        const data = await api.ig(targetUrl);
        const mediaUrl = data?.url || data?.video || data?.media?.[0]?.url;
        if (mediaUrl) {
          if (/\.mp4/i.test(mediaUrl) || data?.type === 'video') {
            return await sendVideo(sock, m.jid, mediaUrl, '📸 *تم تحميل ريلز إنستغرام بنجاح!*');
          } else {
            return await sendImage(sock, m.jid, mediaUrl, '📸 *تم تحميل صورة إنستغرام بنجاح!*');
          }
        }
      } catch {}
      return m.reply('❌ تعذر تحميل محتوى إنستغرام، اتأكد إن المنشور عام.');
    }

    // ─────────────────────────────────────────────────────────────
    // 4. روابط فيسبوك (Facebook)
    // ─────────────────────────────────────────────────────────────
    if (targetUrl && /(?:facebook\.com|fb\.watch)/i.test(targetUrl)) {
      await sendText(sock, m.jid, '👥 جاري تحميل فيديو فيسبوك بأعلى دقة... ⏳');
      try {
        const data = await api.fb(targetUrl).catch(() => null) || await api.fbDownload(targetUrl).catch(() => null);
        const videoUrl = data?.hd || data?.sd || data?.url;
        if (videoUrl) {
          return await sendVideo(sock, m.jid, videoUrl, '👥 *تم تحميل فيديو فيسبوك بنجاح!*');
        }
      } catch {}
      return m.reply('❌ تعذر تحميل فيديو فيسبوك، اتأكد من الرابط وإنه عام.');
    }

    // ─────────────────────────────────────────────────────────────
    // 5. ميديا فاير (MediaFire)
    // ─────────────────────────────────────────────────────────────
    if (targetUrl && /mediafire\.com/i.test(targetUrl)) {
      await sendText(sock, m.jid, '📦 ثواني بجيبلك رابط ميديا فاير المباشر... ⏳');
      try {
        const data = await api.mediafire(targetUrl);
        if (data?.url) {
          const info = `📦 *ملف ميديا فاير:*\n📄 *الاسم:* ${data.name || 'ملف'}\n📊 *الحجم:* ${data.size || 'غير محدد'}\n🔗 *التحميل المباشر:* ${data.url}`;
          return await sendText(sock, m.jid, info);
        }
      } catch {}
      return m.reply('❌ تعذر استخراج رابط ميديا فاير.');
    }

    // ─────────────────────────────────────────────────────────────
    // 6. بحث مباشر لو كان المدخل نصاً وليس رابطاً (تطبيقات أو أغاني)
    // ─────────────────────────────────────────────────────────────
    if (!targetUrl) {
      // بحث تطبيقات أولاً إذا طلب تطبيق أو لعبة
      if (/^(?:تطبيق|برنامج|لعبه|لعبة|برامج|تطبيقات|apk)/i.test(input)) {
        const q = input.replace(/^(?:تطبيق|برنامج|لعبه|لعبة|برامج|تطبيقات|apk)\s*/i, '').trim();
        const apkCmd = ctx?.commands?.get('apk');
        if (apkCmd) return apkCmd.execute(sock, m, [q], ctx);
      }

      // بحث أغاني
      const songCmd = ctx?.commands?.get('song');
      if (songCmd) return songCmd.execute(sock, m, args, ctx);
    }

    // رابط عام آخر: تجربة المحمل العام downr
    if (targetUrl) {
      await sendText(sock, m.jid, '🌐 جاري فحص وتحميل الرابط من السيرفر السريع... ⏳');
      try {
        const res = await api.downr('auto', targetUrl).catch(() => null);
        if (res?.url) {
          if (/\.mp4/i.test(res.url)) {
            return await sendVideo(sock, m.jid, res.url, '🎬 *تم التحميل بنجاح!*');
          } else if (/\.(?:jpe?g|png|webp)/i.test(res.url)) {
            return await sendImage(sock, m.jid, res.url, '🖼️ *تم التحميل بنجاح!*');
          } else if (/\.mp3/i.test(res.url)) {
            return await sendAudio(sock, m.jid, res.url);
          }
        }
      } catch {}
      return m.reply('⚠️ لم يتم التعرف على نوع هذا الرابط أو السيرفر لا يدعمه حالياً.');
    }
  },
};
