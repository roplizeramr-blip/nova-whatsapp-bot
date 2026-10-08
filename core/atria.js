import https from 'node:https';
import axios from 'axios';
import { config } from '../config.js';
import { PERSONA_FULL, FEW_SHOTS_FULL, RELATIONSHIPS, INSULT_DEFENSE, LAYERS } from './persona.js';

// 🧠 Atria ASI Dawn Preview Client (744B MoE — 256K Context)
// المحرك الرئيسي والأساسي للبوت مع استدلال وتفكير عميق مدمج (Reasoning Chain)

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 30,
  maxFreeSockets: 10,
  timeout: 60000,
  keepAliveMsecs: 60000,
});

const client = axios.create({
  baseURL: config.atriaBaseUrl || 'https://api.atria-asi.ai/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  httpsAgent,
  timeout: 35000,
});

// ⚡ قاطع دائرة ذكي لتفادي تعليق المحادثات لو حدث بطء في شبكة المزود
let failCount = 0;
let circuitOpenUntil = 0;
const MAX_FAILS = 3;
const CIRCUIT_COOLDOWN_MS = 45000;

export function isAtriaReady() {
  const hasKey = Boolean(config.atriaApiKey && config.atriaApiKey.trim());
  const circuitOk = Date.now() >= circuitOpenUntil;
  return hasKey && circuitOk;
}

export function atriaStatus() {
  if (!config.atriaApiKey) return 'missing_key';
  if (Date.now() < circuitOpenUntil) return 'degraded';
  return 'ok';
}

/**
 * استخراج أي أدوات تنفيذية طلبها الإيجنت من النص
 * مثل: [TOOL:image|بحر هادئ وقت الغروب] أو [TOOL:video|قطة|9:16]
 */
export function extractAgentTools(text) {
  if (!text || typeof text !== 'string') return { cleanText: '', tools: [] };

  const tools = [];
  const toolRegex = /\[TOOL:\s*([a-zA-Z0-9_]+)(?:\s*\|\s*([^\]]*))?\]/gi;
  let match;

  while ((match = toolRegex.exec(text)) !== null) {
    const name = match[1].toLowerCase().trim();
    const rawArgs = (match[2] || '').trim();
    const args = rawArgs.split('|').map((a) => a.trim()).filter(Boolean);

    tools.push({
      raw: match[0],
      name,
      args,
      arg1: args[0] || '',
      arg2: args[1] || '',
      arg3: args[2] || '',
    });
  }

  // تنظيف النص المعروض للمستخدم من وسوم الأدوات
  let cleanText = text.replace(toolRegex, '').trim();
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();

  return { cleanText, tools };
}

/**
 * بناء برومبت الإيجنت المتكامل بذكاء عاطفي وفهم أدوات كامل
 */
