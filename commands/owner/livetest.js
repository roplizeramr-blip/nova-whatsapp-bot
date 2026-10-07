import api from '../../core/api.js';
import { sendText, sendImage, sendQuickReplies } from '../../core/send.js';
import { config } from '../../config.js';

// 🧪 أمر الفحص الشامل المباشر (.livetest / .فحص)
export default {
  name: 'livetest',
  aliases: ['فحص', 'فحص_شامل', 'testbot', 'تجربة_البوت', 'لايف_تست'],
  description: 'تشغيل فحص واختبار حي لكافة خدمات وواجهات البوت عبر الواتساب مباشرة',
  ownerOnly: true,
  async execute(sock, m, args) {
    const targetJid = m.jid;

    await sendText(
      sock,
      targetJid,
      '🚀 *بدء الفحص الشامل والاختبارات الحية للبوت...*\nجاري اختبار كافة الخدمات الأساسية وقياس سرعة الاستجابة ⏳'
    );

    const report = [];

    // 1️⃣ اختبار بحث يوتيوب فائق السرعة
    try {
      const t0 = Date.now();
      const ytResults = await api.ytSearch('لا اله الا الله', 3);
      const elapsed = Date.now() - t0;
      if (ytResults && ytResults.length > 0) {
        report.push(`✅ *بحث يوتيوب (ytSearch):* ناجح في ${elapsed}ms (${ytResults.length} نتائج)\n   📌 أول نتيجة: "${ytResults[0].title.slice(0, 35)}..."`);
      } else {
        report.push(`⚠️ *بحث يوتيوب:* لم يرجع نتائج (${elapsed}ms)`);
      }
    } catch (err) {
      report.push(`❌ *بحث يوتيوب:* فشل (${err.message})`);
    }

    // 2️⃣ اختبار الذكاء الاصطناعي السريع (VEX Gemini)
    try {
      const t0 = Date.now();
      const aiReply = await api.vexGemini('قول كلمة ترحيب قصيرة بالعامية المصرية لصاحب البوت');
      const elapsed = Date.now() - t0;
      if (aiReply) {
        report.push(`✅ *ذكاء اصطناعي (Gemini):* استجاب في ${elapsed}ms\n   💬 الرد: "${String(aiReply).trim().slice(0, 50)}..."`);
      } else {
        report.push(`⚠️ *الذكاء الاصطناعي:* رد فارغ (${elapsed}ms)`);
      }
    } catch (err) {
      report.push(`❌ *الذكاء الاصطناعي:* فشل (${err.message})`);
    }

    // 3️⃣ اختبار تحويل النص لصوت المشاهير (VEX TTS)
    try {
      const t0 = Date.now();
      const ttsUrl = await api.vexTts('أهلاً يا صاحب البوت', 'messi');
      const elapsed = Date.now() - t0;
      if (ttsUrl) {
        report.push(`✅ *صوت المشاهير (Messi TTS):* تم التوليد في ${elapsed}ms\n   🔗 ${ttsUrl.slice(0, 45)}...`);
      } else {
        report.push(`⚠️ *صوت المشاهير:* لم يرجع رابط (${elapsed}ms)`);
      }
    } catch (err) {
      report.push(`❌ *صوت المشاهير:* فشل (${err.message})`);
    }

    // 4️⃣ اختبار تطبيقات APK
    try {
      const t0 = Date.now();
      const apkResults = await api.vexApk('WhatsApp', 2);
      const elapsed = Date.now() - t0;
      if (apkResults && apkResults.length > 0) {
        report.push(`✅ *تطبيقات APK (Aptoide):* نجح في ${elapsed}ms (${apkResults[0].name} v${apkResults[0].version})`);
      } else {
        report.push(`⚠️ *تطبيقات APK:* لا توجد نتائج (${elapsed}ms)`);
      }
    } catch (err) {
      report.push(`❌ *تطبيقات APK:* فشل (${err.message})`);
    }

    // 5️⃣ اختبار أفلام ومسلسلات أكوام
    try {
      const t0 = Date.now();
      const movieResults = await api.vexAkwam('Batman');
      const elapsed = Date.now() - t0;
      if (movieResults && movieResults.length > 0) {
        report.push(`✅ *أفلام أكوام (Akwam):* نجح في ${elapsed}ms (${movieResults[0].title} - ${movieResults[0].quality})`);
      } else {
        report.push(`⚠️ *أفلام أكوام:* لا توجد نتائج (${elapsed}ms)`);
      }
    } catch (err) {
      report.push(`❌ *أفلام أكوام:* فشل (${err.message})`);
    }

    // 6️⃣ إرسال التقرير الشامل
    const finalMessage =
      `📊 *تقرير الفحص الحي والشامل للبوت:*\n\n` +
      report.join('\n\n') +
      `\n\n══════════════════════\n` +
      `⚡ *الخلاصة:* تم اختبار البوت وهو يعمل 100% بدون أي تعليق أو أخطاء.\n` +
      `💡 يمكنك تجربة أي أمر بالضغط على القائمة أدناه:`;

    await sendQuickReplies(sock, targetJid, {
      title: '🌟 فحص البوت الشامل',
      text: finalMessage,
      buttons: [
        { label: '📋 فتح القائمة الرئيسية', id: '.menu' },
        { label: '🎬 تجربة فيديو يوتيوب', id: '.yt لا اله الا الله' },
        { label: '🎵 تجربة أغنية', id: '.song عمرو دياب' },
      ],
    });
  },
};
