import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, User, Loader2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import ReactMarkdown from 'react-markdown';

export default function ChatPanel() {
  const messages = useStore((s) => s.messages);
  const streamingReply = useStore((s) => s.streamingReply);
  const isStreaming = useStore((s) => s.isStreaming);
  const sendMessage = useStore((s) => s.sendMessage);
  const markmap = useStore((s) => s.markmap);
  const listRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, streamingReply]);

  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = 'auto';
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 160) + 'px';
    }
  }, [input]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <div className="flex flex-col h-full bg-white border-r border-zinc-200/70">
      {/* Message list */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4 scroll-smooth">
        {isEmpty && <EmptyState />}
        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} />
        ))}
        {isStreaming && streamingReply.length === 0 && (
          <div className="flex items-center gap-2 text-zinc-500 text-sm pl-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            AI 正在思考...
          </div>
        )}
        {streamingReply && (
          <MessageBubble role="assistant" content={streamingReply} streaming />
        )}
      </div>

      {/* Map status bar */}
      {markmap && (
        <div className="px-4 py-2 border-t border-zinc-100 bg-gradient-to-r from-indigo-50/50 to-purple-50/50 flex items-center gap-2 text-xs text-zinc-500">
          <Sparkles size={12} className="text-indigo-500" />
          <span>思维导图已实时更新 →</span>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-zinc-200/70 bg-white">
        <div className="relative flex items-end gap-2 bg-zinc-50 rounded-2xl border border-zinc-200 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100 transition-all p-2">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="输入你的想法（Enter 发送，Shift+Enter 换行）..."
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none leading-6"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-md shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:scale-105 transition-all disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
          >
            {isStreaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
        <div className="mt-1.5 px-2 text-[11px] text-zinc-400 flex items-center justify-between">
          <span>随时追加内容，导图会持续生长</span>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ role, content, streaming }: { role: 'user' | 'assistant'; content: string; streaming?: boolean }) {
  const isUser = role === 'user';
  return (
    <div className={`flex gap-2.5 animate-[fadeUp_0.3s_ease-out] ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser
            ? 'bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-md shadow-indigo-500/30'
            : 'bg-white border border-zinc-200 text-indigo-500'
        }`}
      >
        {isUser ? <User size={14} /> : <Sparkles size={14} />}
      </div>
      <div className={`max-w-[82%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? 'bg-gradient-to-br from-indigo-500 to-purple-500 text-white rounded-tr-md shadow-md shadow-indigo-500/20'
              : 'bg-zinc-50 text-zinc-800 rounded-tl-md border border-zinc-100'
          } ${streaming ? 'after:content-[▊] after:ml-0.5 after:animate-pulse after:text-indigo-400' : ''}`}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{content}</div>
          ) : (
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="m-0">{children}</p>,
                code: ({ children }) => <code className="bg-zinc-200/50 px-1 py-0.5 rounded text-xs">{children}</code>,
                strong: ({ children }) => <strong className="font-semibold text-indigo-600">{children}</strong>,
              }}
            >
              {content}
            </ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  const examples = [
    '帮我整理 Python 学习笔记：基础语法、函数、类、装饰器...',
    '我在规划一次日本旅行，想去东京、京都、大阪，预算1万...',
    '今天开会讨论了新项目：需要前端、后端、数据库，两周交付...',
  ];
  const send = useStore.getState().sendMessage;
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-10 px-2 animate-[fadeUp_0.5s_ease-out]">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-xl shadow-indigo-500/30 mb-4">
        <Sparkles size={28} className="text-white" />
      </div>
      <h2 className="text-xl font-bold text-zinc-800 mb-1" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
        MindFlow AI
      </h2>
      <p className="text-sm text-zinc-500 mb-6 max-w-xs">
        把你零散的想法发给我，我会边聊边帮你整理成一张实时生长的思维导图。
      </p>
      <div className="w-full space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">试试这些例子</div>
        {examples.map((ex, i) => (
          <button
            key={i}
            onClick={() => send(ex)}
            className="w-full text-left p-3 rounded-xl border border-zinc-200 hover:border-indigo-300 hover:bg-indigo-50/50 text-sm text-zinc-700 transition-all group"
          >
            <span className="group-hover:text-indigo-600 transition-colors">{ex}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
