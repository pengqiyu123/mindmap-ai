import { useEffect, useRef, useState } from 'react';
import TopBar from '../components/TopBar';
import SessionDrawer from '../components/SessionDrawer';
import ChatPanel from '../components/ChatPanel';
import IdeCollabPanel from '../components/IdeCollabPanel';
import MarkmapView from '../components/MarkmapView';
import { useStore } from '../store/useStore';

type Mode = 'chat' | 'ide';
const MODE_KEY = 'mindflow:mode';

export default function Home() {
  const markmap = useStore((s) => s.markmap);
  const mmRef = useRef<{ exportSVG: () => string | null; fit: () => void } | null>(null);
  const restoreFromLocal = useStore((s) => s.restoreFromLocal);
  const loadSessions = useStore((s) => s.loadSessions);

  const [mode, setMode] = useState<Mode>(() => {
    const saved = localStorage.getItem(MODE_KEY);
    return (saved === 'ide' ? 'ide' : 'chat') as Mode;
  });

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    // IDE 协同模式下不从 localStorage 恢复会话：此时以后端「活动会话」为唯一事实来源，
    // 避免本地缓存的旧会话覆盖 IDE 正在推送的会话。
    if (mode === 'chat') restoreFromLocal();
    loadSessions();
  }, [restoreFromLocal, loadSessions, mode]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-zinc-50 text-zinc-900">
      <SessionDrawer />
      <TopBar mmRef={mmRef} mode={mode} onModeChange={setMode} />
      <main className="flex-1 flex min-h-0">
        {/* Left panel - switches between Chat and IDE collab */}
        <div className="w-[420px] shrink-0 min-w-0 hidden md:flex">
          {mode === 'chat' ? <ChatPanel /> : <IdeCollabPanel />}
        </div>
        <div className="w-px shrink-0 bg-gradient-to-b from-transparent via-zinc-200 to-transparent hidden md:block" />
        {/* Map area */}
        <div className="flex-1 min-w-0 relative">
          <MarkmapView ref={mmRef} markdown={markmap} />
          <div className="md:hidden absolute top-3 left-3 text-xs text-zinc-400 bg-white/80 backdrop-blur px-2 py-1 rounded-lg border border-zinc-200">
            请在桌面端体验完整功能
          </div>
          {!markmap && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center animate-[floatUp_1.2s_ease-out] px-6">
                <div className="w-24 h-24 mx-auto mb-5 rounded-3xl bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100 flex items-center justify-center shadow-inner">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="5" cy="6" r="1.5" />
                    <circle cx="5" cy="18" r="1.5" />
                    <circle cx="19" cy="6" r="1.5" />
                    <circle cx="19" cy="18" r="1.5" />
                    <circle cx="12" cy="3" r="1.5" />
                    <path d="M12 10 L12 4.5" />
                    <path d="M12 14 L5 7.5" />
                    <path d="M12 14 L5 16.5" />
                    <path d="M12 14 L19 7.5" />
                    <path d="M12 14 L19 16.5" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-zinc-700 mb-1.5" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  {mode === 'ide' ? 'IDE 协同模式已就绪' : '你的思维导图将在这里生长'}
                </h3>
                <p className="text-sm text-zinc-400 max-w-xs mx-auto">
                  {mode === 'ide'
                    ? '在 Trae/Cursor/Claude Code 里对话，导图自动刷新，无需复制粘贴'
                    : '在左侧输入内容，AI 会自动整理成结构化的思维导图'}
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
