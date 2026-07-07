/**
 * LLM 客户端：支持两种协议
 *  - OpenAI Chat Completions（protocol='openai'，POST ${baseURL}/chat/completions）
 *  - Anthropic Messages（protocol='anthropic'，POST ${baseURL}/v1/messages）
 *
 * 配置优先级：运行时选中的模型（来自设置面板 / ccswitch）> 环境变量。
 */

export type LLMProtocol = 'openai' | 'anthropic';

export interface LLMConfig {
  protocol: LLMProtocol;
  apiKey: string;
  baseURL: string;
  model: string;
}

// 运行时选中的配置（用户在设置面板里选的 ccswitch 模型），进程内存，重启即失效。
let runtimeConfig: LLMConfig | null = null;

export function setRuntimeConfig(cfg: LLMConfig | null): void {
  runtimeConfig = cfg;
}

export function getRuntimeConfig(): LLMConfig | null {
  return runtimeConfig;
}

export function getLLMConfig(): LLMConfig | null {
  if (runtimeConfig) return runtimeConfig;
  // 环境变量兜底
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      protocol: 'openai',
      apiKey: openaiKey,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };
  }
  const anthKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (anthKey) {
    return {
      protocol: 'anthropic',
      apiKey: anthKey,
      baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
    };
  }
  return null;
}

const SYSTEM_PROMPT = `你是一个思维导图整理助手。用户会分段发文本（可能中途追加），你需要：
1. 基于全部对话历史生成 Markmap 格式的 Markdown 思维导图。
2. 用 # 表示根节点，## 表示一级分支，### 表示二级要点，- 表示三级细节。
3. 根节点使用最能概括主题的一个词/短语。
4. 一级分支控制在 3-6 个，覆盖核心主题；叶子节点简洁（一般不超过 20 字）。
5. 每次输出完整的最新导图（不是 diff），后续追加的内容合并到合适的分支下，必要时新增分支。
6. 同时输出一段 1-2 句的简短中文回复，说明这次更新了什么。

请严格以 JSON 返回，不要带其他文字，格式：
{"reply": "给用户的简短中文回复", "markmap": "# ...\\n\\n## ..."}
`;

export interface LLMResult {
  reply: string;
  markmap: string;
}

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

function parseResult(content: string): LLMResult {
  let parsed: LLMResult;
  try {
    parsed = JSON.parse(content);
  } catch {
    const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // 最后兜底：尝试抽取第一个 { ... } JSON 块
      const m = cleaned.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { reply: '', markmap: '' };
    }
  }
  if (!parsed.markmap) parsed.markmap = '# 导图生成失败\n- 请稍后再试\n';
  if (!parsed.reply) parsed.reply = '导图已更新。';
  return parsed;
}

async function callOpenAI(messages: ChatMessage[], cfg: LLMConfig): Promise<LLMResult> {
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages,
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' as const },
  };
  const res = await fetch(`${cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = data.choices?.[0]?.message?.content || '{}';
  return parseResult(content);
}

async function callAnthropic(messages: ChatMessage[], cfg: LLMConfig): Promise<LLMResult> {
  // Anthropic：system 单独传，messages 只含 user/assistant 且需交替、首条为 user
  const convo = messages.filter((m) => m.role !== 'system');
  const normalized: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of convo) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const last = normalized[normalized.length - 1];
    if (last && last.role === role) {
      last.content += `\n\n${m.content}`;
    } else {
      normalized.push({ role, content: m.content });
    }
  }
  if (normalized.length === 0 || normalized[0].role !== 'user') {
    normalized.unshift({ role: 'user', content: '（开始整理）' });
  }
  const body = {
    model: cfg.model,
    max_tokens: 4096,
    temperature: 0.3,
    system: SYSTEM_PROMPT,
    messages: normalized,
  };
  const res = await fetch(`${cfg.baseURL.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const content = (data.content || [])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('') || '{}';
  return parseResult(content);
}

export async function callLLM(
  messages: ChatMessage[],
  cfg: LLMConfig,
): Promise<LLMResult> {
  if (cfg.protocol === 'anthropic') return callAnthropic(messages, cfg);
  return callOpenAI(messages, cfg);
}

export async function streamLLMReply(
  reply: string,
  onReplyDelta: (delta: string) => void,
): Promise<void> {
  const chars = Array.from(reply);
  for (let i = 0; i < chars.length; i++) {
    onReplyDelta(chars[i]);
    await new Promise((r) => setTimeout(r, 18 + Math.random() * 25));
  }
}
