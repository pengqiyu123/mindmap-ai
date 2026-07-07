import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Terminal, Copy, Check, ExternalLink, Wifi, RefreshCw,
  ChevronDown, User, Sparkles, Inbox, Radio,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { api } from '../lib/api';
import { MINDFLOW_MARKDOWN_FORMAT_SPEC } from '../../shared/markdownImport';

type Status = 'connected' | 'waiting' | 'disconnected';

export default function IdeCollabPanel() {
  const currentId = useStore((s) => s.currentId);
  const title = useStore((s) => s.title);
  const markmap = useStore((s) => s.markmap);
  const messages = useStore((s) => s.messages);
  const loadSessions = useStore((s) => s.loadSessions);
  const selectSession = useStore((s) => s.selectSession);

  const [status, setStatus] = useState<Status>('waiting');
  const [copied, setCopied] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const [setupOpen, setSetupOpen] = useState(true);
  const pollRef = useRef<{ cancel: boolean; gen: number }>({ cancel: false, gen: 0 });
  const feedRef = useRef<HTMLDivElement>(null);

  // IDE 协同模式：后端「活动会话」（由 IDE push 设定）是唯一事实来源，
  // 浏览器只做被动展示，不向后端写入活动会话，避免覆盖 IDE 正在推送的会话。
  const startPolling = useCallback(async () => {
    const gen = ++pollRef.current.gen;
    pollRef.current.cancel = false;
    const alive = () => !pollRef.current.cancel && pollRef.current.gen === gen;

    setStatus('waiting');
    let since = 0;
    try {
      const active = await api.ideActive();
      if (!alive()) return;
      if (active) {
        // 采纳后端当前活动会话的既有内容
        await selectSession(active.id);
        await loadSessions();
        since = active.updatedAt;
        setLastUpdate(active.updatedAt);
      } else {
        // 后端尚无活动会话：保留当前视图内容（可能是对话模式的会话），不清空。
        // 仅当当前确实没有会话时才显示空态。
        const cur = useStore.getState();
        if (!cur.currentId) {
          useStore.setState({ title: '新的思维导图' });
        }
      }
    } catch { /* ignore */ }
    if (!alive()) return;
    setStatus('connected');

    while (alive()) {
      try {
        const data = await api.ideEvents(since); // 不指定会话，始终跟随后端活动会话
        if (!alive()) break;
        if (data) {
          since = data.updatedAt;
          setLastUpdate(data.updatedAt);
          setStatus('connected');
          if (data.sessionId !== useStore.getState().currentId) {
            await selectSession(data.sessionId);
            await loadSessions();
          } else {
            useStore.setState({
              markmap: data.markmap,
              messages: data.messages,
              title: data.title,
            });
          }
        }
      } catch {
        if (!alive()) break;
        setStatus('disconnected');
        await new Promise((r) => setTimeout(r, 2000));
        if (alive()) setStatus('waiting');
      }
    }
  }, [selectSession, loadSessions]);

  useEffect(() => {
    const ref = pollRef.current;
    startPolling();
    return () => {
      ref.cancel = true;
      ref.gen++;
    };
  }, [startPolling]);

  // 新消息进来时滚到底部
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const copyExample = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  // 可复制到 IDE 的提示词（让 IDE AI 知道如何与 MindFlow 协同）
  const promptFirst = `请先阅读项目的 AGENTS.md 文件，了解如何与 MindFlow 思维导图工具协同工作。
然后检查服务是否在运行：npm run ide:health`;
  const promptMake = `帮我把以下内容整理成 Markdown 大纲格式的思维导图，然后用 npm run ide:send 推送到 MindFlow。

${MINDFLOW_MARKDOWN_FORMAT_SPEC}

直接输出 Markdown 大纲，不要加解释。

内容：
[在这里粘贴你的内容]`;
  const promptAppend = `读取 MindFlow 当前的思维导图（GET /api/ide/active），在我的内容基础上合并补充，不要丢失已有分支。

${MINDFLOW_MARKDOWN_FORMAT_SPEC}

整理成完整的 Markdown 大纲后，用 push-markmap 接口提交（不要用 ide:send）：

[在这里粘贴你要补充的内容]`;

  return (
    <div className="flex flex-col h-full w-full bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 text-slate-100">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Terminal size={15} className="text-slate-900" />
          </div>
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              IDE 协同模式
              <StatusBadge status={status} />
            </div>
            <div className="text-[11px] text-slate-400">
              {currentId ? `#${currentId.slice(-6)} · ${title}` : '等待 IDE 推送...'}
            </div>
          </div>
        </div>
        <button
          onClick={() => { pollRef.current.cancel = true; setTimeout(startPolling, 100); }}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-slate-300"
          title="重连"
        >
          <RefreshCw size={15} className={status === 'waiting' ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 顶部：说明 + 接入方式（可折叠） */}
      <div className="shrink-0 px-4 pt-3 space-y-3">
        <div className="rounded-xl bg-white/5 border border-white/10 p-3">
          <div className="flex items-start gap-2 text-xs leading-relaxed">
            <Radio size={14} className="text-emerald-400 mt-0.5 shrink-0" />
            <div className="text-slate-300">
              <strong className="text-white">直接在 IDE 里对话即可</strong>——输入框在你的 IDE（Trae / Cursor / Claude Code）中，
              这里只负责实时展示 AI 推送的导图与动态，无需在网页里再输入。
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 overflow-hidden">
          <button
            onClick={() => setSetupOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400 font-semibold hover:bg-white/5"
          >
            <span>复制提示词到 IDE</span>
            <ChevronDown size={14} className={`transition-transform ${setupOpen ? 'rotate-180' : ''}`} />
          </button>
          {setupOpen && (
            <div className="px-3 pb-3 space-y-3">
              <div className="text-[11px] text-slate-500 leading-relaxed">
                复制以下提示词到 IDE 的 AI 对话框，让 AI 知道如何与 MindFlow 协同。
              </div>

              <CodeBlock
                label="① 首次使用 · 让 AI 了解项目"
                code={promptFirst}
                colorClass="text-amber-200"
                copied={copied === 'first'}
                onCopy={() => copyExample(promptFirst, 'first')}
              />

              <CodeBlock
                label="② 整理思维导图"
                code={promptMake}
                colorClass="text-emerald-300"
                copied={copied === 'make'}
                onCopy={() => copyExample(promptMake, 'make')}
              />

              <CodeBlock
                label="③ 续接 · 在已有导图上补充"
                code={promptAppend}
                colorClass="text-cyan-300"
                copied={copied === 'append'}
                onCopy={() => copyExample(promptAppend, 'append')}
              />
            </div>
          )}
        </div>
      </div>

      {/* 实时活动 feed */}
      <div className="px-4 pt-3 pb-1 shrink-0 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1.5">
          <Wifi size={12} className={status === 'connected' ? 'text-emerald-400' : 'text-amber-400'} />
          实时活动
        </div>
        <span className="text-[11px] text-slate-500">{messages.length} 条</span>
      </div>

      <div ref={feedRef} className="flex-1 overflow-y-auto px-4 pb-3 space-y-2 scrollbar-thin">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 py-10">
            <Inbox size={30} className="mb-3 opacity-50" />
            <div className="text-sm text-slate-400">等待 IDE 推送内容…</div>
            <div className="text-[11px] mt-1 max-w-[240px]">
              在你的 IDE 里发起对话，这里会实时出现每一轮想法与 AI 的整理结果。
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl border p-2.5 ${
                m.role === 'user'
                  ? 'bg-indigo-500/10 border-indigo-500/25'
                  : 'bg-white/5 border-white/10'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                {m.role === 'user' ? (
                  <User size={12} className="text-indigo-300" />
                ) : (
                  <Sparkles size={12} className="text-emerald-300" />
                )}
                <span className={`text-[11px] font-medium ${m.role === 'user' ? 'text-indigo-300' : 'text-emerald-300'}`}>
                  {m.role === 'user' ? '来自 IDE' : 'AI 整理'}
                </span>
                <span className="text-[10px] text-slate-500 ml-auto">
                  {new Date(m.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap line-clamp-4">
                {m.content}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Footer 状态栏 */}
      <div className="shrink-0 px-4 py-2.5 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400">
        <span>
          {status === 'connected' ? '正在监听后端更新' : status === 'waiting' ? '等待推送中…' : '后端连接中断，重试中'}
          · 更新于 {new Date(lastUpdate).toLocaleTimeString()}
        </span>
        {markmap && (
          <a
            href="http://localhost:5173"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-indigo-300 hover:text-indigo-200 transition-colors"
          >
            <ExternalLink size={11} /> 新窗口
          </a>
        )}
      </div>
    </div>
  );
}

function CodeBlock({
  label, code, colorClass, copied, onCopy,
}: {
  label: string;
  code: string;
  colorClass: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <div
        className={`rounded-lg bg-black/40 border border-white/10 p-2.5 font-mono text-[11px] leading-relaxed ${colorClass} relative group cursor-pointer`}
        onClick={onCopy}
        title="点击复制"
      >
        <div className="break-all pr-6">{code}</div>
        <button className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-white">
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map = {
    connected: { color: 'bg-emerald-500', text: '监听中' },
    waiting: { color: 'bg-amber-500 animate-pulse', text: '等待中' },
    disconnected: { color: 'bg-rose-500', text: '已断开' },
  }[status];
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-white/10">
      <span className={`w-1.5 h-1.5 rounded-full ${map.color}`} />
      {map.text}
    </span>
  );
}