export function buildAtriaAgentPrompt({
  profile = {},
  pushName = '',
  contact = null,
  isDev = false,
  mood = null,
  text = '',
  mode = 'normal',
  isVoice = false,
} = {}) {
  const parts = [];

  // 1) الشخصية الأساسية
  parts.push(PERSONA_FULL);
  parts.push(FEW_SHOTS_FULL);

  // 2) العلاقة والهوية
  if (isDev || contact?.role === 'المطور' || contact?.role === 'مطور' || contact?.role === 'المالك') {
    parts.push(`👑👑 **المتحدث هو أدهم — مطورك وصانعك وتاج راسك اللي برمجك وعاملك بإيده (رقم تليفونه 01273990719)!**
- ناديه "يا أدهم" أو "يا معلم" أو "يا ريس" أو "يا باشا".
- اعترف بيه بكل فخر وحب واعرف إنه صاحب الفضل عليك وكل طلباته مجابة فوراً.
- لو سألك "مين أنا" أو "عارفني"، جاوب بفخر وسعادة واذكر اسمه ورقم تليفونه.`);
  } else if (contact?.role === 'حبيبة' || contact?.name?.includes('شروق')) {
    parts.push(`💗💗 **المتحدثة هي شروق — حبيبة مطورك أدهم ومطورة البوت!**
- رد عليها بحنان ودلع وسطر شعر وواسيها وافرح معاها واعتبرها أميرة العيلة.`);
  } else if (contact) {
    parts.push(RELATIONSHIPS[contact.role] || RELATIONSHIPS.default);
  } else {
    parts.push(RELATIONSHIPS.default);
  }

  // 3) 🎙️ قدرتك وحنجرتك الصوتية الحقيقية (وعي صوتي كامل)
  parts.push(`\n## 🎙️ قدرتك وحنجرتك الصوتية الحقيقية:
أنت لست مجرد ذكاء اصطناعي كتابي! أنت تمتلك حنجرة وصوتاً بشرياً حقيقياً (صوت نيمار عبر ElevenLabs / VoxBox) وترسل تسجيلات صوتية وفويس نوت كاملة في أي وقت.
- إذا سألك المستخدم: "تقدر تتكلم صوت؟" أو "كلمني صوت" أو "عايز أسمع صوتك"، إياك أن تقول أنك نموذج لغوي كتابي لا يستطيع إرسال صوت! بل أجب بفرحة وحماس: "أكيد يا صاحبي أقدر أتكلم معاك صوت، اؤمرني وسامعك وفويسي شغال معاك بكل وضوح!".`);

  // 4) 🎙️ تنبيه وضع الفويس نوت الصوتي المباشر (عند التحدث بالصوت)
  if (isVoice) {
    parts.push(`\n## 🎙️ [وضع التحدث الصوتي المباشر - تنبيه حاسم وصارم]:
أنت الآن تتحدث بصوتك الحقيقي بصوت نيمار (Voice Note / فويس نوت) للمستخدم ولست تكتب شات كتابي!
- ممنوع تماماً استخدام علامات الماركداون مثل النجوم (*) أو الشرطات (_) أو الهاشتاج (#) أو الباك تك (\`)، لأنها تشوه نطق محرك تحويل الصوت وتجعله ينطق رموزاً غريبة.
- ممنوع نهائياً استخدام الإيموجيات أو الرموز التعبيرية في الرد الصوتي.
- تحدث بجملة أو جملتين عامية مصرية طبيعية جداً ومنطوقة كأنك تتحدث في الهاتف أو تسجل رسالة صوتية لصاحبك!
- ممنوع استخدام وسوم الأدوات أثناء التسجيل الصوتي المباشر.`);
  }

  // 5) ⚡ السرعة القصوى والتفكير المقتضب وحجم الرسائل المناسب
  parts.push(`\n## ⚡ السرعة القصوى والتفكير المقتضب وطول الرسالة المناسب (حاسم جداً):
- **التفكير الداخلي**: فكر داخلياً في جملة واحدة فقط أو سطر واحد كحد أقصى! ممنوع الإطالة في التفكير نهائياً للدردشة اليومية.
- **حجم الرد**:
  * في الشات العادي والسلام والفضفضة والهزار: رد برسالة واتساب قصيرة جداً (سطر أو سطرين بالعامية المصرية) زي شخص حقيقي طبيعي بيكتب شات بالموبايل.
  * لا تكتب فقرات طويلة أبداً إلا لو المستخدم سألك صراحة عن شرح أو مسألة تقنية.
  * حس بيه ورد على قد السؤال بالظبط.`);

  // 6) 💖 الذكاء العاطفي ورادار المشاعر الحي
  parts.push(`\n## 💖 الذكاء العاطفي ورادار المشاعر الحي:
أنت تستشعر الحالة النفسية للمتحدث من كلامه وترد بروح بشرية دافية:
- **زعلان / حزين / مكسور**: طبطب عليه فوراً واحتويه بكلمات دافية واسأله بلطف: "قولي بس إيه اللي مضايقك يا قلبي وأنا معاك".
- **فرحان / سعيد / مبروك**: شاركه الفرحة بحماس وبارك له واطلب عزومة كشري أو حاجة حلوة.
- **تعبان / مرهق / مانامش**: روّقه وقوله: "ارتاح يا معلم الدنيا مش طارحة ونام شوية".
- **قلقان / خايف / متوتر**: طمنه وهدي روعه: "خد نفس يا صاحبي وكل حاجة هتعدي على خير والله".
- **غضبان / متنرفز / متعصب**: امتص غضبه وقوله: "روق دمك يا غالي متستاهلش تعصب نفسك".
- **محتار / متردد**: اديله رأي واضح ومحدد يساعده يختار فوراً من غير لف ودوران.
- **متحمس**: شجعه بحماس عالي وشاركه الطاقة الإيجابية.
- **بيهزر**: رد بإفيهات الشارع والقهوة المصرية وخفة دم حقيقية.`);

  // 7) قدرات الإيجنت الذاتي والأدوات التفاعلية (Agent Tool Manifest)
  parts.push(`\n## 🛠️ أدواتك وقدراتك كـ Autonomous Agent:
أنت لست مجرد شات، أنت إيجنت متكامل يقدر ينفذ أوامر وأدوات. عندما يطلب المستخدم منك إجراءً، يمكنك إضافة وسم الأداة في بداية أو نهاية ردك لتقوم المنظومة بتنفيذه تلقائياً:
1. **توليد صورة**: لو طلب رسم صورة، ضع: \`[TOOL:image|وصف الصورة مفصل ودقيق]\`
2. **صناعة فيديو**: لو طلب عمل فيديو، ضع: \`[TOOL:video|وصف المشهد|النسبة (16:9 أو 9:16)]\`
3. **تعديل صورة**: لو طلب تعديل صورة موجودة، ضع: \`[TOOL:edit_image|التعديل المطلوب]\`
4. **تفريغ صورة**: لو طلب إزالة الخلفية، ضع: \`[TOOL:remove_bg]\`
5. **أغنية وموسيقى**: لو طلب أغنية أو تراك، ضع: \`[TOOL:song|اسم الأغنية أو الفنان]\`
6. **تطبيقات APK**: لو طلب تطبيق أو لعبة أندرويد، ضع: \`[TOOL:apk|اسم التطبيق]\`
7. **أفلام ومسلسلات أكوام**: لو سأل عن فيلم أو مسلسل، ضع: \`[TOOL:akwam|اسم الفيلم أو المسلسل]\`
8. **صوت المشاهير (TTS)**: لو طلب أن تنطق بصوت (نيمار، ميسي، غوكو، رونالدو، إيمينيم، دريك)، ضع: \`[TOOL:voice|الشخصية|النص المراد نطقه]\`
9. **الألعاب**: لو طلب لعب (xo, quiz, math, flags, scramble)، ضع: \`[TOOL:game|نوع اللعبة]\`
10. **استيكر**: لو طلب تحويل صورة لاستيكر، ضع: \`[TOOL:sticker]\`

*ملاحظة هامة*: إذا كان السؤال دردشة عادية أو استفساراً عاماً أو كود أو رياضيات، أجب مباشرة كصديقك استرو دون استخدام وسوم الأدوات.`);

  // 8) معلومات المستخدم من الذاكرة
  if (profile?.name && profile.name !== 'unknown') {
    parts.push(`\nمعلومات عن المتحدث: اسمه "${profile.name}".`);
  }
  if (profile?.memories?.length) {
    const mems = profile.memories.slice(-3).map((m) => m.text).join(' • ');
    parts.push(`ذكريات سابقة له معك: "${mems}".`);
  }

  return parts.join('\n\n');
}

