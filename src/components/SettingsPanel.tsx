import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Zap, RefreshCw, Loader2, Cpu, KeyRound, Globe } from 'lucide-react';
import { api, type CCModelPublic, type ModelListResult } from '../lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

const PROTOCOL_LABEL: Record<CCModelPublic['protocol'], string> = {
  openai: 'OpenAI 协议',
  anthropic: 'Anthropic 协议',
};

const PROTOCOL_STYLE: Record<CCModelPublic['protocol'], string> = {
  openai: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  anthropic: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
};

const ERROR_KIND_TEXT: Record<string, string> = {
  auth_failed: '认证失败（401/403）— API Key 无效或过期',
  endpoint_not_found: '端点 404 — baseURL 或模型名错误',
  timeout: '请求超时 — 中转服务慢或不通',
  network: '网络错误 — 无法连接到中转',
  response_format: '返回格式不对 — 协议适配可能有误',
};

export default function SettingsPanel({ open, onClose }: Props) {
  const [state, setState] = useState<ModelListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; text: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listModels();
      setState(data);
    } catch (e) {
      setState({ dbPath: null, error: (e as Error).message, selectedId: null, usingRuntime: false, models: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleSelect = async (m: CCModelPublic) => {
    setBusyId(m.id);
    try {
      await api.selectModel(m.id);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleClear = async () => {
    setBusyId('__clear__');
    try {
      await api.clearModel();
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleTest = async (m: CCModelPublic) => {
    setBusyId(`test:${m.id}`);
    setTestResult((r) => ({ ...r, [m.id]: { ok: false, text: '测试中…' } }));
    try {
      const res = await api.testModel(m.id);
      if (res.ok && res.data) {
        setTestResult((r) => ({ ...r, [m.id]: { ok: true, text: `连通 ✓ ${res.data!.latencyMs}ms` } }));
      } else {
        const friendly = (res.errorKind && ERROR_KIND_TEXT[res.errorKind]) || (res.error || '失败').slice(0, 60);
        setTestResult((r) => ({ ...r, [m.id]: { ok: false, text: friendly } }));
      }
    } finally {
      setBusyId(null);
    }
  };

  const grouped = (proto: CCModelPublic['protocol']) =>
    (state?.models || []).filter((m) => m.protocol === proto);

  return createPortal(
    <>
      {/* overlay */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      {/* drawer */}
      <aside
        className={`fixed top-0 right-0 h-full w-[440px] max-w-[92vw] bg-zinc-900 text-zinc-100 z-50 shadow-2xl border-l border-zinc-700/60 flex flex-col transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-zinc-700/60">
          <div className="flex items-center gap-2">
            <Cpu size={18} className="text-indigo-400" />
            <span className="font-semibold">模型设置</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={load}
              disabled={loading}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400"
              title="刷新（重新读取 ccswitch）"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            </button>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          <p className="text-xs text-zinc-400 leading-relaxed">
            模型列表从本机 <span className="text-zinc-200 font-mono">CC Switch</span> 配置只读读取，
            不修改 ccswitch 任何数据。选中后本次服务运行期间的所有会话都将走该模型（进程全局，重启失效）。
          </p>

          {state?.error && (
            <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
              {state.error}
            </div>
          )}

          {/* 当前状态 */}
          <div className="flex items-center justify-between bg-zinc-800/60 rounded-xl px-3 py-2.5 border border-zinc-700/50">
            <div className="text-sm">
              <div className="text-zinc-300">
                当前：{state?.usingRuntime ? <span className="text-indigo-300">已选中 ccswitch 模型</span> : <span className="text-zinc-400">环境变量 / 本地引擎</span>}
              </div>
            </div>
            {state?.usingRuntime && (
              <button
                onClick={handleClear}
                disabled={busyId === '__clear__'}
                className="text-xs px-2.5 py-1 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
              >
                取消选中
              </button>
            )}
          </div>

          {(['anthropic', 'openai'] as const).map((proto) => {
            const list = grouped(proto);
            if (list.length === 0) return null;
            return (
              <section key={proto} className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wide">
                  <span className={`px-2 py-0.5 rounded-md border text-[11px] ${PROTOCOL_STYLE[proto]}`}>
                    {PROTOCOL_LABEL[proto]}
                  </span>
                  <span>{proto === 'anthropic' ? 'Claude Code 系' : 'Codex / OpenAI 系'}</span>
                  <span className="text-zinc-600">· {list.length}</span>
                </div>
                <div className="space-y-2">
                  {list.map((m) => {
                    const selected = state?.selectedId === m.id;
                    const test = testResult[m.id];
                    return (
                      <div
                        key={m.id}
                        className={`rounded-xl border px-3 py-2.5 transition-colors ${
                          selected ? 'border-indigo-500/70 bg-indigo-500/10' : 'border-zinc-700/50 bg-zinc-800/40 hover:bg-zinc-800/70'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-sm truncate">{m.providerName}</span>
                              {m.isCurrent && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  ccswitch 当前
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-zinc-400 truncate mt-0.5 flex items-center gap-1">
                              <Cpu size={11} /> {m.model}
                            </div>
                          </div>
                          <button
                            onClick={() => handleSelect(m)}
                            disabled={busyId === m.id}
                            className={`shrink-0 flex items-center gap-1 text-xs px-3 h-8 rounded-lg font-medium transition-colors ${
                              selected
                                ? 'bg-indigo-500 text-white'
                                : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-100'
                            }`}
                          >
                            {busyId === m.id ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : selected ? (
                              <Check size={13} />
                            ) : null}
                            {selected ? '已选中' : '使用'}
                          </button>
                        </div>
                        <div className="mt-1.5 text-[11px] text-zinc-500 space-y-0.5">
                          <div className="flex items-center gap-1 truncate"><Globe size={10} /> {m.baseURL}</div>
                          <div className="flex items-center gap-1"><KeyRound size={10} /> {m.keyMasked}</div>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            onClick={() => handleTest(m)}
                            disabled={busyId === `test:${m.id}`}
                            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-zinc-700/70 hover:bg-zinc-600 text-zinc-200"
                          >
                            {busyId === `test:${m.id}` ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                            测试连通
                          </button>
                          {test && (
                            <span className={`text-[11px] ${test.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{test.text}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {!loading && (state?.models.length ?? 0) === 0 && !state?.error && (
            <div className="text-sm text-zinc-400 text-center py-8">
              未读取到可用模型。请在 CC Switch 中配置 Claude Code 或 Codex 供应商。
            </div>
          )}
        </div>

        {state?.dbPath && (
          <footer className="shrink-0 px-4 py-2 border-t border-zinc-700/60 text-[11px] text-zinc-500 truncate">
            读取自：{state.dbPath}
          </footer>
        )}
      </aside>
    </>,
    document.body,
  );
}
