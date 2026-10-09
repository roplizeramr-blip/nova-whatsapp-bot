import { sendQuickReplies, sendText, sendImage } from '../../core/send.js';
import { downloadYoutube } from '../../core/yt.js';
import { toOggOpus } from '../../core/fetchmedia.js';
import api from '../../core/api.js';
import { db } from '../../core/db.js';

// 🎵 .song — محمّل الأغاني والمهرجانات الذكي المتطور
// متعدد المراحل: بحث وعرض عدة نتائج → اختيار تراك → كارت التفاصيل وصورة الغلاف → زران (صوت / فيديو) → سلايدر الجودات

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
  if (!c || c.type !== 'song' || Date.now() - c.at > 15 * 60 * 1000) return null;
  return c.results;
}

/**
 * 1️⃣ عرض قائمة النتائج المتعددة للاختيار منها
 */
export async function showSearchResults(sock, jid, query, results) {
  const top = results.slice(0, 4);
  const listText = [
    `🔍 *نتائج البحث في يوتيوب عن:* "${query.slice(0, 35)}"`,
    ``,
    ...top.map((r, i) =>
      `*${i + 1}️⃣* 🎵 *${r.title}*\n⏱️ *المدة:* ${r.duration || 'غير محدد'} • 👤 *الفنان:* ${r.author || 'يوتيوب'}`
    ),
    ``,
    `👇 *اضغط على زر التراك المطلوب بالأسفل لعرض تفاصيله واختيار التحميل:*`,
  ].join('\n');

  const buttons = top.slice(0, 3).map((r, i) => ({
    label: `${i + 1}️⃣ ${String(r.title).slice(0, 18)}`,
    id: `.song pick-${i}`,
  }));

  return sendQuickReplies(sock, jid, {
    title: '🎵 نتائج بحث الأغاني والمهرجانات',
    text: listText,
    buttons,
  });
}

/**
 * 2️⃣ إرسال كارت تفاصيل التراك وصورة الغلاف وزري (صوت / فيديو)
 */
export async function showSongChoices(sock, jid, r, idx = 0) {
  const caption = [
    `🎵 *اسم التراك:* ${r.title}`,
    ``,
    `⏱️ *المدة:* ${r.duration || 'غير محدد'}`,
    `👤 *القناة / الفنان:* ${r.author || 'غير معروف'}`,
    `🔗 *الرابط:* ${r.url}`,
    ``,
    `👇 *اختار نوع التحميل المفضل (صوت أو فيديو):*`,
  ].join('\n');

  const thumbUrl = r.thumbnail || (r.id ? `https://i.ytimg.com/vi/${r.id}/hqdefault.jpg` : null);

  if (thumbUrl) {
    try {
      await sendImage(sock, jid, thumbUrl, caption);
    } catch {
      await sendText(sock, jid, caption);
    }
  } else {
    await sendText(sock, jid, caption);
  }

  const buttons = [
    { label: '🎧 تحميل صوت (Audio)', id: `.song opt-${idx}-audio` },
    { label: '🎬 تحميل فيديو (Video)', id: `.song opt-${idx}-video` },
  ];

  return sendQuickReplies(sock, jid, {
    title: '⚡ صيغة التحميل',
    text: 'اضغط على نوع الملف المطلوب لعرض خيارات الجودة المتاحة 👇',
    buttons,
  });
}

/**
 * 3️⃣ عرض سلايدر وخيارات جودة الصوت
 */
export async function showAudioQualities(sock, jid, r, idx = 0) {
  return sendQuickReplies(sock, jid, {
    title: `🎧 جودات الصوت: ${String(r.title).slice(0, 25)}`,
    text: 'اختار جودة أو صيغة الصوت المطلوبة 👇',
    buttons: [
      { label: '🎙️ ريكورد PTT فويس نوت', id: `.song dl-${idx}-ptt` },
      { label: '🎧 صوت MP3 عالي (320k)', id: `.song dl-${idx}-audio` },
      { label: '📁 مستند صوتي Doc', id: `.song dl-${idx}-doc` },
    ],
  });
}

/**
 * 4️⃣ عرض سلايدر وخيارات جودة الفيديو
 */
