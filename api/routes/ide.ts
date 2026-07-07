/**
 * IDE 专用接口
 * 让 Trae / Cursor / Claude Code / Codex / Zed AI 等 IDE 里的 AI 用最简单的方式
 * （curl / fetch / npm run ide:send）把用户在 IDE 里说的内容推到导图服务。
 * 浏览器通过长轮询自动感知更新并刷新导图，全程无需复制粘贴。
 */
import { Router, type Request, type Response } from 'express';
import { createSession, getSession, listSessions, saveSession } from '../repositories/sessionRepo.js';
import { buildMindMap } from '../services/heuristicEngine.js';
import { callLLM, getLLMConfig } from '../services/llmClient.js';
import { pushSnapshot } from '../services/snapshot.js';
import { detectStructured, cleanStructured } from '../services/outlineCleaner.js';
import { setActiveSessionId, getActiveSessionId } from '../state/activeSession.js';

const router = Router();

// 会话 ID 白名单（与 sessionRepo 一致）。ide.ts 的 sessionId 来自请求 body / query，
// 非法格式提前拦成 400，避免直穿到 sessionRepo.filePath() 抛错被兜成 500。
// 本波不抽公共 util，按边界要求就地复制。
const ID_RE = /^[a-z0-9]+$/i;

/**
 * 覆盖风险检测（非阻塞软警告）：新导图行数明显少于当前（<50%），
 * 疑似 IDE AI 只提交了增量而非完整合并，旧内容会被覆盖。
 * 返回提示文案；无风险返回 null。严格不阻塞、不 reject。
 */
function detectOverwriteRisk(currentMd: string, newMd: string): string | null {
  if (!currentMd) return null; // 空图无风险
  const currentLines = currentMd.split('\n').filter((l) => l.trim()).length;
  const newLines = newMd.split('\n').filter((l) => l.trim()).length;
  if (newLines < currentLines * 0.5) {
    return `新导图(${newLines}行)明显少于当前(${currentLines}行)，可能只提交了增量，旧内容将被覆盖`;
  }
  return null;
}

/**
 * POST /api/ide/push
 * IDE AI 把用户的一段想法推到导图。
 * body: { message: string, title?: string, sessionId?: string }
 * 返回: { sessionId, title, markmap, reply }
 */
router.post('/push', async (req: Request, res: Response) => {
  const { message, title, sessionId } = req.body as {
    message?: string;
    title?: string;
    sessionId?: string;
  };
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ success: false, error: 'message 字段必填' });
  }
  if (sessionId && !ID_RE.test(sessionId)) {
    return res.status(400).json({ success: false, error: '无效的会话 ID' });
  }

  // 清洗结构化输入：在 push 进 session.messages 之前先去脏字符，
  // 这样存储与本地/LLM 引擎读到的都是干净文本（红线：导图不出现 │├└─）。
  const kind = detectStructured(message);
  const cleanedMessage = kind ? cleanStructured(message, kind) : message.trim();

  // 解析优先级：显式 sessionId > 后端活动会话 > 新建。
  // 不再兜底取「最近历史会话」——后端重启（active 内存丢失）后若取最近会话，
  // 会把 IDE 推送内容误追加到用户没预期的旧导图上。
  let session = sessionId ? getSession(sessionId) : getActiveSessionId() ? getSession(getActiveSessionId()!) : null;
  if (!session) {
    session = createSession(title || cleanedMessage.slice(0, 12) || '新的思维导图');
  }
  setActiveSessionId(session.id);

  session.messages.push({
    id: `u_${Date.now()}`,
    role: 'user',
    content: cleanedMessage,
    timestamp: Date.now(),
    source: 'ide',
  });

  let reply: string;
  let markmap: string;
  const cfg = getLLMConfig();
  if (cfg) {
    try {
      const llmMessages = session.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      const r = await callLLM(llmMessages, cfg);
      reply = r.reply;
      markmap = r.markmap;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[LLM call failed]', {
        protocol: cfg.protocol,
        model: cfg.model,
        baseURL: cfg.baseURL,
        error: errMsg,
        timestamp: new Date().toISOString(),
      });
      const fallback = buildMindMap(session.messages);
      reply = `（LLM 调用失败：${errMsg.slice(0, 80)}，已切换本地引擎）${fallback.reply}`;
      markmap = fallback.markdown;
    }
  } else {
    const r = buildMindMap(session.messages);
    reply = r.reply;
    markmap = r.markdown;
  }

  session.messages.push({
    id: `a_${Date.now()}`,
    role: 'assistant',
    content: reply,
    timestamp: Date.now(),
    source: 'ide',
  });
  pushSnapshot(session, 'ide'); // 覆盖前存旧图
  session.markmap = markmap;
  session.markmapSource = 'ide';
  session.updatedAt = Date.now();
  if (title) session.title = title;
  else if (session.title === '新的思维导图') {
    // cleanedMessage 已去 box 字符，但树形输入首行可能残留前导空格（├─ → 空格），需 trim。
    session.title = cleanedMessage.split(/\n/)[0].trim().slice(0, 16);
  }
  saveSession(session);

  res.json({
    success: true,
    data: {
      sessionId: session.id,
      title: session.title,
      markmap,
      reply,
      messageCount: session.messages.length,
    },
  });
});

