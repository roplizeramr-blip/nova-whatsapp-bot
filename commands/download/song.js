import { sendQuickReplies, sendText, sendImage } from '../../core/send.js';
import { downloadYoutube } from '../../core/yt.js';
import { toOggOpus } from '../../core/fetchmedia.js';
import api from '../../core/api.js';
import { db } from '../../core/db.js';

// 🎵 .song — محمّل الأغاني والمهرجانات الذكي المتطور
// يدعم: ريكورد PTT، ملف MP3، مستند، وفيديو 360/720 مع صور الغلاف والبيانات الكاملة

function cache() {
  return db.get('searchCache', {});
}

export function saveSongCache(jid, results) {
  const all = cache();
  all[jid] = { type: 'song', results, at: Date.now() };
  db.set('searchCache', all);
}

export function loadSongCache(jid) {
  const c = cache()[jid];
  if (!c || c.type !== 'song' || Date.now() - c.at > 10 * 60 * 1000) return null;
  return c.results;
}

/**
 * إرسال كارت تفاصيل التراك وخيارات الجودة المباشرة
 */
export async function showSongChoices(sock, jid, r, idx = 0) {
  const caption = [
    `🎵 *${r.title}*`,
    ``,
    `⏱️ *المدة:* ${r.duration || 'غير محدد'}`,
    `👤 *القناة / الفنان:* ${r.author || 'غير معروف'}`,
    `🔗 *الرابط:* ${r.url}`,
    ``,
    `اختار الصيغة أو الجودة اللي تناسبك من الأزرار بالأسفل 👇`,
  ].join('\n');

  if (r.thumbnail) {
    try {
      await sendImage(sock, jid, r.thumbnail, caption);
    } catch {
      await sendText(sock, jid, caption);
    }
  } else {
    await sendText(sock, jid, caption);
  }

  const buttons = [
    { label: '🎙️ ريكورد صوتي PTT', id: `.song dl-${idx}-ptt` },
    { label: '🎧 ملف صوتي MP3', id: `.song dl-${idx}-audio` },
    { label: '📁 مستند صوتي Doc', id: `.song dl-${idx}-doc` },
    { label: '🎬 فيديو 360p', id: `.song dl-${idx}-360` },
    { label: '🎬 فيديو 720p HD', id: `.song dl-${idx}-720` },
  ];

  return sendQuickReplies(sock, jid, {
    title: '🎵 خيارات التحميل المباشر',
    text: 'اضغط على الصيغة المطلوبة ليبدأ التحميل فوراً ⚡',
    buttons,
  });
}

