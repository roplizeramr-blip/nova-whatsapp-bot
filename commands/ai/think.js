import { chatAtria, isAtriaReady, buildAtriaAgentPrompt } from '../../core/atria.js';
import { sendText, sendQuickReplies } from '../../core/send.js';
import { getProfile, rememberMessage } from '../../core/memory.js';
import { findContact } from '../../core/identity.js';
import { db } from '../../core/db.js';
import { cleanForVoice } from '../../core/ai.js';
import { speak } from '../../core/tts.js';

export default {
  name: 'think',
  aliases: ['فكر', 'تفكير', 'حل_عميق', 'استنتاج', 'برمج'],
  description: 'التفكير والاستدلال المنطقي العميق عبر نموذج Atria Dawn Preview (744B MoE) مع عرض خطوات التفكير — .think <سؤالك أو مسألتك>',
  usage: '.think <سؤالك أو المسألة أو الكود>',
  async execute(sock, m, args) {
    const q = args.join(' ').trim();
    if (!q) {
      return sendQuickReplies(sock, m.jid, {
        title: '🧠 محرك التفكير العميق — Atria Dawn Preview',
        text: 'اكتب سؤالك أو مسألتك المعقدة أو كودك البرمجي، وهيقوم الموديل بتحليله خطوة بخطوة بالاستدلال المنطقي (Reasoning):\n\nمثال:\n`.think حل المسألة: إذا كان س + ص = 10 و س - ص = 4 فما قيمة س وص؟`\n`.think اكتب كود بايثون لتحليل ملفات CSV واستخراج أعلى المبيعات`',
        buttons: [
          { label: '💡 تجربة مسألة رياضية', id: '.think قطار سرعته 90 كم/س متى يقطع 270 كم؟' },
          { label: '💻 تجربة كود برمجي', id: '.think اكتب دالة بلغة جافاسكريبت لحساب الفاكتوريال' },
        ],
      });
    }

    if (!isAtriaReady()) {
      return m.reply('⚠️ محرك Atria Dawn Preview غير متاح حالياً، جرب أمر الشات العادي `.ai`.');
    }

    // إشعار فوري بأن الموديل يفكر الآن
    await m.reply('🧠 جاري التفكير والتحليل المنطقي العميق عبر Atria Dawn Preview (744B MoE)... ⏳');

    const key = m.identityKey ?? m.sender ?? m.jid;
    const profile = getProfile(key);
    const contact = findContact(m.sender, m.senderAlt, key);
    const isDev = Boolean(
      contact?.role === 'المطور' ||
      contact?.role === 'مطور' ||
      contact?.name?.includes('أدهم') ||
      String(key).includes('01273990719')
    );

    const system = buildAtriaAgentPrompt({
      profile,
      pushName: m.pushName,
      contact,
      isDev,
      text: q,
      mode: 'serious',
    });

    try {
      const res = await chatAtria({
        system,
        messages: [{ role: 'user', content: q }],
        maxTokens: 1200,
        temperature: 0.6,
        timeout: 45000,
      });

      const reply = res.reply || '';
      const reasoning = res.reasoning || '';

      // حفظ في ذاكرة وسجل المحادثة
      rememberMessage(key, 'user', `[تفكير عميق]: ${q}`);
      rememberMessage(key, 'bot', reply);

      // حفظ الحالة لأزرار الصوت والمتابعة
      const states = db.get('aiState', {});
      const aiKey = `${m.jid}::${key}`;
      states[aiKey] = {
        lastPrompt: q,
        lastReply: reply,
        lastReasoning: reasoning,
        by: key,
        at: Date.now(),
      };
      db.set('aiState', states);

      let output = '';
      if (reasoning && reasoning.trim()) {
        output += `🧠 *خطوات التفكير والتحليل الداخلي:*\n`;
        // تنسيق الاقتباس للخطوات
        const reasoningLines = reasoning
          .trim()
          .split('\n')
          .map((line) => `> _${line}_`)
          .join('\n');
        output += `${reasoningLines}\n\n`;
        output += `━━━━━━━━━━━━━━━━━━━━\n\n`;
      }

      output += `✨ *الحل والإجابة النهائية:*\n${reply}`;

      if (res.speedMs) {
        output += `\n\n⏱️ _تم التفكير والحل في: ${(res.speedMs / 1000).toFixed(1)} ثانية عبر Atria Dawn Preview_`;
      }

      await sendQuickReplies(sock, m.jid, {
        text: output,
        buttons: [
          { label: '🎧 استمع بصوت', id: '.ai voice' },
          { label: '💬 مناقشة الحل', id: `.ai اشرح لي أكتر عن: ${q.slice(0, 30)}` },
        ],
      });
    } catch (err) {
      console.error('❌ خطأ في أمر التفكير .think:', err.message);
      return m.reply('🥴 استغرق التحليل المنطقي وقتاً طويلاً أو حدث ضغط على السيرفر، جرب مرة أخرى بصياغة أقصر.');
    }
  },
};