/**
 * POST /api/ide/push-markmap
 * IDE AI 自己生成了 Markmap Markdown，直接提交
 */
router.post('/push-markmap', (req: Request, res: Response) => {
  const { markdown, sessionId, reply, userMessage } = req.body as {
    markdown?: string;
    sessionId?: string;
    reply?: string;
    userMessage?: string;
  };
  if (!markdown || typeof markdown !== 'string') {
    return res.status(400).json({ success: false, error: 'markdown 必填' });
  }
  if (sessionId && !ID_RE.test(sessionId)) {
    return res.status(400).json({ success: false, error: '无效的会话 ID' });
  }
  // 解析优先级：显式 sessionId > 后端活动会话 > 新建（不取最近历史会话，避免误写旧导图）。
  let session = sessionId ? getSession(sessionId) : getActiveSessionId() ? getSession(getActiveSessionId()!) : null;
  if (!session) session = createSession('新的思维导图');
  setActiveSessionId(session.id);
  if (userMessage) {
    session.messages.push({
      id: `u_${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      source: 'ide',
    });
  }
  session.messages.push({
    id: `a_${Date.now()}`,
    role: 'assistant',
    content: reply || '（由 IDE AI 生成导图）',
    timestamp: Date.now(),
    source: 'ide',
  });
  // 覆盖保护：非阻塞软警告（检测在覆盖前，用当前 markmap 对比新 markdown）
  const riskMsg = detectOverwriteRisk(session.markmap, markdown);
  if (riskMsg) {
    console.warn('[overwrite risk]', {
      sessionId: session.id,
      currentLines: session.markmap.split('\n').filter((l) => l.trim()).length,
      newLines: markdown.split('\n').filter((l) => l.trim()).length,
    });
  }
  pushSnapshot(session, 'ide'); // 覆盖前存旧图
  session.markmap = markdown;
  session.markmapSource = 'ide';
  session.updatedAt = Date.now();
  saveSession(session);
  res.json({
    success: true,
    data: { sessionId: session.id, title: session.title },
    ...(riskMsg ? { warning: riskMsg } : {}),
  });
});

/**
 * GET /api/ide/active
 */
router.get('/active', (_req: Request, res: Response) => {
  const id = getActiveSessionId();
  if (!id) return res.json({ success: true, data: null });
  const s = getSession(id);
  if (!s) {
    setActiveSessionId(null);
    return res.json({ success: true, data: null });
  }
  res.json({ success: true, data: s });
});

/**
 * POST /api/ide/active  浏览器切换会话时调用
 * body: { sessionId: string | null }
 */
router.post('/active', (req: Request, res: Response) => {
  const { sessionId } = req.body as { sessionId?: string | null };
  if (sessionId && !ID_RE.test(sessionId)) {
    return res.status(400).json({ success: false, error: '无效的会话 ID' });
  }
  if (sessionId && getSession(sessionId)) {
    setActiveSessionId(sessionId);
  } else {
    setActiveSessionId(null);
  }
  res.json({ success: true });
});

/**
 * GET /api/ide/new  创建/获取新的空会话
 */
router.post('/new', (req: Request, res: Response) => {
  const title = (req.body?.title as string) || '新的思维导图';
  const s = createSession(title);
  setActiveSessionId(s.id);
  res.json({ success: true, data: s });
});

/**
 * GET /api/ide/events?since=<ts>&sessionId?
 * 长轮询，浏览器用来自动刷新
 */
router.get('/events', async (req: Request, res: Response) => {
  const since = Number(req.query.since) || 0;
  const explicitSid = (req.query.sessionId as string) || null;
  if (explicitSid && !ID_RE.test(explicitSid)) {
    return res.status(400).json({ success: false, error: '无效的会话 ID' });
  }
  const deadline = Date.now() + 25000;

  // 未显式指定会话时，每次轮询都重新读取「活动会话」，
  // 这样从「无活动会话」等待状态下也能第一时间感知 IDE 的首次推送。
  const check = () => {
    const sid = explicitSid || getActiveSessionId();
    if (!sid) return null;
    const s = getSession(sid);
    if (!s) return null;
    if (s.updatedAt > since) return s;
    return null;
  };

  let result = check();
  while (!result && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800));
    result = check();
  }

  if (result) {
    res.json({
      success: true,
      data: {
        sessionId: result.id,
        title: result.title,
        markmap: result.markmap,
        messages: result.messages,
        updatedAt: result.updatedAt,
      },
    });
  } else {
    res.json({ success: true, data: null, timeout: true });
  }
});

/**
 * GET /api/ide/health
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      activeSessionId: getActiveSessionId(),
      sessionCount: listSessions().length,
      usage: {
        push: 'POST /api/ide/push  body: {message, title?, sessionId?}',
        pushMarkmap: 'POST /api/ide/push-markmap  body: {markdown, sessionId?, reply?, userMessage?}',
        events: 'GET /api/ide/events?since=ts (长轮询)',
        setActive: 'POST /api/ide/active  body: {sessionId}',
        cli: 'npm run ide:send -- "你的想法"',
      },
    },
  });
});

export default router;
