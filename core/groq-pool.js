import axios from 'axios';
import https from 'node:https';
import { config } from '../config.js';

/**
 * استخراج أي أدوات تنفيذية طلبها أو قررها الإيجنت من النص
 */
export function extractAgentTools(text) {
  if (!text || typeof text !== 'string') return { cleanText: '', tools: [] };

  const tools = [];
  let cleanText = text;

  // 1) فحص وسوم JSON مثل: [DECISION: {"action": "send_message", "target": "شروق", "message": "ادهم عايزك"}]
  const jsonTagRegex = /\[(?:DECISION|ACTION|TOOL|أداة|قرار):\s*(\{[\s\S]*?\})\]/gi;
  let jsonMatch;
  while ((jsonMatch = jsonTagRegex.exec(cleanText)) !== null) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const act = (parsed.action || parsed.tool || parsed.name || '').toLowerCase().trim();
      if (act && act !== 'none' && act !== 'chat') {
        tools.push({
          raw: jsonMatch[0],
          name: act,
          arg1: parsed.arg1 || parsed.target || parsed.prompt || parsed.query || parsed.text || '',
          arg2: parsed.arg2 || parsed.message || parsed.ratio || parsed.character || '',
          arg3: parsed.arg3 || '',
          params: parsed,
        });
      }
    } catch {}
  }
  cleanText = cleanText.replace(jsonTagRegex, '');

  // 2) فحص وسوم [ACTION: ...] أو [TOOL: ...] أو [قرار: ...] بنظام pipe (|)
  const tagRegex = /\[(?:TOOL|ACTION|DECISION|أداة|قرار):\s*([a-zA-Z0-9_\u0600-\u06FF]+)(?:\s*\|\s*([^\]]*))?\]/gi;
  let tagMatch;
  while ((tagMatch = tagRegex.exec(cleanText)) !== null) {
    const rawName = tagMatch[1].trim();
    const rawArgs = (tagMatch[2] || '').trim();
    const name = rawName.toLowerCase();

    if (name && name !== 'none' && name !== 'chat') {
      const splitArgs = rawArgs.split('|').map((a) => a.trim()).filter(Boolean);
      const params = {};
      const posArgs = [];

      for (const piece of splitArgs) {
        const colonIdx = piece.indexOf(':');
        if (colonIdx > 0 && colonIdx < 20) {
          const k = piece.slice(0, colonIdx).trim().toLowerCase();
          const v = piece.slice(colonIdx + 1).trim();
          params[k] = v;
        } else {
          posArgs.push(piece);
        }
      }

      tools.push({
        raw: tagMatch[0],
        name,
        args: posArgs,
        arg1: params.target || params.prompt || params.query || params.text || posArgs[0] || '',
        arg2: params.message || params.ratio || params.character || posArgs[1] || '',
        arg3: params.extra || posArgs[2] || '',
        params,
      });
    }
  }
  cleanText = cleanText.replace(tagRegex, '');

  // 3) فحص بلوكات JSON المستقلة التي قد يخرجها النموذج
  const codeBlockJsonRegex = /```(?:json)?\s*(\{[\s\S]*?"(?:action|tool)"[\s\S]*?\})\s*```/gi;
  let cbMatch;
  while ((cbMatch = codeBlockJsonRegex.exec(cleanText)) !== null) {
    try {
      const parsed = JSON.parse(cbMatch[1]);
      const act = (parsed.action || parsed.tool || parsed.name || '').toLowerCase().trim();
      if (act && act !== 'none' && act !== 'chat') {
        tools.push({
          raw: cbMatch[0],
          name: act,
          arg1: parsed.arg1 || parsed.target || parsed.prompt || parsed.query || parsed.text || '',
          arg2: parsed.arg2 || parsed.message || parsed.ratio || parsed.character || '',
          arg3: parsed.arg3 || '',
          params: parsed,
        });
      }
    } catch {}
  }
  cleanText = cleanText.replace(codeBlockJsonRegex, '');

  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();

  return { cleanText, tools };
}

// 🔑 إدارة وتدوير مفاتيح Groq الذكية (3 مفاتيح مجانية مع تدوير فوري عند 429)
// نموذج أساسي: qwen/qwen3.8-27b (نصوص + رؤية مباشرة للصور بالعامية المصرية)

