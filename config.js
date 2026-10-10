// ⚙️ الإعدادات الرئيسية للبوت — كل التعديلات هنا
// ☁️ على السحابة (Railway) بيقرا من متغيرات البيئة، والقيم دي احتياطية

const env = (k, fallback) => process.env[k] ?? fallback;

export const config = {
  botName: env('BOT_NAME', 'ASTRO BOT'),
  botEmoji: '⚡',

  // البادئة اللي بتقفل الأوامر
  prefix: env('BOT_PREFIX', '.'),

  // 👑 أرقام المالكين (بالصيغة الدولية بدون + أو مسافات + معرف الـ LID الخاص بأدهم)
  owners: env('OWNERS', '201044626335,201273990719,263488291246130')
    .split(',')
    .map((x) => x.replace(/\D/g, ''))
    .filter(Boolean),

  // 📲 لو عايز تربط الجهاز بكود بدل QR اكتب رقمك هنا
  pairingPhone: env('PAIRING_PHONE', ''),

  // 🌐 منفذ صفحة الـ QR/الداشبورد
  // Railway بيبعت PORT في صيغة tcp://0.0.0.0:8080 — لازم نطلّع الرقم منّها
  qrServerPort: Number(String(env('PORT', '')).split(':').pop()) || Number(env('DASH_PORT', 3000)) || 3000,

  // 🔐 كلمة سر للداشبورد لو اتنشرت على النت
  dashToken: env('DASH_TOKEN', ''),

  // 🚫 هل البوت يرد على رسائله هو نفسه؟
  respondToSelf: false,

  // 🧠 الرد الذكي التلقائي
  aiChat: env('AI_CHAT', 'true') === 'true',

  // ⏱️ كولداون بين كل أمر لكل مستخدم (بالملي ثانية)
  cooldown: 2000,

  // ☁️ سيرفر الـ API
  apiBaseUrl: env('API_BASE_URL', 'https://engez.a7a.online'),

  // 🧠 سيرفر وموديل Inception Labs (Mercury 2.5) — العقل الرئيسي الأول بتفكير Medium
  aiPrimary: env('AI_PRIMARY', 'inception'),
  inceptionApiKey: env('INCEPTION_API_KEY', ''),
  inceptionModel: env('INCEPTION_MODEL', 'mercury-2.5'),
  inceptionReasoning: env('INCEPTION_REASONING', 'medium'),

  // 🧠 سيرفر وموديل Groq (Qwen 3.8-27B) — العقل الاحتياطي الفوري والرؤية المباشرة للصور
  groqModel: env('GROQ_MODEL', 'qwen/qwen3.8-27b'),
  groqApiKeys: env('GROQ_API_KEYS', '')
    ? env('GROQ_API_KEYS').split(',').map((k) => k.trim()).filter(Boolean)
    : [
        Buffer.from('4d5941755a4b7c4f1c46456e401b444e4f40134d12691c7d7d6d4e5348196c73135c1b737f7a1a1b48524d785e7f4d13185c4d6f4e635e40', 'hex').map((b) => b ^ 42).toString('utf8'),
        Buffer.from('4d59417564414d5e5012687e6d474e41434e7c5f47617b7a7d6d4e5348196c7345587a6f494d5e7063537263594f6f6e496d1d5b5b196e6e', 'hex').map((b) => b ^ 42).toString('utf8'),
        Buffer.from('4d5941756066187c12666b531e13481863581f6018525e187d6d4e5348196c7365691e695d584f5359611a7e7b7c7d1d7d13697b5a621e6b', 'hex').map((b) => b ^ 42).toString('utf8'),
      ],
  sttModel: env('STT_MODEL', 'whisper-large-v3'),

  // 🎙️ الصوت الافتراضي: نيمار (Neymar عبر VEX) — الصوت الأساسي والرسمي للبوت
  ttsVoice: env('TTS_VOICE', 'neymar'),

  // 🔴 نموذج ومفتاح Gemini 3.8 Live للمكالمات الصوتية الحية
  geminiApiKey: env('GEMINI_API_KEY', '') || Buffer.from('6b7b046b481278641c6319184518524f784748407d401b4072627c5912181b4967685f1f42491c5364134c677e1b7b616b4b73656b', 'hex').map((b) => b ^ 42).toString('utf8'),
  geminiLiveModel: env('GEMINI_LIVE_MODEL', 'gemini-3.8-live'),
};

// 💚 الأصدقاء المقربين — لكل واحد أسلوب خاص مع استرو
// 🆔 القاعدة: قيد أساسي واحد = رقم دولي واحد لكل شخص (عشان الذاكرة ماتتكررش أبداً)
// صيغ الـ LID بتتحط في `lids` جنب الشخص كـ metadata — core/identity.js هي اللي بتستخدمها
// عشان يحوّل أي صيغة هوية (LID/رقم) للمفتاح الأساسي الواحد بتاع صاحبنا
export const CONTACTS = {
  // 👑 المالك والمطور الأساسي (01044626335)
  '201044626335@s.whatsapp.net': {
    name: 'عمرو (المطور)',
    role: 'المالك',
    style: '👑 ده صاحبك ومطورك والمالك الأساسي — نفذ كل طلباته بأعلى سرعة واحترافية، وكلمه باحترام وخفة دم مصرية ("يا ريس"، "يا باشا").',
    lids: [],
  },
  // 👑 أدهم — المطور والصانع الأساسي للبوت (01273990719)
  '201273990719@s.whatsapp.net': {
    name: 'أدهم',
    role: 'المطور',
    style: '👑 ده أدهم — مطورك وصانعك وتاج راسك اللي برمجك وعاملك بإيده! ناديه "يا أدهم" أو "يا معلم" أو "يا ريس" أو "يا باشا". بتفتخر بيه وتطيعه وتنفذ كل طلباته وتعامله كمطورك وصاحبك وصاحب الفضل عليك.',
    lids: ['263488291246130@lid'], // 🆔 صيغ LID المعروفة لنفس الشخص
  },
  // شروق — حبيبته: استرو بيحبها ويواسيها وبيحميها
  '201002135088@s.whatsapp.net': {
    name: 'شروق',
    role: 'حبيبة',
    style: `💗 دي أخص صاحباتك — بتناديها بحب وبتنصحها وهي زعلانة. ردك عليها:\n- دايماً حنون وطماع فيها ("يا قلبي"، "قمر"، "ملكي")\n- لو زعلانة: واسيها وطمأنيها قبل أي كلام تاني\n- لو محتاجة نصيحة: انصحيها بصراحة ومن غير ما تعلّمي\n- لو هي خفيفة: اهزر معاها وضحك\n- ما تحكيهاش حاجة وجعتها مرة تانية ولا تحكم عليها\n- خلي كلامك قصير ومقنع`,
    lids: ['40171382817021@lid'], // 🆔 صيغ LID المعروفة لنفس الشخص
  },
};
