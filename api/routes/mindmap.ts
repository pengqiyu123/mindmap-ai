import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  saveSession,
} from '../repositories/sessionRepo.js';
import { handleChatStream } from '../services/aiService.js';
import { detectStructured, cleanStructured } from '../services/outlineCleaner.js';
import { pushSnapshot, materializeCurrentIfNeeded } from '../services/snapshot.js';
import type { ChatRequest } from '../../shared/types.js';
import { setActiveSessionId, getActiveSessionId } from '../state/activeSession.js';

const router = Router();

// 会话 ID 白名单（与 sessionRepo 一致）。非法格式提前拦成 400，
// 避免非法 id 直穿到 sessionRepo.filePath() 抛错、被错误中间件兜成 500。
const ID_RE = /^[a-z0-9]+$/i;
function validateId(req: Request, res: Response, next: NextFunction) {
  if (!ID_RE.test(req.params.id)) {
    return res.status(400).json({ success: false, error: '无效的会话 ID' });
  }
  next();
}

// SSE helper
function sse(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

// List sessions
router.get('/sessions', (_req: Request, res: Response) => {
  res.json({ success: true, data: listSessions() });
});

// Create session
router.post('/sessions', (_req: Request, res: Response) => {
  const title = (_req.body?.title as string) || '新的思维导图';
  const session = createSession(title);
  res.json({ success: true, data: session });
});

// Get session
router.get('/sessions/:id', validateId, (req: Request, res: Response) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: '会话不存在' });
  res.json({ success: true, data: s });
});

// Delete session
router.delete('/sessions/:id', validateId, (req: Request, res: Response) => {
  const ok = deleteSession(req.params.id);
  res.json({ success: ok });
});

// Regenerate map（复用 /chat 的 AI 服务：有 LLM 走 LLM、无则降级，不再硬编码本地引擎）
router.post('/sessions/:id/regenerate', validateId, async (req: Request, res: Response) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: '会话不存在' });
  sse(res);
  try {
    // 不传新消息：只用历史消息重新生成。handleChatStream 内部已完整处理 SSE 生命周期（markmap/done/error + res.end）
    const { markmap } = await handleChatStream(res, s.messages);
    pushSnapshot(s, 'regenerate'); // 覆盖前存旧图
    s.markmap = markmap;
    s.markmapSource = 'regenerate';
    s.updatedAt = Date.now();
    saveSession(s);
  } catch (err) {
    if (res.writableEnded) return;
    const msg = err instanceof Error ? err.message : 'unknown error';
    res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
    res.end();
  }
});

// 列出历史快照
router.get('/sessions/:id/snapshots', validateId, (req: Request, res: Response) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: '会话不存在' });
  res.json({ success: true, data: s.markmapHistory || [] });
});

// 恢复到某个快照（原地，只改 markmap，不回滚 messages、不分支）
router.post('/sessions/:id/restore', validateId, (req: Request, res: Response) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: '会话不存在' });
  const { snapshotId } = req.body as { snapshotId?: string };
  const snap = (s.markmapHistory || []).find((h) => h.id === snapshotId);
  if (!snap) return res.status(404).json({ success: false, error: '快照不存在' });
  // 止血：恢复不再产生 restore 快照。先物化当前版（若它不在 history），防止当前版丢失。
  // markmapSource 恢复后不改——它跟随内容来源、不跟随指针；第二步指针模型会用 currentVersionId 替代。
  materializeCurrentIfNeeded(s);
  s.markmap = snap.markdown;
  s.updatedAt = Date.now();
  saveSession(s);
  res.json({ success: true, data: { markmap: s.markmap, history: s.markmapHistory } });
});

// Chat (SSE)
router.post('/chat', async (req: Request, res: Response) => {
  const { sessionId, message } = req.body as ChatRequest;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ success: false, error: '消息不能为空' });
  }
  sse(res);
  try {
    let session = sessionId ? getSession(sessionId) : getActiveSessionId() ? getSession(getActiveSessionId()!) : null;
    if (!session) {
      // 标题延后到首次交换后统一生成（清洗 + guard），避免用原文首行（含树形脏字符）建标题。
      session = createSession('新的思维导图');
    }
    setActiveSessionId(session.id);

    // 推送 sessionId 让前端对齐
    res.write(
      `event: session\ndata: ${JSON.stringify({ id: session.id, title: session.title })}\n\n`,
    );

    const { reply, markmap } = await handleChatStream(
      res,
      session.messages,
      message.trim(),
    );

    // 保存
    session.messages.push({
      id: `u_${Date.now()}`,
      role: 'user',
      content: message.trim(),
      timestamp: Date.now(),
      source: 'chat',
    });
    session.messages.push({
      id: `a_${Date.now()}`,
      role: 'assistant',
      content: reply,
      timestamp: Date.now(),
      source: 'chat',
    });
    pushSnapshot(session, 'chat'); // 覆盖前存旧图
    session.markmap = markmap;
    session.markmapSource = 'chat';
    session.updatedAt = Date.now();
    // 更新标题（第一次交换后根据首条消息；清洗掉树形/编号脏字符）。
    // guard `=== '新的思维导图'`：只在默认标题时生成，避免覆盖导入文件预设的文件名标题。
    if (session.messages.length === 2 && session.title === '新的思维导图') {
      const rawFirstLine = message.trim().split(/\n/)[0];
      const kind = detectStructured(rawFirstLine);
      const cleanedFirstLine = kind ? cleanStructured(rawFirstLine, kind) : rawFirstLine;
      session.title = cleanedFirstLine.trim().slice(0, 16) || session.title;
    }
    saveSession(session);
  } catch (err) {
    // handleChatStream 已处理 error 事件并 res.end()；仅在流尚未关闭时兜底
    if (res.writableEnded) return;
    const msg = err instanceof Error ? err.message : 'unknown error';
    res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
    res.end();
  }
});

// 改标题（持久化）
router.patch('/sessions/:id/title', validateId, (req: Request, res: Response) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: '会话不存在' });
  const title = (req.body?.title as string)?.trim();
  if (!title) return res.status(400).json({ success: false, error: 'title 不能为空' });
  s.title = title.slice(0, 50);
  s.updatedAt = Date.now();
  saveSession(s);
  res.json({ success: true, data: { id: s.id, title: s.title } });
});

// Export
router.get('/sessions/:id/export', validateId, (req: Request, res: Response) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: '会话不存在' });
  const format = (req.query.format as string) || 'md';
  if (format === 'md') {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(s.title)}.md"`,
    );
    return res.send(s.markmap || '# 空导图\n');
  }
  if (format === 'text') {
    // 纯文本大纲：按 markdown 层级转缩进空格，保留嵌套深度（不扁平化）。
    // 标题行：# 顶格 / ## 缩进 2 / ### 缩进 4（每级 2 空格）。
    // 列表行：保留原有缩进 + 去掉 -/*/+ 标记（换 2 空格）。
    const textOutline = (s.markmap || '')
      .split('\n')
      .map((line) => {
        const headingMatch = line.match(/^(#+)\s*(.*)$/);
        if (headingMatch) {
          const depth = headingMatch[1].length;
          const indent = '  '.repeat(Math.max(0, depth - 1));
          return indent + headingMatch[2];
        }
        const bulletMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
        if (bulletMatch) {
          return bulletMatch[1] + '  ' + bulletMatch[3];
        }
        return line;
      })
      .join('\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(s.title)}.txt"`,
    );
    return res.send(textOutline || '空导图\n');
  }
  res.status(400).json({ success: false, error: '不支持的导出格式（前端使用 SVG/PNG 本地转换）' });
});

export default router;
