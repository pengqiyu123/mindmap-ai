import { useEffect, useRef, useState } from 'react';
import { Menu, Sparkles, Download, Upload, RotateCcw, Trash2, Pencil, Check, X, Terminal, MessageSquare, Settings, History } from 'lucide-react';
import { useStore } from '../store/useStore';
import SettingsPanel from './SettingsPanel';
import SnapshotList from './SnapshotList';

interface Props {
  mmRef: React.RefObject<{ exportSVG: () => string | null } | null>;
  mode: 'chat' | 'ide';
  onModeChange: (mode: 'chat' | 'ide') => void;
}

export default function TopBar({ mmRef, mode, onModeChange }: Props) {
  const toggleDrawer = useStore((s) => s.toggleDrawer);
  const title = useStore((s) => s.title);
  const currentId = useStore((s) => s.currentId);
  const isStreaming = useStore((s) => s.isStreaming);
  const regenerate = useStore((s) => s.regenerate);
  const messages = useStore((s) => s.messages);
  const importFile = useStore((s) => s.importFile);
  const updateTitle = useStore((s) => s.updateTitle);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(title); }, [title]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const handleExportSVG = () => {
    const svg = mmRef.current?.exportSVG();
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'mindmap'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPNG = () => {
    const svgStr = mmRef.current?.exportSVG();
    if (!svgStr) return;
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = img.width * scale || 1920;
      canvas.height = img.height * scale || 1080;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u; a.download = `${title || 'mindmap'}.png`; a.click();
        URL.revokeObjectURL(u);
      });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const handleClear = () => {
    if (!confirm('确定要清空当前会话吗？（将新建一张导图）')) return;
    useStore.getState().newSession();
  };

  const handleExportMD = () => {
    if (!currentId) return;
    window.open(`/api/sessions/${currentId}/export?format=md`);
  };

  const handleExportText = () => {
    if (!currentId) return;
    window.open(`/api/sessions/${currentId}/export?format=text`);
  };

  const handleImportClick = () => {
    if (isStreaming) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许连续导入同一文件
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      if (!content.trim()) return;
      importFile(file.name, content);
    };
    reader.onerror = () => {
      alert('文件读取失败，请重试');
    };
    reader.readAsText(file);
  };

  return (
    <header className="h-14 shrink-0 flex items-center justify-between px-4 bg-white/70 backdrop-blur-xl border-b border-zinc-200/70 z-20 relative">
      <div className="flex items-center gap-3">
        <button
          onClick={() => toggleDrawer()}
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-zinc-100 transition-colors text-zinc-600"
          title="会话列表"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-md shadow-indigo-500/30">
            <Sparkles size={16} className="text-white" />
          </div>
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { updateTitle(draft.trim() || title); setEditing(false); }
                  else if (e.key === 'Escape') { setDraft(title); setEditing(false); }
                }}
                className="px-2 py-1 rounded-lg border border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-200 text-sm w-48"
              />
              <button onClick={() => { updateTitle(draft.trim() || title); setEditing(false); }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-indigo-100 text-indigo-600"><Check size={14} /></button>
              <button onClick={() => { setDraft(title); setEditing(false); }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500"><X size={14} /></button>
            </div>
          ) : (
            <button onClick={() => setEditing(true)} className="group flex items-center gap-1.5 text-zinc-800 font-semibold hover:text-indigo-600 transition-colors">
              <span className="text-base tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>MindFlow</span>
              <span className="text-zinc-400 mx-0.5">/</span>
              <span className="text-sm font-medium text-zinc-600 max-w-[200px] truncate">{title}</span>
              <Pencil size={12} className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400" />
            </button>
          )}
        </div>
      </div>

      {/* Mode switch */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center bg-zinc-100/80 rounded-xl p-1 border border-zinc-200/80">
        <button
          onClick={() => onModeChange('chat')}
          className={`flex items-center gap-1.5 px-3 h-8 rounded-lg text-sm font-medium transition-all ${
            mode === 'chat' ? 'bg-white shadow-sm text-indigo-600' : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          <MessageSquare size={14} />
          <span className="hidden sm:inline">对话模式</span>
        </button>
        <button
          onClick={() => onModeChange('ide')}
          className={`flex items-center gap-1.5 px-3 h-8 rounded-lg text-sm font-medium transition-all ${
            mode === 'ide' ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          <Terminal size={14} />
          <span className="hidden sm:inline">IDE 协同</span>
          <span className="flex h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse hidden sm:inline" />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm text-zinc-700 hover:bg-zinc-100 transition-colors"
          title="模型设置（来自 CC Switch）"
        >
          <Settings size={15} />
          <span className="hidden sm:inline">模型</span>
        </button>
        <button
          onClick={regenerate}
          disabled={mode === 'ide' || !currentId || isStreaming || messages.length === 0}
          title={mode === 'ide' ? 'IDE 协同模式下不可用（导图由 IDE 推送）' : '重新生成'}
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm text-zinc-700 hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RotateCcw size={15} />
          <span className="hidden sm:inline">重新生成</span>
        </button>
        <button
          onClick={() => setHistoryOpen(true)}
          disabled={!currentId}
          title="历史版本（改坏了可回退）"
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm text-zinc-700 hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <History size={15} />
          <span className="hidden sm:inline">历史</span>
        </button>
        <button
          onClick={handleImportClick}
          disabled={isStreaming}
          title="导入 txt / md 文件"
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm text-zinc-700 hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Upload size={15} />
          <span className="hidden sm:inline">导入</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md"
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="group relative">
          <button disabled={!currentId}
            className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm text-zinc-700 hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Download size={15} />
            <span className="hidden sm:inline">导出</span>
          </button>
          <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-xl shadow-xl border border-zinc-200 py-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-30">
            <button onClick={handleExportPNG} className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 text-zinc-700">导出 PNG</button>
            <button onClick={handleExportSVG} className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 text-zinc-700">导出 SVG</button>
            <button onClick={handleExportMD} className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 text-zinc-700">导出 Markdown</button>
            <button onClick={handleExportText} className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 text-zinc-700">导出纯文本</button>
          </div>
        </div>
        <button onClick={handleClear} disabled={isStreaming}
          className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40">
          <Trash2 size={15} />
          <span className="hidden sm:inline">清空</span>
        </button>
      </div>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <SnapshotList open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </header>
  );
}