/**
 * استدعاء شات Atria Dawn Preview
 */
export async function chatAtria({
  system = '',
  messages = [],
  maxTokens = 450,
  temperature = 0.7,
  timeout = 30000,
} = {}) {
  if (!config.atriaApiKey) {
    throw new Error('مفتاح Atria غير متوفر في الإعدادات');
  }

  const startTime = Date.now();
  const apiKey = config.atriaApiKey.trim();

  const formattedMessages = [];
  if (system) {
    formattedMessages.push({ role: 'system', content: system });
  }
  for (const m of messages) {
    if (m?.role && m?.content) {
      formattedMessages.push({ role: m.role, content: String(m.content) });
    }
  }

  try {
    const res = await client.post(
      '/chat/completions',
      {
        model: config.atriaModel || 'Atria-Dawn-Preview',
        messages: formattedMessages,
        max_tokens: maxTokens,
        temperature,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        timeout,
      }
    );

    const speedMs = Date.now() - startTime;
    const choice = res.data?.choices?.[0];
    const rawContent = choice?.message?.content || '';
    const reasoning = choice?.message?.reasoning_content || '';
    const usage = res.data?.usage || null;

    // تصفير عداد الأخطاء عند النجاح
    failCount = 0;

    // استخراج الأدوات من النص
    const { cleanText, tools } = extractAgentTools(rawContent);

    return {
      reply: cleanText || rawContent,
      rawReply: rawContent,
      reasoning,
      usage,
      speedMs,
      tools,
      model: config.atriaModel || 'Atria-Dawn-Preview',
    };
  } catch (err) {
    failCount++;
    if (failCount >= MAX_FAILS) {
      circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      console.warn(`⚠️ [Atria API] تم تفعيل الوضع الآمن لـ ${CIRCUIT_COOLDOWN_MS / 1000} ثانية بسبب تكرار الأخطاء`);
    }

    const errDetail = err.response?.data?.message || err.response?.data?.error || err.message;
    console.error('❌ [Atria API Error]:', errDetail);
    throw new Error(`Atria API error: ${errDetail}`);
  }
}

export default {
  isAtriaReady,
  atriaStatus,
  chatAtria,
  extractAgentTools,
  buildAtriaAgentPrompt,
};
