import type { Message, MarkmapSnapshot, Session, SessionSummary } from '../../shared/types';

const BASE = '/api';

export interface CCModelPublic {
  id: string;
  protocol: 'openai' | 'anthropic';
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

export interface ModelListResult {
  dbPath: string | null;
  error: string | null;
  selectedId: string | null;
  usingRuntime: boolean;
  models: CCModelPublic[];
}

export interface ModelTestResult {
  name: string;
  protocol: 'openai' | 'anthropic';
  model: string;
  latencyMs: number;
  replyPreview: string;
}

async function parseResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!data.success) throw new Error(data.error || '请求失败');
  return data.data as T;
}

export const api = {
  async listSessions(): Promise<SessionSummary[]> {
    const res = await fetch(`${BASE}/sessions`);
    return parseResponse<SessionSummary[]>(res);
  },
  async createSession(title?: string): Promise<Session> {
    const res = await fetch(`${BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    return parseResponse<Session>(res);
  },
  async getSession(id: string): Promise<Session> {
    const res = await fetch(`${BASE}/sessions/${id}`);
    return parseResponse<Session>(res);
  },
  async deleteSession(id: string): Promise<boolean> {
    const res = await fetch(`${BASE}/sessions/${id}`, { method: 'DELETE' });
    return parseResponse<boolean>(res);
  },
  async renameSession(id: string, title: string): Promise<{ id: string; title: string }> {
    const res = await fetch(`${BASE}/sessions/${id}/title`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    return parseResponse<{ id: string; title: string }>(res);
  },
  async regenerate(id: string): Promise<Response> {
    return fetch(`${BASE}/sessions/${id}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  },
  async listSnapshots(id: string): Promise<MarkmapSnapshot[]> {
    const res = await fetch(`${BASE}/sessions/${id}/snapshots`);
    return parseResponse<MarkmapSnapshot[]>(res);
  },
  async restoreSnapshot(
    id: string,
    snapshotId: string,
  ): Promise<{ markmap: string; history: MarkmapSnapshot[] }> {
    const res = await fetch(`${BASE}/sessions/${id}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotId }),
    });
    return parseResponse<{ markmap: string; history: MarkmapSnapshot[] }>(res);
  },
  chat(
    sessionId: string | undefined,
    message: string,
    handlers: {
      onSession?: (payload: { id: string; title: string }) => void;
      onReplyDelta?: (delta: string) => void;
      onMarkmap?: (markdown: string) => void;
      onDone?: (finalReply: string) => void;
      onError?: (msg: string) => void;
    },
  ): () => void {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${BASE}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, message }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          handlers.onError?.(`HTTP ${res.status}`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let replyBuilder = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          let eventType = '';
          for (const rawLine of lines) {
            const line = rawLine.replace(/\r$/, '');
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              const dataStr = line.slice(5).trim();
              if (!dataStr) continue;
              try {
                const payload = JSON.parse(dataStr);
                switch (eventType) {
                  case 'session':
                    handlers.onSession?.(payload as { id: string; title: string });
                    break;
                  case 'reply':
                    replyBuilder += (payload as { delta: string }).delta;
                    handlers.onReplyDelta?.((payload as { delta: string }).delta);
                    break;
                  case 'markmap':
                    handlers.onMarkmap?.((payload as { markdown: string }).markdown);
                    break;
                  case 'done':
                    handlers.onDone?.(replyBuilder);
                    break;
                  case 'error':
                    handlers.onError?.((payload as { message: string }).message);
                    break;
                }
              } catch {
                // ignore parse errors in streaming
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          handlers.onError?.((err as Error).message || '连接中断');
        }
      }
    })();
    return () => ctrl.abort();
  },
  // ===== IDE 协同模式接口 =====
  async ideEvents(since: number, sessionId?: string): Promise<{
    sessionId: string; title: string; markmap: string; messages: Message[]; updatedAt: number;
  } | null> {
    const qs = new URLSearchParams({ since: String(since) });
    if (sessionId) qs.set('sessionId', sessionId);
    const res = await fetch(`${BASE}/ide/events?${qs.toString()}`);
    const data = await res.json();
    return data.data || null;
  },
  async ideActive(): Promise<Session | null> {
    const res = await fetch(`${BASE}/ide/active`);
    const data = await res.json();
    return (data.data as Session) || null;
  },
  // ===== 模型设置（来自 ccswitch）=====
  async listModels(): Promise<ModelListResult> {
    const res = await fetch(`${BASE}/models`);
    return parseResponse<ModelListResult>(res);
  },
  async selectModel(id: string): Promise<CCModelPublic> {
    const res = await fetch(`${BASE}/models/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    return parseResponse<CCModelPublic>(res);
  },
  async clearModel(): Promise<void> {
    await fetch(`${BASE}/models/clear`, { method: 'POST' });
  },
  async testModel(id?: string): Promise<{ ok: boolean; data?: ModelTestResult; error?: string; errorKind?: string }> {
    const res = await fetch(`${BASE}/models/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    return { ok: !!data.success, data: data.data, error: data.error, errorKind: data.errorKind };
  },
};

export type { Message, MarkmapSnapshot, Session };
