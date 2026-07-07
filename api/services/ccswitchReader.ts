/**
 * 从 CC Switch (ccswitch) 的 SQLite 数据库读取模型配置。
 * 只读取，不修改。
 *
 * 数据来源：~/.cc-switch/cc-switch.db 的 providers + settings('universal_providers')
 *
 * 支持两种协议：
 *  - OpenAI 协议（protocol='openai'，走 /chat/completions）
 *      · codex providers：auth.OPENAI_API_KEY + TOML config 的 base_url，wire_api != 'anthropic-messages'
 *      · openclaw/opencode/hermes：baseURL + apiKey（OpenAI 兼容中转）
 *      · claude providers 且 meta.apiFormat === 'openai_chat' / 'openai_responses'
 *      · universal_providers 的 models.codex
 *  - Anthropic 协议（protocol='anthropic'，走 /v1/messages）
 *      · claude / claude-desktop providers（meta.apiFormat 缺省或 'anthropic'）：
 *        env.ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY + ANTHROPIC_MODEL
 *      · codex providers 且 wire_api === 'anthropic-messages'
 *      · universal_providers 的 models.claude
 *
 * 注：Gemini 原生、OAuth（Codex/Copilot 登录态）等既非 OpenAI 也非 Anthropic 兼容的配置不纳入。
 */
import { DatabaseSync, type DatabaseSync as DB } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export type LLMProtocol = 'openai' | 'anthropic';

export interface CCModel {
  id: string;               // 唯一 id
  protocol: LLMProtocol;    // 'openai' | 'anthropic'
  source: string;           // 'universal' | 'codex' | 'claude' | 'claude-desktop' | 'openclaw' | 'opencode'
  providerName: string;     // 显示名
  baseURL: string;          // 归一化后的 base URL（openai 补到 /v1；anthropic 去掉 /v1/messages 尾巴）
  apiKey: string;           // API Key
  model: string;            // 当前选中的 model id
  icon?: string;
  iconColor?: string;
  isCurrent?: boolean;      // 是否 ccswitch 中 is_current
  category?: string;
}

interface ProviderRow {
  id: string;
  app_type: string;
  name: string;
  settings_config: string;
  icon?: string;
  icon_color?: string;
  is_current: number;
  category?: string;
  meta: string;
}

function findDbPaths(): string[] {
  const home = homedir();
  const candidates = [
    join(home, '.cc-switch', 'cc-switch.db'),
  ];
  // 也尝试自定义路径（ccswitch settings.json 里可能有 dir override）
  try {
    const settingsPath = join(home, '.cc-switch', 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      if (settings?.appConfigDir) candidates.push(join(settings.appConfigDir, 'cc-switch.db'));
    }
  } catch { /* ignore */ }
  return candidates.filter((p) => existsSync(p));
}

/** OpenAI 兼容 base URL：确保以 /v1 结尾（供 ${base}/chat/completions） */
function normalizeOpenAIBaseURL(url: string | undefined | null): string {
  if (!url) return '';
  let u = url.trim().replace(/\/+$/, '');
  if (!/\/v\d+$/.test(u)) {
    if (/\/(chat\/completions|responses|messages|v\d\/chat\/completions)$/.test(u)) {
      u = u.replace(/\/(chat\/completions|responses|messages|v\d\/chat\/completions)$/, '');
    }
    if (!/\/v\d+$/.test(u)) {
      u = u + '/v1';
    }
  }
  return u;
}

/**
 * Anthropic base URL：去掉 /v1/messages、/messages 尾巴与末尾斜杠，
 * 保留路径前缀（如 /anthropic、/api/coding），供客户端拼 ${base}/v1/messages。
 */
function normalizeAnthropicBaseURL(url: string | undefined | null): string {
  if (!url) return '';
  let u = url.trim().replace(/\/+$/, '');
  u = u.replace(/\/v1\/messages$/, '');
  u = u.replace(/\/messages$/, '');
  u = u.replace(/\/+$/, '');
  return u;
}

function maskKey(k: string): string {
  if (!k) return '';
  if (k.length <= 8) return '***';
  return k.slice(0, 4) + '…' + k.slice(-4);
}

function parseTomlBaseUrl(toml: string): string {
  const sectionRe = /\[model_providers\.([^\]]+)\][\s\S]*?(?=\n\[|$)/g;
  let m: RegExpExecArray | null;
  let best = '';
  while ((m = sectionRe.exec(toml)) !== null) {
    const block = m[0];
    const bu = block.match(/base_url\s*=\s*"([^"]+)"/);
    if (bu) { best = bu[1]; break; }
  }
  if (!best) {
    const g = toml.match(/base_url\s*=\s*"([^"]+)"/);
    if (g) best = g[1];
  }
  return best;
}

