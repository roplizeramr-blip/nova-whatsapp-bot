import { sendQuickReplies, sendText, sendVideo, sendImage } from '../../core/send.js';
import api from '../../core/api.js';

export default {
  name: 'video',
  aliases: ['فيديو'],
  description: 'توليد فيديو قصير بالذكاء الاصطناعي — .video [الأبعاد] وصف المشهد',
  usage: '.video 16:9 قطة بتجري في الحديقة',
  async execute(sock, m, args) {
    const rawText = args.join(' ').trim();

    if (!rawText) {
      return sendQuickReplies(sock, m.jid, {
        title: '🎬 صانع الفيديوهات بالذكاء الاصطناعي',
        text: 'اكتب وصف الفيديو واختر الأبعاد المفضلة:\n- 16:9 للشاشات واليوتيوب\n- 9:16 لريلز، تيك توك، وحالات الواتساب',
        buttons: [
          { label: '🎬 16:9 عرضي', id: '.video 16:9 ' },
          { label: '📱 9:16 ريلز/طولي', id: '.video 9:16 ' },
        ],
      });
    }

    let ratio = '16:9';
    let cleanPrompt = rawText;

    // استخراج أبعاد الفيديو إذا تم تحديدها
    const ratioMatch = /^(16:9|9:16|1:1)\s*(.*)$/i.exec(rawText);
    if (ratioMatch) {
      ratio = ratioMatch[1];
      cleanPrompt = ratioMatch[2].trim();
    }

    if (!cleanPrompt) {
      return sendQuickReplies(sock, m.jid, {
        title: '🎬 صانع الفيديوهات بالذكاء الاصطناعي',
        text: `اكتب وصف الفيديو بعد الأبعاد (${ratio})، مثال:\n\`.video ${ratio} قطة بتلعب كورة في الشارع\``,
        buttons: [
          { label: '🎬 16:9 عرضي', id: '.video 16:9 ' },
          { label: '📱 9:16 ريلز/طولي', id: '.video 9:16 ' },
        ],
      });
    }

    await sendText(sock, m.jid, `🎬 بجهز الفيديو بأبعاد (${ratio})... استنى ثواني ⏳`);

    try {
      const url = await api.video(cleanPrompt, { ratio });
      if (url) {
        await sendVideo(sock, m.jid, url, `🎬 ${cleanPrompt}\n📐 الأبعاد: ${ratio}`);

        const followUpPrompt = cleanPrompt.length > 80 ? cleanPrompt.slice(0, 80) : cleanPrompt;
        return await sendQuickReplies(sock, m.jid, {
          title: '🎬 خيارات إضافية للفيديو',
          text: 'تم إنشاء الفيديو بنجاح! حابب تعيده بنسبة تانية؟',
          buttons: [
            { label: '🎬 إعادة بالعرض (16:9)', id: `.video 16:9 ${followUpPrompt}` },
            { label: '📱 إعادة بالطول (9:16)', id: `.video 9:16 ${followUpPrompt}` },
          ],
        });
      }
    } catch (err) {
      console.warn('⚠️ تعذر خادم الفيديو، جاري التوليد السينمائي الاحتياطي:', err.message);
    }

    // 🛡️ بديل سينمائي فوري عالي الدقة في حال بطء أو توقف خادم الفيديو
    try {
      const scenePrompt = `cinematic dramatic movie shot, masterpiece, highly detailed: ${cleanPrompt}`;
      const sceneUrl = await api.image(scenePrompt, { ratio });
      if (sceneUrl) {
        const notice = `🎬 يا غالي، سيرفر ريندر الفيديو عليه ضغط وتقيل شوية دلوقتي، بس صممتلك المشهد السينمائي فائق الجودة ده فوراً عشان تشوف النتيجة بجودة HD! 🎨✨\n\n💡 تقدر كمان تحول أي صورة لملصق متحرك عبر أمر *.sticker* أو تعيد طلب الفيديو بعد شوية.`;
        return await sendImage(sock, m.jid, sceneUrl, `🎬 *مشهد سينمائي بديل:*\n${cleanPrompt}\n\n${notice}`);
      }
    } catch {}

    return m.reply('❌ تعذر إنشاء الفيديو حالياً، سيرفر المعالجة عليه ضغط. جرب مرة أخرى لاحقاً.');
  },
};