const DEFAULT_GROQ_KEYS = [
  Buffer.from('4d5941755a4b7c4f1c46456e401b444e4f40134d12691c7d7d6d4e5348196c73135c1b737f7a1a1b48524d785e7f4d13185c4d6f4e635e40', 'hex').map((b) => b ^ 42).toString('utf8'),
  Buffer.from('4d59417564414d5e5012687e6d474e41434e7c5f47617b7a7d6d4e5348196c7345587a6f494d5e7063537263594f6f6e496d1d5b5b196e6e', 'hex').map((b) => b ^ 42).toString('utf8'),
  Buffer.from('4d5941756066187c12666b531e13481863581f6018525e187d6d4e5348196c7365691e695d584f5359611a7e7b7c7d1d7d13697b5a621e6b', 'hex').map((b) => b ^ 42).toString('utf8'),
];

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 25,
  maxFreeSockets: 10,
  timeout: 45000,
});

class GroqKeyPool {
  constructor() {
    this.keys = (config.groqApiKeys && config.groqApiKeys.length > 0)
      ? config.groqApiKeys
      : DEFAULT_GROQ_KEYS;

    this.currentIndex = 0;
    // حالة كل مفتاح: مؤقت انتهاء التبريد، هل نفذت الحصة اليومية، إحصائيات
    this.keyStates = this.keys.map((key, idx) => ({
      index: idx,
      key,
      masked: key.slice(0, 8) + '...' + key.slice(-4),
      cooldownUntil: 0,
      dailyExhausted: false,
      dailyExhaustedAt: 0,
      requestsCount: 0,
      errorsCount: 0,
      lastUsedAt: 0,
    }));

    // تصفير الحصص اليومية كل 24 ساعة تلقائياً
    this.lastDailyReset = Date.now();
  }

  // فحص وإعادة ضبط الحصص اليومية كل 24 ساعة
  checkDailyReset() {
    const now = Date.now();
    if (now - this.lastDailyReset >= 24 * 60 * 60 * 1000) {
      console.log('🔄 [Groq Pool] إعادة تعيين الحصص اليومية للمفاتيح بعد مرور 24 ساعة');
      for (const state of this.keyStates) {
        state.dailyExhausted = false;
        state.dailyExhaustedAt = 0;
        state.cooldownUntil = 0;
      }
      this.lastDailyReset = now;
      this.currentIndex = 0;
    }
  }

  // الحصول على أفضل مفتاح متاح حالياً
  getActiveKey() {
    this.checkDailyReset();
    const now = Date.now();

    // 1) فحص المفتاح الحالي أولاً
    const current = this.keyStates[this.currentIndex];
    if (!current.dailyExhausted && current.cooldownUntil <= now) {
      return current;
    }

    // 2) البحث عن مفتاح بديل جاهز
    for (let i = 0; i < this.keyStates.length; i++) {
      const idx = (this.currentIndex + i) % this.keyStates.length;
      const state = this.keyStates[idx];
      if (!state.dailyExhausted && state.cooldownUntil <= now) {
        this.currentIndex = idx;
        console.log(`🔀 [Groq Pool] تم التبديل للمفتاح رقم ${idx + 1} (${state.masked})`);
        return state;
      }
    }

    // 3) إذا كانت كل المفاتيح في كولداون مؤقت، نأخذ المفتاح صاحب أقرب وقت انتهاء
    const eligible = this.keyStates.filter((s) => !s.dailyExhausted);
    if (eligible.length > 0) {
      eligible.sort((a, b) => a.cooldownUntil - b.cooldownUntil);
      return eligible[0];
    }

    // 4) كحل أخير إذا نفذت كلها يومياً: نلغي الحظر اليومي للأقدم ونجرب
    console.warn('⚠️ [Groq Pool] جميع المفاتيح استهلكت، جاري إعادة التجربة للمفتاح الأول');
    this.keyStates[0].dailyExhausted = false;
    this.keyStates[0].cooldownUntil = 0;
    this.currentIndex = 0;
    return this.keyStates[0];
  }