function parseTomlModel(toml: string): string {
  const m = toml.match(/^model\s*=\s*"([^"]+)"/m);
  return m ? m[1] : '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 解析外部 ccswitch JSON，结构不可信
function safeJSON(s: string | undefined | null): any {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

/** 从 Anthropic 风格 env 里取模型（含 ccswitch 常见的 DEFAULT_*_MODEL 兜底） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 外部 env 键值不可信
function pickAnthropicModel(env: Record<string, any>): string {
  return (
    env.ANTHROPIC_MODEL ||
    env.ANTHROPIC_DEFAULT_OPUS_MODEL ||
    env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
    ''
  );
}

function readUniversalProviders(db: DB): CCModel[] {
  const out: CCModel[] = [];
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'universal_providers'`).get() as { value: string } | undefined;
    if (!row) return out;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 解析外部 ccswitch JSON，结构不可信
    const map = safeJSON(row.value) as Record<string, any>;
    for (const [uid, p] of Object.entries(map)) {
      const apiKey = p.apiKey || '';
      if (!apiKey) continue;
      // codex 子配置 → OpenAI 协议
      const openaiModel = p.models?.codex?.model || '';
      if (openaiModel && p.baseUrl) {
        out.push({
          id: `ccswitch:universal:${uid}:openai`,
          protocol: 'openai',
          source: 'universal',
          providerName: p.name || uid,
          baseURL: normalizeOpenAIBaseURL(p.baseUrl),
          apiKey,
          model: openaiModel,
          icon: p.icon,
          iconColor: p.iconColor,
          category: p.category || 'aggregator',
          isCurrent: false,
        });
      }
      // claude 子配置 → Anthropic 协议
      const anthropicModel = p.models?.claude?.model || '';
      if (anthropicModel && p.baseUrl) {
        out.push({
          id: `ccswitch:universal:${uid}:anthropic`,
          protocol: 'anthropic',
          source: 'universal',
          providerName: p.name || uid,
          baseURL: normalizeAnthropicBaseURL(p.baseUrl),
          apiKey,
          model: anthropicModel,
          icon: p.icon,
          iconColor: p.iconColor,
          category: p.category || 'aggregator',
          isCurrent: false,
        });
      }
    }
  } catch { /* ignore */ }
  return out;
}

function readProviders(db: DB): CCModel[] {
  const out: CCModel[] = [];
  const rows = db.prepare(
    `SELECT id, app_type, name, settings_config, icon, icon_color, is_current, category, meta FROM providers`
  ).all() as unknown as ProviderRow[];

  for (const r of rows) {
    const cfg = safeJSON(r.settings_config);
    const meta = safeJSON(r.meta);
    let protocol: LLMProtocol = 'openai';
    let baseURL = '';
    let apiKey = '';
    let model = '';

    try {
      switch (r.app_type) {
        case 'codex': {
          const tomlStr: string = cfg.config || '';
          const bu = parseTomlBaseUrl(tomlStr);
          const mk = parseTomlModel(tomlStr);
          const wireApi = tomlStr.match(/wire_api\s*=\s*"([^"]+)"/)?.[1] || '';
          const key = cfg.auth?.OPENAI_API_KEY || cfg.auth?.OPENAI_KEY || cfg.auth?.ANTHROPIC_API_KEY || '';
          if (bu && key) {
            if (wireApi === 'anthropic-messages') {
              protocol = 'anthropic';
              baseURL = normalizeAnthropicBaseURL(bu);
              apiKey = key;
              model = mk || 'claude-3-5-sonnet-latest';
            } else {
              protocol = 'openai';
              baseURL = normalizeOpenAIBaseURL(bu);
              apiKey = key;
              model = mk || 'gpt-4o-mini';
            }
          }
          break;
        }
        case 'openclaw':
        case 'openclaw-pro': {
          if (cfg.apiKey && cfg.baseUrl && /^openai/i.test(cfg.api || '')) {
            protocol = 'openai';
            baseURL = normalizeOpenAIBaseURL(cfg.baseUrl);
            apiKey = cfg.apiKey;
            if (Array.isArray(cfg.models) && cfg.models.length > 0) {
              model = cfg.models[0].id || '';
            }
          }
          break;
        }
        case 'opencode':
        case 'omo':
        case 'hermes': {
          const opts = cfg.options || {};
          if (opts.baseURL && opts.apiKey && /openai/i.test(cfg.npm || '')) {
            protocol = 'openai';
            baseURL = normalizeOpenAIBaseURL(opts.baseURL);
            apiKey = opts.apiKey;
            if (cfg.models && typeof cfg.models === 'object') {
              model = Object.keys(cfg.models)[0] || '';
            }
          } else if (r.app_type === 'hermes' && cfg.base_url && cfg.api_key) {
            protocol = 'openai';
            baseURL = normalizeOpenAIBaseURL(cfg.base_url);
            apiKey = cfg.api_key;
            model = 'gpt-4o-mini';
          }
          break;
        }
        case 'claude':
        case 'claude-desktop': {
          const env = cfg.env || {};
          const fmt = meta.apiFormat;
          if (fmt === 'openai_chat' || fmt === 'openai_responses') {
            // 通过中转走 OpenAI 格式
            protocol = 'openai';
            const bu = env.OPENAI_BASE_URL || env.ANTHROPIC_BASE_URL || '';
            const key = env.OPENAI_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '';
            const mk = env.OPENAI_MODEL || pickAnthropicModel(env);
            if (bu && key && mk) {
              baseURL = normalizeOpenAIBaseURL(bu);
              apiKey = key;
              model = mk;
            }
          } else {
            // 默认 Anthropic Messages 协议
            protocol = 'anthropic';
            const bu = env.ANTHROPIC_BASE_URL || '';
            const key = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '';
            const mk = pickAnthropicModel(env);
            if (bu && key && mk) {
              baseURL = normalizeAnthropicBaseURL(bu);
              apiKey = key;
              model = mk;
            }
          }
          break;
        }
        case 'gemini': {
          // Gemini 原生接口既非 OpenAI 也非 Anthropic，跳过
          break;
        }
      }
    } catch {
      continue;
    }

    if (baseURL && apiKey && model) {
      out.push({
        id: `ccswitch:${r.app_type}:${r.id}`,
        protocol,
        source: r.app_type,
        providerName: r.name,
        baseURL,
        apiKey,
        model,
        icon: r.icon,
        iconColor: r.icon_color,
        isCurrent: !!r.is_current,
        category: r.category,
      });
    }
  }
  return out;
}

