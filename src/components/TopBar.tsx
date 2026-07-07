import { useEffect, useRef, useState } from 'react';
import { Menu, Sparkles, Download, Upload, RotateCcw, Trash2, Pencil, Check, X, Terminal, MessageSquare, Settings, History, Copy } from 'lucide-react';
import { useStore } from '../store/useStore';
import SettingsPanel from './SettingsPanel';
import SnapshotList from './SnapshotList';
import type { MarkmapHandle } from './MarkmapView';
import { STANDARD_MARKDOWN_PROMPT } from '../../shared/markdownImport';

interface Props {
  mmRef: React.RefObject<MarkmapHandle | null>;
  mode: 'chat' | 'ide';
  onModeChange: (mode: 'chat' | 'ide') => void;
}

type ExportKind = 'png' | 'svg' | 'pdf' | 'html';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const safeFilename = (name: string, fallback = 'mindmap') => {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
  return cleaned || fallback;
};

const buildStandaloneHtml = (svg: string, mapTitle: string) => {
  const title = mapTitle.trim() || 'MindFlow 思维导图';
  const escapedTitle = escapeHtml(title);
  const exportedAt = escapeHtml(new Date().toLocaleString('zh-CN'));

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; object-src 'none'" />
  <title>${escapedTitle}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
      background: #eef2f7;
      color: #18181b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-width: max-content;
      background:
        radial-gradient(circle at top left, rgba(59, 130, 246, 0.16), transparent 32rem),
        linear-gradient(135deg, #eef2f7 0%, #f8fafc 55%, #e7edf5 100%);
    }
    .shell {
      min-height: 100vh;
      padding: 24px;
    }
    .meta {
      position: sticky;
      top: 16px;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 18px;
      padding: 10px 14px;
      border: 1px solid rgba(148, 163, 184, 0.36);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.86);
      box-shadow: 0 12px 34px rgba(15, 23, 42, 0.10);
      backdrop-filter: blur(14px);
      white-space: nowrap;
    }
    .meta strong {
      font-size: 14px;
      letter-spacing: 0.02em;
    }
    .meta span {
      font-size: 12px;
      color: #64748b;
    }
    .canvas {
      display: inline-block;
      overflow: hidden;
      border: 1px solid rgba(148, 163, 184, 0.32);
      border-radius: 28px;
      background: #ffffff;
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.16);
    }
    .canvas svg {
      display: block;
      width: auto;
      height: auto;
      max-width: none;
    }
    @media print {
      body { background: #ffffff; }
      .shell { padding: 0; }
      .meta { display: none; }
      .canvas {
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="meta">
      <strong>${escapedTitle}</strong>
      <span>MindFlow HTML 导出 · ${exportedAt}</span>
    </header>
    <section class="canvas" aria-label="${escapedTitle}">
${svg}
    </section>
  </main>
</body>
</html>`;
};

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
  const [copiedImportPrompt, setCopiedImportPrompt] = useState(false);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(title); }, [title]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const rasterizeSvg = (svgStr: string): Promise<HTMLCanvasElement> =>
    new Promise((resolve, reject) => {
      const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const rawWidth = img.naturalWidth || img.width || 1280;
        const rawHeight = img.naturalHeight || img.height || 720;
        // 导图可能非常大，限制总像素避免浏览器直接爆内存；常规导图仍按 2x 高清导出。
        const maxPixels = 48_000_000;
        const scale = Math.min(2, Math.sqrt(maxPixels / (rawWidth * rawHeight)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(rawWidth * scale));
        canvas.height = Math.max(1, Math.round(rawHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法创建导出画布'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('导出图像加载失败'));
      };
      img.src = url;
    });

  const handleExportSVG = () => {
    const svg = mmRef.current?.exportSVG();
    if (!svg) return;
    setExporting('svg');
    try {
      downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${safeFilename(title)}.svg`);
    } finally {
      setExporting(null);
    }
  };

  const handleExportPNG = async () => {
    const svgStr = mmRef.current?.exportRasterSVG();
    if (!svgStr || exporting) return;
    setExporting('png');
    try {
      const canvas = await rasterizeSvg(svgStr);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 文件生成失败'))), 'image/png');
      });
      downloadBlob(blob, `${safeFilename(title)}.png`);
    } catch (err) {
      alert(`PNG 导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
  };

  const handleExportPDF = async () => {
    const svgStr = mmRef.current?.exportRasterSVG();
    if (!svgStr || exporting) return;
    setExporting('pdf');
    try {
      const canvas = await rasterizeSvg(svgStr);
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({
        orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [canvas.width, canvas.height],
        compress: true,
      });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save(`${safeFilename(title)}.pdf`);
    } catch (err) {
      alert(`PDF 导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
  };

  const handleExportHTML = () => {
    const svg = mmRef.current?.exportSVG();
    if (!svg || exporting) return;
    setExporting('html');
    try {
      const html = buildStandaloneHtml(svg, title);
      downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${safeFilename(title)}.html`);
    } catch (err) {
      alert(`HTML 导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
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

  const copyImportPrompt = () => {
    navigator.clipboard.writeText(STANDARD_MARKDOWN_PROMPT)
      .then(() => {
        setCopiedImportPrompt(true);
        setTimeout(() => setCopiedImportPrompt(false), 1800);
      })
      .catch(() => {
        alert('复制失败，请打开项目根目录的「导入格式说明.md」查看标准提示词');
      });
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
        <div className="group relative">
          <button
            onClick={handleImportClick}
            disabled={isStreaming}
            title="导入 txt / md 文件。标准 md：# 主题 / ## 分支 / - 要点"
            className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm text-zinc-700 hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Upload size={15} />
            <span className="hidden sm:inline">导入</span>
          </button>
          <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-xl border border-zinc-200 py-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-30">
            <div className="px-3 py-2 text-[11px] leading-relaxed text-zinc-500 border-b border-zinc-100">
              标准 md：<span className="font-mono text-zinc-700">#</span> 主题 /
              <span className="font-mono text-zinc-700"> ##</span> 分支 /
              <span className="font-mono text-zinc-700"> -</span> 要点
            </div>
            <button onClick={handleImportClick} className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 text-zinc-700">
              选择 .txt / .md 文件
            </button>
            <button onClick={copyImportPrompt} className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-indigo-50 text-zinc-700">
              {copiedImportPrompt ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} className="text-zinc-400" />}
              {copiedImportPrompt ? '已复制提示词' : '复制 AI 标准提示词'}
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md"
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="group relative">
          <button disabled={!currentId || !!exporting}
            className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm text-zinc-700 hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Download size={15} />
            <span className="hidden sm:inline">{exporting ? '导出中' : '导出'}</span>
          </button>
          <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-zinc-200 py-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-30">
            <button disabled={!!exporting} onClick={handleExportPNG} className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 text-zinc-700 disabled:opacity-50">导出 PNG</button>
            <button disabled={!!exporting} onClick={handleExportSVG} className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 text-zinc-700 disabled:opacity-50">导出 SVG</button>
            <button disabled={!!exporting} onClick={handleExportPDF} className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 text-zinc-700 disabled:opacity-50">导出 PDF</button>
            <button disabled={!!exporting} onClick={handleExportHTML} className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 text-zinc-700 disabled:opacity-50">导出 HTML</button>
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