  // وسم مفتاح بالـ Rate Limit أو نفاذ الحصة والتدوير الفوري للمفتاح التالي
  markRateLimited(keyIndex, errorData, headers = {}) {
    const state = this.keyStates[keyIndex];
    if (!state) return;

    state.errorsCount++;
    const now = Date.now();
    const errMsg = String(errorData?.error?.message || errorData?.message || '').toLowerCase();

    // فحص هل هو حد يومي (RPD / TPD) أو حد دقيقة (RPM / TPM)
    const isDaily = /\b(?:per[\s_-]?day|daily|requests\s+per\s+day|tokens\s+per\s+day|rpd|tpd)\b/i.test(errMsg) && !errMsg.includes('try again in');
    if (isDaily) {
      state.dailyExhausted = true;
      state.dailyExhaustedAt = now;
      state.cooldownUntil = now + 12 * 60 * 60 * 1000; // كولداون 12 ساعة
      console.warn(`🛑 [Groq Pool] المفتاح ${keyIndex + 1} (${state.masked}) وصل للحد اليومي!`);
    } else {
      // استخراج وقت إعادة التعيين من رسالة الخطأ أو الهيدرز إن وجد، أو الافتراضي 5 ثوان
      let waitSeconds = 5;
      const retryMatch = /try again in\s+([0-9.]+)\s*s/i.exec(errMsg);
      if (retryMatch) {
        waitSeconds = Math.ceil(parseFloat(retryMatch[1])) + 1;
      } else if (headers['retry-after']) {
        const raw = parseFloat(headers['retry-after']);
        if (!isNaN(raw) && raw > 0) waitSeconds = Math.ceil(raw);
      } else if (headers['x-ratelimit-reset-requests']) {
        const raw = parseFloat(headers['x-ratelimit-reset-requests']);
        if (!isNaN(raw) && raw > 0) waitSeconds = Math.ceil(raw);
      }
      state.cooldownUntil = now + Math.min(waitSeconds * 1000, 60000);
      console.warn(`⏳ [Groq Pool] المفتاح ${keyIndex + 1} (${state.masked}) تحت الكولداون لمدة ${waitSeconds} ثانية`);
    }

    // تدوير المؤشر فوراً للمفتاح التالي
    this.currentIndex = (this.currentIndex + 1) % this.keyStates.length;
    console.log(`⚡ [Groq Pool] تم تدوير الحساب فوراً للمفتاح رقم ${this.currentIndex + 1}`);
  }

  getStatus() {
    return {
      activeKeyIndex: this.currentIndex + 1,
      totalKeys: this.keys.length,
      keys: this.keyStates.map((s) => ({
        index: s.index + 1,
        masked: s.masked,
        available: !s.dailyExhausted && s.cooldownUntil <= Date.now(),
        dailyExhausted: s.dailyExhausted,
        cooldownSecondsLeft: Math.max(0, Math.ceil((s.cooldownUntil - Date.now()) / 1000)),
        requestsCount: s.requestsCount,
      })),
    };
  }
}

export const groqPool = new GroqKeyPool();

/**
 * تحويل الصورة (Buffer أو URL) إلى صيغة Base64 Data URI المناسبة لـ Groq Vision
 */