export async function showVideoQualities(sock, jid, r, idx = 0) {
  return sendQuickReplies(sock, jid, {
    title: `🎬 جودات الفيديو: ${String(r.title).slice(0, 25)}`,
    text: 'اختار جودة الفيديو المناسبة لسرعة باقتك 👇',
    buttons: [
      { label: '🎬 فيديو 360p (سريع)', id: `.song dl-${idx}-360` },
      { label: '🎬 فيديو 720p HD (دقة عالية)', id: `.song dl-${idx}-720` },
      { label: '🎬 فيديو 1080p FHD (أعلى دقة)', id: `.song dl-${idx}-1080` },
    ],
  });
}

export default {
  name: 'song',
  aliases: ['اغنية', 'أغنية', 'مهرجان', 'تراك', 'شغل', 'تحميل_اغنية', 'اغنيه'],
  description: 'تحميل أي أغنية أو مهرجان مع نتائج متعددة، كارت بيانات وصورة، وخيارات جودة صوت وفيديو — .song اسم الأغنية',
  usage: '.song عمرو دياب | .song مهرجان اندال',
  async execute(sock, m, args) {
    const text = args.join(' ').trim();

    // 1) اختيار نتيجة من قائمة البحث: .song pick-<رقم> أو .song <1-4>
    const pickMatch = /^(?:pick-(\d)|(\d))$/.exec(text);
    if (pickMatch) {
      const idx = Number(pickMatch[1] ?? pickMatch[2]) - (pickMatch[2] ? 1 : 0);
      const results = loadSongCache(m.jid);
      const r = results?.[idx];
      if (!r) return m.reply('⌛ انتهت صلاحية نتائج البحث — ابحث من جديد: `.song اسم الأغنية`');
      return showSongChoices(sock, m.jid, r, idx);
    }

    // 2) الضغط على زر نوع التحميل (صوت أو فيديو): .song opt-<رقم>-<audio|video>
    const optMatch = /^opt-(\d)-(audio|video)$/.exec(text);
    if (optMatch) {
      const idx = Number(optMatch[1]);
      const type = optMatch[2];
      const results = loadSongCache(m.jid);
      const r = results?.[idx];
      if (!r) return m.reply('⌛ انتهت صلاحية نتائج البحث — ابحث من جديد: `.song اسم الأغنية`');
      if (type === 'audio') return showAudioQualities(sock, m.jid, r, idx);
      return showVideoQualities(sock, m.jid, r, idx);
    }

    // 3) التحميل الفعلي بجودة محددة: .song dl-<رقم>-<صيغة>
    const dlMatch = /^dl-(\d)(?:-(ptt|audio|doc|360|720|1080))?$/.exec(text);
    if (dlMatch) {
      const results = loadSongCache(m.jid);
      const idx = Number(dlMatch[1]);
      const r = results?.[idx];
      if (!r) return m.reply('⌛ انتهت صلاحية نتائج البحث — ابحث من جديد: `.song اسم الأغنية`');

      // لو تم الضغط بدون تحديد صيغة، نعرض كارت التفاصيل
      if (!dlMatch[2]) {
        return showSongChoices(sock, m.jid, r, idx);
      }

      const format = dlMatch[2];
      const isVideo = format === '360' || format === '720' || format === '1080';
      const isPtt = format === 'ptt';
      const isDoc = format === 'doc';
      const isAudio = !isVideo;

      let waitLabel = 'الصوت';
      if (isPtt) waitLabel = 'الريكورد الصوتي PTT';
      else if (isDoc) waitLabel = 'المستند الصوتي Doc';
      else if (isVideo) waitLabel = `الفيديو (${format === '1080' ? '1080p FHD' : format === '720' ? '720p HD' : '360p'})`;

      await sendText(sock, m.jid, `⏳ جاري تحميل ${waitLabel} لأغنية:\n*${r.title}*... ثواني يا فنان! 🚀`);

      let buffer;
      try {
        const height = format === '1080' ? 1080 : format === '720' ? 720 : 360;
        buffer = await downloadYoutube(r.url, isVideo ? 'video' : 'audio', { height });
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

    // عرض قائمة النتائج للاختيار منها بكل احترافية
    return showSearchResults(sock, m.jid, text, results);
  },
};
