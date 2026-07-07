import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import type { IMarkmapOptions } from 'markmap-common';

declare global {
  interface Window {
    markmap?: unknown;
  }
}

const transformer = new Transformer();

export interface MarkmapHandle {
  exportSVG: () => string | null;
  fit: () => void;
}

interface Props {
  markdown: string;
  onReady?: () => void;
}

const MarkmapView = forwardRef<MarkmapHandle, Props>(function MarkmapView({ markdown, onReady }, ref) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mmRef = useRef<Markmap | null>(null);
  const [scale, setScale] = useState(1);
  const empty = !markdown || !markdown.trim();

  useEffect(() => {
    if (!svgRef.current) return;
    if (mmRef.current) return;
    const mm = Markmap.create(svgRef.current, {
      duration: 500,
      maxWidth: 300,
      initialExpandLevel: -1,
      color: (node: { depth?: number }) => {
        const palette = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444'];
        const d = node.depth ?? 0;
        return palette[d % palette.length];
      },
    } as Partial<IMarkmapOptions>);
    mmRef.current = mm;
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    const mm = mmRef.current;
    if (!mm) return;
    if (empty) {
      // 无内容时清空导图，由外层空状态占位，避免与占位图层重叠
      const { root } = transformer.transform('');
      mm.setData(root);
      return;
    }
    const { root } = transformer.transform(markdown);
    mm.setData(root);
    mm.fit().then(() => setScale(1));
  }, [markdown, empty]);

  useImperativeHandle(ref, () => ({
    exportSVG: () => {
      if (!svgRef.current) return null;
      const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      return new XMLSerializer().serializeToString(clone);
    },
    fit: () => {
      mmRef.current?.fit();
      setScale(1);
    },
  }));

  const zoomBy = (factor: number) => {
    const mm = mmRef.current;
    if (!mm) return;
    try {
      // Markmap rescale API
      (mm as unknown as { rescale: (s: number) => void }).rescale(scale * factor);
      setScale((s) => s * factor);
    } catch {
      // fallback: set data again to trigger refit
      setScale((s) => s * factor);
    }
  };

  return (
    <div className="relative w-full h-full bg-gradient-to-br from-white via-indigo-50/30 to-purple-50/30">
      <svg
        ref={svgRef}
        className={`w-full h-full transition-opacity duration-300 ${empty ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={{ minHeight: '100%' }}
      />
      {!empty && (
      <div className="absolute bottom-4 right-4 flex flex-col gap-2 bg-white/80 backdrop-blur-md rounded-xl p-1.5 shadow-lg border border-zinc-200/60 z-10">
        <button
          onClick={() => zoomBy(1.2)}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-indigo-100 text-zinc-700 transition-colors"
          title="放大"
        >
          <span className="text-lg font-semibold leading-none">+</span>
        </button>
        <button
          onClick={() => zoomBy(1 / 1.2)}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-indigo-100 text-zinc-700 transition-colors"
          title="缩小"
        >
          <span className="text-lg font-semibold leading-none">−</span>
        </button>
        <button
          onClick={() => {
            mmRef.current?.fit();
            setScale(1);
          }}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-indigo-100 text-zinc-700 transition-colors"
          title="重置"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M3 12a9 9 0 1 0 9-9"/></svg>
        </button>
      </div>
      )}
    </div>
  );
});

export default MarkmapView;
