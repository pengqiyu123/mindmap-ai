import { useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, History, RotateCcw, Loader2, Clock } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { MarkmapSnapshot } from '../lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SOURCE_LABEL: Record<NonNullable<MarkmapSnapshot['source']>, { text: string; cls: string }> = {
  chat: { text: '对话生成', cls: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  ide: { text: 'IDE 推送', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  regenerate: { text: '重新生成', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  restore: { text: '跳转前版本', cls: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30' },
};

// 取 markdown 第一行作为标题，去掉 # / - 前缀
function firstLine(md: string): string {
  const line = md.split('\n').map((l) => l.trim()).find((l) => l.length > 0) || '';
  return line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '') || '（空）';
}

export default function SnapshotList({ open, onClose }: Props) {
  const currentId = useStore((s) => s.currentId);
  const snapshots = useStore((s) => s.snapshots);
  const markmap = useStore((s) => s.markmap);
  const loadSnapshots = useStore((s) => s.loadSnapshots);
  const restoreSnapshot = useStore((s) => s.restoreSnapshot);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentId) return;
    setLoading(true);
    try {
      await loadSnapshots(currentId);
    } finally {
      setLoading(false);
    }
  }, [currentId, loadSnapshots]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleRestore = async (snapshotId: string) => {
    if (!confirm('确定恢复到此版本？当前导图会先存入历史，可再从历史切回。')) return;
    setBusyId(snapshotId);
    try {
      await restoreSnapshot(snapshotId);
    } finally {
      setBusyId(null);
    }
  };

  // 止血：历史列表只展示真实内容版本，过滤掉 restore 操作痕迹（旧数据不物理删除）
  const ordered = snapshots.filter((s) => s.source !== 'restore').reverse();

  return createPortal(
    <>
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed top-0 right-0 h-full w-[400px] max-w-[92vw] bg-zinc-900 text-zinc-100 z-50 shadow-2xl border-l border-zinc-700/60 flex flex-col transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-zinc-700/60">
          <div className="flex items-center gap-2">
            <History size={18} className="text-indigo-400" />
            <span className="font-semibold">历史版本</span>
            <span className="text-xs text-zinc-500">{ordered.length} 个快照</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          <div className="text-[11px] text-zinc-400 leading-relaxed bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-2.5 py-2 mb-1">
            <span className="text-zinc-200 font-medium">恢复只回滚导图，不回滚对话记录。</span>
            下次生成仍基于完整对话历史。每次导图被覆盖前会自动存一份快照。
          </div>

          {loading && (
            <div className="flex items-center justify-center py-10 text-zinc-500">
              <Loader2 size={18} className="animate-spin mr-2" /> 加载中…
            </div>
          )}

          {!loading && ordered.length === 0 && (
            <div className="text-sm text-zinc-500 text-center py-10">
              暂无历史快照。导图第一次被覆盖后，旧版本会出现在这里。
            </div>
          )}

          {!loading &&
            ordered.map((snap) => {
              const meta = snap.source ? SOURCE_LABEL[snap.source] : null;
              const preview = snap.markdown.replace(/\s+/g, ' ').slice(0, 100);
              const title = firstLine(snap.markdown);
              const isCurrent = snap.markdown === markmap;
              return (
                <div
                  key={snap.id}
                  className={`rounded-xl border px-3 py-2.5 transition-colors ${
                    isCurrent
                      ? 'border-indigo-500/60 bg-indigo-500/10'
                      : 'border-zinc-700/50 bg-zinc-800/40 hover:bg-zinc-800/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      {isCurrent && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500 text-white shrink-0 font-medium">
                          ● 当前
                        </span>
                      )}
                      {meta && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${meta.cls}`}>
                          {meta.text}
                        </span>
                      )}
                      <span className="text-[11px] text-zinc-400 flex items-center gap-1 truncate">
                        <Clock size={11} /> {new Date(snap.timestamp).toLocaleString()}
                      </span>
                    </div>
                    {isCurrent ? (
                      <span className="shrink-0 text-xs px-2.5 h-7 flex items-center text-indigo-300">当前版本</span>
                    ) : (
                      <button
                        onClick={() => handleRestore(snap.id)}
                        disabled={busyId === snap.id}
                        className="shrink-0 flex items-center gap-1 text-xs px-2.5 h-7 rounded-lg bg-zinc-700 hover:bg-indigo-500 text-zinc-100 transition-colors"
                      >
                        {busyId === snap.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                        恢复
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-200 font-medium truncate" title={title}>
                    {title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-500 line-clamp-2 leading-relaxed" title={preview}>
                    {preview || '（空）'}
                  </p>
                </div>
              );
            })}
        </div>
      </aside>
    </>,
    document.body,
  );
}