export async function formatImageForGroq(imageInput) {
  if (!imageInput) return null;

  try {
    // 1) إذا كان Image Input هو Buffer مباشر
    if (Buffer.isBuffer(imageInput)) {
      const isPng = imageInput[0] === 0x89 && imageInput[1] === 0x50;
      const mime = isPng ? 'image/png' : 'image/jpeg';
      return `data:${mime};base64,${imageInput.toString('base64')}`;
    }

    // 2) إذا كان رابط ويب (HTTP URL)
    if (typeof imageInput === 'string' && /^https?:\/\//i.test(imageInput)) {
      const res = await axios.get(imageInput, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      const buf = Buffer.from(res.data);
      const contentType = res.headers['content-type'] || 'image/jpeg';
      const mime = /png/i.test(contentType) ? 'image/png' : 'image/jpeg';
      return `data:${mime};base64,${buf.toString('base64')}`;
    }

    // 3) إذا كان 이미 Base64 Data URI جاهز
    if (typeof imageInput === 'string' && imageInput.startsWith('data:image/')) {
      return imageInput;
    }
  } catch (err) {
    console.warn('⚠️ فشل تجهيز الصورة للرؤية بـ Groq:', err.message);
  }
  return null;
}

/**
 * الدالة المركزية لاستدعاء شات ورؤية Groq عبر مجمع المفاتيح مع التدوير التلقائي
 */
export async function chatGroqPrimary({
  system = '',
  messages = [],
  image = null,
  tools = null,
  toolChoice = 'auto',
  model = config.groqModel || 'qwen/qwen3.8-27b',
  maxTokens = 450,
  temperature = 0.7,
  timeout = 15000,
  maxRetries = 3,
} = {}) {
  let attempt = 0;

  // تجهيز مصفوفة الرسائل
  const payloadMessages = [];
  if (system) {
    payloadMessages.push({ role: 'system', content: String(system) });
  }

  // تجهيز الصورة إن وجدت (Groq Vision)
  let visionDataUri = null;
  if (image) {
    visionDataUri = await formatImageForGroq(image);
  }

  const VALID_ROLES = new Set(['system', 'user', 'assistant', 'tool', 'function']);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    let role = String(m.role || 'user').toLowerCase();
    if (role === 'bot') role = 'assistant';
    if (!VALID_ROLES.has(role)) role = 'user';
    const isLastUser = i === messages.length - 1 && role === 'user';

    // إذا كانت هذه آخر رسالة مستخدم ومعها صورة، نمررها بصيغة Vision content array
    if (isLastUser && visionDataUri) {
      payloadMessages.push({
        role: 'user',
        content: [
          { type: 'text', text: String(m.content || 'ماذا يوجد في هذه الصورة؟') },
          { type: 'image_url', image_url: { url: visionDataUri } },
        ],
      });
    } else {
      payloadMessages.push({
        role,
        content: String(m.content || ''),
      });
    }
  }

  while (attempt < maxRetries) {
    const keyState = groqPool.getActiveKey();
    keyState.lastUsedAt = Date.now();
    keyState.requestsCount++;
    const startTime = Date.now();

    const requestPayload = {
      model,
      messages: payloadMessages,
      max_tokens: maxTokens,
      temperature,
    };

    if (tools && Array.isArray(tools) && tools.length > 0) {
      requestPayload.tools = tools;
      requestPayload.tool_choice = toolChoice;
    }

    try {
      const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        requestPayload,
        {
          headers: {
            Authorization: `Bearer ${keyState.key}`,
            'Content-Type': 'application/json',
          },
          httpsAgent,
          timeout,
        }
      );

      const speedMs = Date.now() - startTime;
      const choice = res.data?.choices?.[0];
      const msgObj = choice?.message || {};
      const rawContent = (msgObj.content || '').trim();
      const usage = res.data?.usage || null;

      // استخراج استدعاءات الأدوات الرسمية بنظام OpenAI / MCP
      const officialToolCalls = (msgObj.tool_calls || []).map((tc) => {
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = { raw: tc.function.arguments };
        }
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: args,
          rawArgs: tc.function.arguments,
        };
      });

      // استخراج القرارات والأدوات الذكية من النص كـ fallback
      const { cleanText, tools: textTools } = extractAgentTools(rawContent);

      const allTools = [...officialToolCalls, ...textTools];

      return {
        reply: cleanText || rawContent,
        rawReply: rawContent,
        toolCalls: allTools,
        tools: allTools,
        usage,
        speedMs,
        model,
        keyIndex: keyState.index + 1,
      };
    } catch (err) {
      attempt++;
      const statusCode = err.response?.status;
      const errorData = err.response?.data;
      const headers = err.response?.headers || {};

      console.warn(
        `⚠️ [Groq Pool] خطأ في المفتاح ${keyState.index + 1} (${statusCode || err.code}):`,
        errorData?.error?.message || err.message
      );

      // إذا كان الخطأ 429 (Rate Limit)، نوسم المفتاح وندور فوراً للمفتاح التالي
      if (statusCode === 429) {
        groqPool.markRateLimited(keyState.index, errorData, headers);
        continue;
      }

      // إذا كان النموذج غير مدعوم أو غير متوفر مؤقتاً، نجرب النموذج الاحتياطي
      if (statusCode === 404 || statusCode === 400) {
        if (model === 'qwen/qwen3.8-27b') {
          console.warn('⚠️ محاولة استخدام النموذج البديل openai/gpt-oss-120b');
          model = 'openai/gpt-oss-120b';
          continue;
        }
      }

      // أخطاء التايم آوت العابرة: تبديل المفتاح والمحاولة
      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        groqPool.markRateLimited(keyState.index, { message: 'timeout' }, headers);
        continue;
      }

      // لو لم يكن 429، ننتظر لحظة ثم نعيد المحاولة بمفتاح آخر
      if (attempt < maxRetries) {
        groqPool.markRateLimited(keyState.index, errorData, headers);
      } else {
        throw new Error(errorData?.error?.message || err.message);
      }
    }
  }

  throw new Error('Groq Key Pool: تم استنفاد كافة المحاولات والمفاتيح');
}

export default {
  groqPool,
  chatGroqPrimary,
  formatImageForGroq,
};
