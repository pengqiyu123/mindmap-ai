import { Router, type Request, type Response } from 'express';
import { readCCSwitchModels, toPublic, type CCModel } from '../services/ccswitchReader.js';
import {
  setRuntimeConfig,
  getRuntimeConfig,
  callLLM,
  type LLMConfig,
} from '../services/llmClient.js';

const router = Router();

// 当前选中的模型 id（进程内存）
let selectedId: string | null = null;

function findModelById(id: string): CCModel | null {
  const { models } = readCCSwitchModels();
  return models.find((m) => m.id === id) || null;
}

function toConfig(m: CCModel): LLMConfig {
  return {
    protocol: m.protocol,
    apiKey: m.apiKey,
    baseURL: m.baseURL,
    model: m.model,
  };
}

// 列出 ccswitch 读到的所有模型（隐藏完整 key）
router.get('/', (_req: Request, res: Response) => {
  const { models, dbPath, error } = readCCSwitchModels();
  const rt = getRuntimeConfig();
  res.json({
    success: true,
    data: {
      dbPath,
      error: error || null,
      selectedId,
      // 无选中且无运行时配置时，后端会用环境变量或本地启发式引擎
      usingRuntime: !!rt,
      models: models.map(toPublic),
    },
  });
});

// 选择某个模型作为运行时 LLM
router.post('/select', (req: Request, res: Response) => {
  const { id } = req.body as { id?: string };
  if (!id) return res.status(400).json({ success: false, error: 'id 不能为空' });
  const m = findModelById(id);
  if (!m) return res.status(404).json({ success: false, error: '未找到该模型（可能 ccswitch 配置已变化）' });
  setRuntimeConfig(toConfig(m));
  selectedId = m.id;
  res.json({ success: true, data: toPublic(m) });
});

// 清除运行时配置（回退到环境变量 / 本地启发式引擎）
router.post('/clear', (_req: Request, res: Response) => {
  setRuntimeConfig(null);
  selectedId = null;
  res.json({ success: true });
});

// 连通性测试：用当前选中/指定模型发一条极小请求，验证协议适配
router.post('/test', async (req: Request, res: Response) => {
  const { id } = req.body as { id?: string };
  let cfg: LLMConfig | null = null;
  let name = '';
  if (id) {
    const m = findModelById(id);
    if (!m) return res.status(404).json({ success: false, error: '未找到该模型' });
    cfg = toConfig(m);
    name = m.providerName;
  } else {
    cfg = getRuntimeConfig();
    name = '当前选中模型';
  }
  if (!cfg) return res.status(400).json({ success: false, error: '没有可测试的模型，请先选择' });
  try {
    const start = Date.now();
    const result = await callLLM(
      [{ role: 'user', content: '请只回复 JSON：{"reply":"ok","markmap":"# 测试\\n## 连通正常"}' }],
      cfg,
    );
    res.json({
      success: true,
      data: {
        name,
        protocol: cfg.protocol,
        model: cfg.model,
        latencyMs: Date.now() - start,
        replyPreview: (result.reply || '').slice(0, 40),
      },
    });
  } catch (e) {
    const msg = (e as Error).message;
    let kind = 'unknown';
    if (/401|403|Unauthorized|Forbidden/i.test(msg)) kind = 'auth_failed';
    else if (/404|not found/i.test(msg)) kind = 'endpoint_not_found';
    else if (/timeout|ETIMEDOUT|aborted/i.test(msg)) kind = 'timeout';
    else if (/fetch failed|ECONNREFUSED|ENOTFOUND|connect/i.test(msg)) kind = 'network';
    else if (/JSON|parse|Unexpected token|response_format/i.test(msg)) kind = 'response_format';
    res.json({
      success: false,
      error: msg,
      errorKind: kind,
      protocol: cfg.protocol,
      model: cfg.model,
      baseURL: cfg.baseURL,
    });
  }
});

export default router;
