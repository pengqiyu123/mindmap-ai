import { create } from 'zustand';
import type { MarkmapSnapshot, Message, SessionSummary } from '../../shared/types';
import {
  analyzeMarkdownOutline,
  isMarkdownFilename,
  titleFromFilename,
} from '../../shared/markdownImport';
import { api } from '../lib/api';
import { loadVisualPrefs, saveVisualPrefs, type VisualPrefs } from '../lib/themes';

interface AppState {
  // session list
  sessions: SessionSummary[];
  drawerOpen: boolean;

  // current session
  currentId: string | null;
  title: string;
  messages: Message[];
  markmap: string;
  isStreaming: boolean;
  streamingReply: string;
  error: string | null;

  // markmap history
  snapshots: MarkmapSnapshot[];

  // 视觉偏好（主题 / 密度 / 展开层级），持久化到 localStorage
  visualPrefs: VisualPrefs;
  setVisualPrefs: (patch: Partial<VisualPrefs>) => void;

  // actions
  loadSessions: () => Promise<void>;
  toggleDrawer: (open?: boolean) => void;
  newSession: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  importFile: (filename: string, content: string) => Promise<void>;
  regenerate: () => Promise<void>;
  updateTitle: (title: string) => Promise<void>;
  loadSnapshots: (id?: string) => Promise<void>;
  restoreSnapshot: (snapshotId: string) => Promise<void>;
  clearError: () => void;
  restoreFromLocal: () => void;
}

const LAST_KEY = 'mindflow:lastSessionId';