/**
 * 读取 ccswitch 所有可用的模型配置（OpenAI + Anthropic 两种协议）。
 * 如果 ccswitch 未安装或无有效配置，返回空数组。
 */
export function readCCSwitchModels(): { models: CCModel[]; dbPath: string | null; error?: string } {
  const paths = findDbPaths();
  if (paths.length === 0) {
    return { models: [], dbPath: null, error: '未找到 CC Switch 数据库，请确认已安装 CC Switch 并配置了 provider' };
  }
  const dbPath = paths[0];
  let db: DB | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const models: CCModel[] = [];
    // 去重（protocol+baseURL+model+key 相同视为同一个）
    const seen = new Set<string>();
    const push = (m: CCModel) => {
      const key = `${m.protocol}|${m.baseURL}|${m.model}|${maskKey(m.apiKey)}`;
      if (seen.has(key)) return;
      seen.add(key);
      models.push(m);
    };
    for (const m of readUniversalProviders(db)) push(m);
    for (const m of readProviders(db)) push(m);
    // 把 is_current 的排到前面
    models.sort((a, b) => Number(!!b.isCurrent) - Number(!!a.isCurrent));
    return { models, dbPath };
  } catch (e) {
    return { models: [], dbPath, error: (e as Error).message };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

/** 供 API 返回给前端的安全视图（隐藏完整 key） */
export interface CCModelPublic {
  id: string;
  protocol: LLMProtocol;
  source: string;
  providerName: string;
  baseURL: string;
  model: string;
  keyMasked: string;
  icon?: string;
  iconColor?: string;
  isCurrent?: boolean;
  category?: string;
}

export function toPublic(m: CCModel): CCModelPublic {
  return {
    id: m.id,
    protocol: m.protocol,
    source: m.source,
    providerName: m.providerName,
    baseURL: m.baseURL,
    model: m.model,
    keyMasked: maskKey(m.apiKey),
    icon: m.icon,
    iconColor: m.iconColor,
    isCurrent: m.isCurrent,
    category: m.category,
  };
}

/**
 * 简单测试：直接 node 运行本文件可输出所有读到的模型
 */
if (process.argv[1]?.endsWith('ccswitchReader.ts') || process.argv[1]?.endsWith('ccswitchReader.js')) {
  const result = readCCSwitchModels();
  console.log('DB:', result.dbPath);
  if (result.error) console.log('Error:', result.error);
  for (const m of result.models) {
    console.log(`- [${m.protocol}][${m.source}] ${m.providerName} → ${m.model} @ ${m.baseURL} (key=${maskKey(m.apiKey)}) current=${m.isCurrent}`);
  }
}