export default {
  name: 'song',
  aliases: ['اغنية', 'أغنية', 'مهرجان', 'تراك', 'شغل', 'تحميل_اغنية'],
  description: 'تحميل أي أغنية أو مهرجان بصوت عالي النقاء، ريكورد PTT، أو فيديو — .song اسم الأغنية',
  usage: '.song عمرو دياب | .song مهرجان اندال',
  async execute(sock, m, args) {
    const text = args.join(' ').trim();

    // اختيار من النتايج المحفوظة: .song dl-<رقم> → أزرار الجودة، وبعدين dl-<رقم>-<صيغة>
    const pick = /^dl-(\d)(?:-(ptt|audio|doc|360|720))?$/.exec(text);
    if (pick) {
      const results = loadSongCache(m.jid);
      const idx = Number(pick[1]);
      const r = results?.[idx];
      if (!r) return m.reply('⌛ انتهت صلاحية نتائج البحث — ابحث من جديد: `.song اسم الأغنية`');

      // أول ضغطة → إرسال كارت الغلاف وأزرار الجودة
      if (!pick[2]) {
        return showSongChoices(sock, m.jid, r, idx);
      }

      const format = pick[2];
      const isVideo = format === '360' || format === '720';
      const isPtt = format === 'ptt';
      const isDoc = format === 'doc';
      const isAudio = !isVideo;

      let waitLabel = 'الصوت';
      if (isPtt) waitLabel = 'الريكورد الصوتي';
      else if (isDoc) waitLabel = 'المستند الصوتي';
      else if (isVideo) waitLabel = `الفيديو (${format === '720' ? '720p HD' : '360p'})`;

      await sendText(sock, m.jid, `⏳ جاري تحميل ${waitLabel} لأغنية:\n*${r.title}*... ثواني يا فنان! 🚀`);

      let buffer;
      try {
        buffer = await downloadYoutube(r.url, isVideo ? 'video' : 'audio', {
          height: format === '720' ? 720 : 360,
        });
      } catch (err) {
        console.warn('⚠️ محاولة يوتيوب فشلت، جاري البحث عبر ساوندكلاود:', err.message?.slice(0, 80));
        if (isAudio) {
          try {
            const sc = await api.vexSoundcloud(r.title).catch(() => []);
            const scUrl = sc?.[0]?.url;
            if (scUrl) {
              buffer = await downloadYoutube(scUrl, 'audio');
            }
          } catch (scErr) {
            console.warn('⚠️ محاولة ساوندكلاود البديلة فشلت:', scErr.message?.slice(0, 80));
          }
        }
        if (!buffer) {
          return m.reply(
            '😵 تعذر جلب هذا المقطع حالياً من يوتيوب.\n' +
              '💡 جرب كلمات أدق أو اسم مطرب محدد 🎧',
          );
        }
      }

      const safeTitle = (r.title ?? 'audio').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
      const caption = `${isAudio ? '🎵' : '🎬'} *${r.title ?? ''}*\n⚡ بواسطة *استرو بـوت*`;

      // 1) إرسال كـ Voice Note (PTT)
      if (isPtt) {
        const ogg = await toOggOpus(buffer).catch(() => null);
        return sock.sendMessage(m.jid, {
          audio: ogg ?? buffer,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
        }, { quoted: m.msg });
      }

      // 2) إرسال كـ Document MP3
      if (isDoc) {
        return sock.sendMessage(m.jid, {
          document: buffer,
          mimetype: 'audio/mpeg',
          fileName: `${safeTitle}.mp3`,
          caption,
        }, { quoted: m.msg });
      }

      // 3) إرسال كـ ملف صوتي عادي
      if (isAudio) {
        const ogg = await toOggOpus(buffer).catch(() => null);
        return sock.sendMessage(m.jid, {
          audio: ogg ?? buffer,
          mimetype: ogg ? 'audio/ogg; codecs=opus' : 'audio/mpeg',
          fileName: `${safeTitle}.mp3`,
          caption,
        }, { quoted: m.msg });
      }

      // 4) إرسال كـ فيديو
      return sock.sendMessage(m.jid, {
        video: buffer,
        mimetype: 'video/mp4',
        fileName: `${safeTitle}.mp4`,
        caption,
      }, { quoted: m.msg });
    }

    if (!text) {
      return sendQuickReplies(sock, m.jid, {
        title: '🎵 محمّل الأغاني والمهرجانات الذكي',
        text: 'اكتب اسم الأغنية أو المهرجان، مثال:\n`.song مهرجان اندال`\n`.song عمرو دياب خليك معايا`',
        buttons: [
          { label: '🔥 مهرجان اندال', id: '.song مهرجان اندال اندال' },
          { label: '🎤 عمرو دياب', id: '.song عمرو دياب يا انا يا لا' },
        ],
      });
    }

    await sendText(sock, m.jid, `🔍 جاري البحث في يوتيوب عن: *${text}*... ⏳`);
    const results = await api.ytSearch(text, 5);
    if (!results || !results.length) return m.reply('😕 ملقيتش نتائج مطابقة — جرب كلمات بحث تانية.');

    saveSongCache(m.jid, results);

    // عرض أول نتيجة مباشرة مع كارت التفاصيل والأزرار التفاعلية
    const topResult = results[0];
    await showSongChoices(sock, m.jid, topResult, 0);

    // إذا وُجدت نتائج أخرى، نعرض قائمة منسدلة بالاختيارات البديلة
    if (results.length > 1) {
      await sendQuickReplies(sock, m.jid, {
        title: `🎵 نتائج أخرى لـ "${text.slice(0, 25)}"`,
        text: 'تقدر تختار أي تراك تاني من نتائج البحث 👇',
        sections: [
          {
            title: 'باقي نتائج يوتيوب',
            rows: results.slice(1).map((r, i) => ({
              title: `🎵 ${String(r.title).slice(0, 24)}`,
              description: `${r.duration ?? ''} ${r.author ? '• ' + r.author : ''}`,
              id: `.song dl-${i + 1}`,
            })),
          },
        ],
        selectTitle: '🔍 تصفح باقي النتائج',
      });
    }
  },
};