function uid(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const useStore = create<AppState>((set, get) => ({
  sessions: [],
  drawerOpen: false,
  currentId: null,
  title: '新的思维导图',
  messages: [],
  markmap: '',
  isStreaming: false,
  streamingReply: '',
  error: null,
  snapshots: [],
  visualPrefs: loadVisualPrefs(),

  setVisualPrefs(patch) {
    const next = { ...get().visualPrefs, ...patch };
    set({ visualPrefs: next });
    saveVisualPrefs(next);
  },

  async loadSessions() {
    const list = await api.listSessions();
    set({ sessions: list });
  },

  toggleDrawer(open) {
    set({ drawerOpen: open ?? !get().drawerOpen });
  },

  async newSession() {
    const s = await api.createSession();
    set({
      currentId: s.id,
      title: s.title,
      messages: [],
      markmap: '',
      streamingReply: '',
      error: null,
      snapshots: [],
    });
    localStorage.setItem(LAST_KEY, s.id);
    await get().loadSessions();
  },

  async selectSession(id) {
    const s = await api.getSession(id);
    set({
      currentId: s.id,
      title: s.title,
      messages: s.messages,
      markmap: s.markmap,
      streamingReply: '',
      error: null,
      drawerOpen: false,
    });
    localStorage.setItem(LAST_KEY, s.id);
    await get().loadSnapshots(s.id);
  },

  async deleteSession(id) {
    await api.deleteSession(id);
    const list = await api.listSessions();
    if (get().currentId === id) {
      if (list.length > 0) {
        await get().selectSession(list[0].id);
      } else {
        set({ currentId: null, title: '新的思维导图', messages: [], markmap: '' });
        localStorage.removeItem(LAST_KEY);
      }
    }
    set({ sessions: list });
  },

  async sendMessage(text) {
    if (!text.trim() || get().isStreaming) return;
    const userMsg: Message = {
      id: uid('u_'),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };
    set({
      isStreaming: true,
      streamingReply: '',
      error: null,
      messages: [...get().messages, userMsg],
    });

    const assistId = uid('a_');
    let finalReply = '';

    const cancel = api.chat(get().currentId || undefined, text.trim(), {
      onSession: (p) => {
        set({ currentId: p.id, title: p.title });
        localStorage.setItem(LAST_KEY, p.id);
      },
      onReplyDelta: (delta) => {
        finalReply += delta;
        set({ streamingReply: finalReply });
      },
      onMarkmap: (markdown) => {
        set({ markmap: markdown });
      },
      onDone: async () => {
        const state = get();
        const assistantMsg: Message = {
          id: assistId,
          role: 'assistant',
          content: finalReply,
          timestamp: Date.now(),
        };
        set({
          isStreaming: false,
          streamingReply: '',
          messages: [...state.messages, assistantMsg],
        });
        await get().loadSessions();
        await get().loadSnapshots();
        // 标题以后端为准：后端已清洗树形/编号脏字符，且保留导入文件预设的文件名标题。
        // 用前端原文首行会 clobber 这两者，故改为从刚刷新的会话列表同步。
        const cur = get().sessions.find((x) => x.id === get().currentId);
        if (cur) set({ title: cur.title });
      },
      onError: (msg) => {
        set({ isStreaming: false, streamingReply: '', error: msg });
      },
    });
    // store cancel for future use (not exposed for now)
    void cancel;
  },

  async importFile(filename, content) {
    // 标题优先用文件名（去扩展名），符合「我导入了什么」的心智；
    // 内容首行作标题的逻辑留给纯对话/推送场景。
    const titleFromName = titleFromFilename(filename);

    // 检测内容是否已是结构化 Markdown 大纲。
    // 如果是，直接走 push-markmap 直提，不让 LLM/引擎重新"理解"破坏原有结构。
    const markdownImport = isMarkdownFilename(filename)
      ? analyzeMarkdownOutline(content, titleFromName)
      : null;

    if (markdownImport) {
      // .md 且内容已是 markmap：直提，不走 /chat
      let createdId: string | null = null;
      try {
        const s = await api.createSession(markdownImport.title || titleFromName || '导入的导图');
        createdId = s.id;
        await api.pushMarkmap({
          sessionId: s.id,
          markdown: markdownImport.markdown,
          userMessage: `（导入文件：${filename}）`,
          reply: `已从文件「${filename}」导入，结构保持原样。`,
        });
        // 重新读取完整会话状态
        const full = await api.getSession(s.id);
        set({
          currentId: full.id,
          title: full.title,
          messages: full.messages,
          markmap: full.markmap,
          streamingReply: '',
          error: null,
        });
        localStorage.setItem(LAST_KEY, full.id);
        await get().loadSessions();
        await get().loadSnapshots(full.id);
        return;
      } catch (err) {
        if (createdId) {
          try { await api.deleteSession(createdId); } catch { /* ignore cleanup */ }
        }
        set({
          error: `Markdown 导入失败：${err instanceof Error ? err.message : String(err)}`,
          isStreaming: false,
          streamingReply: '',
        });
        return;
      }
    }

    // 非 markmap 文件（.txt 或纯自然语言 .md）：走 sendMessage，由 AI/引擎整理
    const prompt =
      content.length > 4000
        ? `${content.slice(0, 4000)}\n\n（文件较长，已截断）`
        : content;
    if (titleFromName) {
      const s = await api.createSession(titleFromName);
      set({
        currentId: s.id,
        title: s.title,
        messages: [],
        markmap: '',
        streamingReply: '',
        error: null,
        snapshots: [],
      });
      localStorage.setItem(LAST_KEY, s.id);
      await get().loadSessions();
    }
    await get().sendMessage(prompt);
  },

  async regenerate() {
    const id = get().currentId;
    if (!id || get().isStreaming) return;
    set({ isStreaming: true, streamingReply: '', error: null });
    try {
      const res = await api.regenerate(id);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let reply = '';
      let eventType = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const raw of lines) {
          const line = raw.replace(/\r$/, '');
          if (line.startsWith('event:')) eventType = line.slice(6).trim();
          else if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;
            const payload = JSON.parse(dataStr);
            if (eventType === 'reply') {
              reply += payload.delta;
              set({ streamingReply: reply });
            } else if (eventType === 'markmap') {
              set({ markmap: payload.markdown });
            }
          }
        }
      }
      // refresh session
      const s = await api.getSession(id);
      set({ messages: s.messages, markmap: s.markmap, isStreaming: false, streamingReply: '' });
      await get().loadSnapshots(id);
    } catch (err) {
      set({ isStreaming: false, error: (err as Error).message });
    }
  },

  async updateTitle(title) {
    const trimmed = title.trim();
    if (!trimmed) return;
    set({ title: trimmed });
    const id = get().currentId;
    if (id) {
      try {
        await api.renameSession(id, trimmed);
        await get().loadSessions();
      } catch {
        // 本地文件几乎不会失败，简单起见不回滚
      }
    }
  },

  async loadSnapshots(id) {
    const sid = id ?? get().currentId;
    if (!sid) {
      set({ snapshots: [] });
      return;
    }
    const list = await api.listSnapshots(sid);
    set({ snapshots: list });
  },

  async restoreSnapshot(snapshotId) {
    const sid = get().currentId;
    if (!sid) return;
    const { markmap, history } = await api.restoreSnapshot(sid, snapshotId);
    set({ markmap, snapshots: history });
    await get().loadSessions();
  },

  clearError() {
    set({ error: null });
  },

  restoreFromLocal() {
    const id = localStorage.getItem(LAST_KEY);
    if (id) {
      api.getSession(id)
        .then((s) => {
          set({
            currentId: s.id,
            title: s.title,
            messages: s.messages,
            markmap: s.markmap,
          });
          get().loadSnapshots(s.id);
        })
        .catch(() => {
          localStorage.removeItem(LAST_KEY);
        });
    }
  },
}));
