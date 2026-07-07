import type { Response } from 'express';
import type { Message } from '../../shared/types.js';
import { buildMindMap, streamReply } from './heuristicEngine.js';
import { callLLM, getLLMConfig, streamLLMReply } from './llmClient.js';
import { detectStructured, cleanStructured } from './outlineCleaner.js';
import { analyzeMarkdownOutline } from '../../shared/markdownImport.js';

export interface StreamHandle {
  reply: string;
  markmap: string;
  aborted: boolean;
}

function safeSSE(res: Response, aborted: { v: boolean }, event: string, data: unknown) {
  if (aborted.v) return;
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    aborted.v = true;
  }
}

export async function handleChatStream(
  res: Response,
  messages: Message[],
  newUserMessage?: string,
): Promise<StreamHandle> {
  // 清洗结构化输入：去掉树形/编号脏字符再交给 AI/本地引擎，避免污染 prompt。
  // 纯自然语言 detectStructured 返回 null，原样通过（误伤防护）。
  const kind = newUserMessage ? detectStructured(newUserMessage) : null;
  const cleanedMessage =
    newUserMessage && kind ? cleanStructured(newUserMessage, kind) : newUserMessage;

  const allMessages: Message[] = cleanedMessage
    ? [
        ...messages,
        {
          id: 'pending',
          role: 'user',
          content: cleanedMessage,
          timestamp: Date.now(),
        },
      ]
    : messages;

  const aborted = { v: false };
  res.on('close', () => { aborted.v = true; });
  res.on('error', () => { aborted.v = true; });

  const cfg = getLLMConfig();
  let reply: string;
  let markmap: string;
  const markdownImport = cleanedMessage ? analyzeMarkdownOutline(cleanedMessage) : null;

  if (markdownImport) {
    reply = `识别到 Markdown 大纲，已按原结构导入（${markdownImport.nodeLikeLineCount} 个结构行，未调用 LLM）。`;
    markmap = markdownImport.markdown;
  } else if (cfg) {
    try {
      const llmMessages = allMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      const result = await callLLM(llmMessages, cfg);
      reply = result.reply;
      markmap = result.markmap;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[LLM call failed]', {
        protocol: cfg.protocol,
        model: cfg.model,
        baseURL: cfg.baseURL,
        error: errMsg,
        timestamp: new Date().toISOString(),
      });
      const fallback = buildMindMap(allMessages);
      reply = `（LLM 调用失败：${errMsg.slice(0, 80)}，已切换本地引擎）${fallback.reply}`;
      markmap = fallback.markdown;
    }
  } else {
    const r = buildMindMap(allMessages);
    reply = r.reply;
    markmap = r.markdown;
  }

  // 流式推送回复
  const onDelta = (delta: string) => safeSSE(res, aborted, 'reply', { delta });
  if (cfg) {
    await streamLLMReply(reply, onDelta);
  } else {
    await streamReply(reply, onDelta);
  }

  // 推送完整 markmap
  safeSSE(res, aborted, 'markmap', { markdown: markmap });
  safeSSE(res, aborted, 'done', {});
  try { res.end(); } catch { /* ignore */ }

  return { reply, markmap, aborted: aborted.v };
}
