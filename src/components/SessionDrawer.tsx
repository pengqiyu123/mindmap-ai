import { useEffect } from 'react';
import { Plus, Trash2, MessageSquare, X, BrainCircuit } from 'lucide-react';
import { useStore } from '../store/useStore';

function formatTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function SessionDrawer() {
  const open = useStore((s) => s.drawerOpen);
  const toggleDrawer = useStore((s) => s.toggleDrawer);
  const sessions = useStore((s) => s.sessions);
  const currentId = useStore((s) => s.currentId);
  const loadSessions = useStore((s) => s.loadSessions);
  const newSession = useStore((s) => s.newSession);
  const selectSession = useStore((s) => s.selectSession);
  const deleteSession = useStore((s) => s.deleteSession);

  useEffect(() => {
    if (open) loadSessions();
  }, [open, loadSessions]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => toggleDrawer(false)}
        className={`fixed inset-0 bg-zinc-900/30 backdrop-blur-sm z-30 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      {/* Drawer */}
      <aside
        className={`fixed top-0 left-0 h-full w-72 bg-gradient-to-b from-zinc-900 to-zinc-950 text-zinc-100 z-40 shadow-2xl transform transition-transform duration-300 ease-out flex flex-col ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-14 flex items-center justify-between px-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <BrainCircuit size={18} className="text-indigo-400" />
            <span className="font-semibold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              我的思维导图
            </span>
          </div>
          <button
            onClick={() => toggleDrawer(false)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-zinc-400"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-3">
          <button
            onClick={() => {
              newSession();
              toggleDrawer(false);
            }}
            className="w-full flex items-center justify-center gap-2 h-10 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:scale-[1.02] transition-all"
          >
            <Plus size={16} />
            新建思维导图
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1 scrollbar-thin">
          {sessions.length === 0 && (
            <div className="px-4 py-8 text-center text-zinc-500 text-sm">
              还没有会话，开始输入创建第一张导图吧
            </div>
          )}
          {sessions.map((s) => {
            const active = s.id === currentId;
            return (
              <div
                key={s.id}
                className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                  active
                    ? 'bg-white/10 text-white'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                }`}
                onClick={() => selectSession(s.id)}
              >
                <MessageSquare size={15} className={active ? 'text-indigo-400' : 'text-zinc-500'} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{s.title || '未命名'}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    {s.messageCount} 条消息 · {formatTime(s.updatedAt)}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('删除这张思维导图？')) deleteSession(s.id);
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 hover:bg-rose-500/20 text-rose-400 transition-all"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="p-3 border-t border-white/10 text-[11px] text-zinc-500 text-center">
          数据保存在本地 · AI 实时整理
        </div>
      </aside>
    </>
  );
}
