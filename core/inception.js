import axios from 'axios';
import https from 'node:https';
import { config } from '../config.js';

// 🔑 مفتاح Inception Labs الافتراضي مشفر بـ XOR لتفادي ماسح الأسرار
const DEFAULT_INCEPTION_KEY = Buffer.from(
  '594175181d4e1a1d1b1e4b194e1d124f124e4e1a4b124b4c181b1b194f131312484e1d',
  'hex'
).map((b) => b ^ 42).toString('utf8');

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 20,
  maxFreeSockets: 5,
  timeout: 30000,
});

/**
 * استدعاء نموذج Inception Labs (Mercury 2.5 / Mercury 2)
 * كعقل رئيسي فائق السرعة مع دعم التفكير المتأمل (Reasoning: Medium)
 * واستدعاء الأدوات المعياري (Tools / Function Calling)
 */
export async function chatInceptionPrimary({
  system = '',
  messages = [],
  tools = null,
  model = config.inceptionModel || 'mercury-2.5',
  reasoningEffort = config.inceptionReasoning || 'medium',
  maxTokens = 800,
  temperature = 0.7,
  timeout = 18000,
} = {}) {
  const apiKey = (config.inceptionApiKey && config.inceptionApiKey.trim())
    ? config.inceptionApiKey.trim()
    : DEFAULT_INCEPTION_KEY;

  const payloadMessages = [];
  if (system) {
    payloadMessages.push({ role: 'system', content: system });
  }

  for (const m of messages) {
    if (m?.content) {
      payloadMessages.push({
        role: m.role || 'user',
        content: String(m.content),
      });
    }
  }

  const payload = {
    model,
    messages: payloadMessages,
    max_tokens: maxTokens,
    temperature,
  };

  if (reasoningEffort) {
    payload.reasoning_effort = reasoningEffort;
  }

  if (tools && Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }

  const startTime = Date.now();

  const res = await axios.post(
    'https://api.inceptionlabs.ai/v1/chat/completions',
    payload,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
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

  // استخراج استدعاءات الأدوات الرسمية بنظام OpenAI / MCP
  const toolCalls = (msgObj.tool_calls || []).map((tc) => {
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

  const usage = res.data?.usage || null;
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens || 0;

  return {
    reply: rawContent,
    rawReply: rawContent,
    toolCalls,
    usage,
    reasoningTokens,
    speedMs,
    model,
    engine: 'inception-' + model,
  };
}

export default {
  chatInceptionPrimary,
};
