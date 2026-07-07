import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import type { IMarkmapOptions, INode } from 'markmap-common';
import { Palette, Check } from 'lucide-react';
import { useStore } from '../store/useStore';
import {
  THEMES,
  DENSITY_PRESETS,
  DENSITY_LABELS,
  EXPAND_OPTIONS,
  getTheme,
  type MindmapTheme,
  type Density,
} from '../lib/themes';

declare global {
  interface Window {
    markmap?: unknown;
  }
}

const transformer = new Transformer();

export interface MarkmapHandle {
  exportSVG: () => string | null;
  exportRasterSVG: () => string | null;
  fit: () => void;
}

interface Props {
  markdown: string;
  onReady?: () => void;
}

function buildOptions(theme: MindmapTheme, density: Density, expandLevel: number): Partial<IMarkmapOptions> {
  const dp = DENSITY_PRESETS[density];
  return {
    duration: dp.duration,
    maxWidth: dp.maxWidth,
    spacingHorizontal: dp.spacingH,
    spacingVertical: dp.spacingV,
    initialExpandLevel: expandLevel,
    // 注意：depth 在 node.state.depth，不是 node.depth。
    // palette 按 depth 循环着色连接线/下划线/折叠圈（节点正文保持深色以保证可读性）。
    color: (node: INode) => {
      const d = node?.state?.depth ?? 0;
      return theme.palette[d % theme.palette.length];
    },
  };
}

// 把主题的 nodeStyle 解析成一组具体的 CSS 值，供 :root 变量与导出内嵌样式共用（单一来源）。
function resolveNodeStyle(theme: MindmapTheme) {
  const ns = theme.nodeStyle ?? {};
  return {
    radius: `${ns.borderRadius ?? 6}px`,
    bg: ns.bg ?? 'transparent',
    fontWeight: String(ns.fontWeight ?? 400),
    fontFamily: ns.fontFamily ?? "'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    shadow: ns.borderWidth
      ? `inset 0 0 0 ${ns.borderWidth}px ${ns.borderColor ?? 'rgba(0,0,0,0.12)'}`
      : 'none',
    // 中心节点强调：更明显的底色 + 描边
    centerBg: ns.bg ?? `${theme.palette[0]}1f`,
    centerShadow: `inset 0 0 0 ${(ns.borderWidth ?? 1) + 1}px ${ns.borderColor ?? theme.palette[0]}`,
  };
}

// 主题的节点/连接线外观通过 CSS 变量注入到 :root。
// markmap 的尺寸测量容器挂在 document.body 上，同样继承 :root 变量，
// 因此把值放在 :root 能保证「测量」与「渲染」一致，避免节点文字被裁剪。
function applyThemeVars(theme: MindmapTheme) {
  const v = resolveNodeStyle(theme);
  const s = document.documentElement.style;
  s.setProperty('--mm-node-radius', v.radius);
  s.setProperty('--mm-node-bg', v.bg);
  s.setProperty('--mm-node-font-weight', v.fontWeight);
  s.setProperty('--mm-node-font-family', v.fontFamily);
  s.setProperty('--mm-node-shadow', v.shadow);
  s.setProperty('--mm-center-bg', v.centerBg);
  s.setProperty('--mm-center-shadow', v.centerShadow);
  s.setProperty('--mm-link-opacity', '0.9');
}

const SVGNS = 'http://www.w3.org/2000/svg';

// PNG 光栅化专用：markmap 的节点标签是 <foreignObject>(HTML)，画到 canvas 会污染画布
// （Chromium 安全策略，toBlob/getImageData 报 tainted），因此把它们转成原生 <text>+<rect>。
// 连接线/下划线颜色已由 markmap 内联在元素上，克隆即保留。
function convertForeignObjectsToText(clone: SVGSVGElement, theme: MindmapTheme) {
  const st = theme.nodeStyle ?? {};
  const weight = String(st.fontWeight ?? 400);
  const family = st.fontFamily ?? "'Inter','PingFang SC','Microsoft YaHei',sans-serif";
  const hasBorder = !!st.borderWidth;
  const bg = st.bg && st.bg !== 'transparent' ? st.bg : null;
  clone.querySelectorAll('g.markmap-node').forEach((g) => {
    const fo = g.querySelector('foreignObject');
    if (!fo) return;
    const x = parseFloat(fo.getAttribute('x') || '0');
    const y = parseFloat(fo.getAttribute('y') || '0');
    const w = parseFloat(fo.getAttribute('width') || '0');
    const h = parseFloat(fo.getAttribute('height') || '0');
    const isCenter = g.getAttribute('data-depth') === '0';
    const label = (fo.textContent || '').replace(/\s+/g, ' ').trim();
    if (bg || hasBorder || isCenter) {
      const rect = document.createElementNS(SVGNS, 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('rx', String(st.borderRadius ?? 6));
      rect.setAttribute('fill', isCenter ? (bg ?? `${theme.palette[0]}22`) : (bg ?? 'none'));
      if (hasBorder) {
        rect.setAttribute('stroke', st.borderColor ?? 'rgba(0,0,0,0.12)');
        rect.setAttribute('stroke-width', String(isCenter ? (st.borderWidth ?? 1) + 1 : st.borderWidth));
      } else if (isCenter) {
        rect.setAttribute('stroke', theme.palette[0]);
        rect.setAttribute('stroke-width', '2');
      }
      g.insertBefore(rect, fo);
    }
    const text = document.createElementNS(SVGNS, 'text');
    text.setAttribute('x', String(x + 7));
    text.setAttribute('y', String(y + h / 2));
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('text-anchor', 'start');
    text.setAttribute('font-size', '15');
    text.setAttribute('font-weight', weight);
    text.setAttribute('font-family', family);
    text.setAttribute('fill', '#333');
    text.textContent = label;
    g.insertBefore(text, fo);
    fo.remove();
  });
}

// 生成导出用的 SVG 字符串。
// raster=false：矢量 SVG 下载，保留 foreignObject 完整保真 + 内嵌节点盒子样式。
// raster=true：PNG 光栅化，转 foreignObject 为原生 text/rect 以规避 canvas 污染。
function buildExportSvg(src: SVGSVGElement, theme: MindmapTheme, raster: boolean): string {
  const clone = src.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', SVGNS);
  // live svg 靠 CSS 撑满容器，本身无 width/height/viewBox；独立渲染会退回 300x150 默认尺寸。
  // 显式写入当前屏幕尺寸，使导出与所见一致（WYSIWYG），布局正确。
  const w = src.clientWidth || 1280;
  const h = src.clientHeight || 720;
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  if (raster) {
    convertForeignObjectsToText(clone, theme);
  } else {
    // 节点盒子样式来自外部 index.css 的 :root 变量规则，独立渲染时不生效，故内嵌进导出 SVG。
    const v = resolveNodeStyle(theme);
    const style = document.createElementNS(SVGNS, 'style');
    style.textContent =
      `.markmap-foreign>div{padding:1px 7px;border-radius:${v.radius};background:${v.bg};` +
      `box-shadow:${v.shadow};font-weight:${v.fontWeight};font-family:${v.fontFamily};}` +
      `.markmap-node[data-depth='0']>.markmap-foreign>div{background:${v.centerBg};box-shadow:${v.centerShadow};}`;
    clone.insertBefore(style, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
}

const MarkmapView = forwardRef<MarkmapHandle, Props>(function MarkmapView({ markdown, onReady }, ref) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mmRef = useRef<Markmap | null>(null);
  const [scale, setScale] = useState(1);
  const [styleOpen, setStyleOpen] = useState(false);
  const empty = !markdown || !markdown.trim();

  const visualPrefs = useStore((s) => s.visualPrefs);
  const setVisualPrefs = useStore((s) => s.setVisualPrefs);
  const theme = getTheme(visualPrefs.theme);
  const { density, expandLevel } = visualPrefs;

  // 创建一次 markmap 实例（用当前偏好初始化）
  useEffect(() => {
    if (!svgRef.current) return;
    if (mmRef.current) return;
    const prefs = useStore.getState().visualPrefs;
    const th = getTheme(prefs.theme);
    applyThemeVars(th);
    const mm = Markmap.create(svgRef.current, buildOptions(th, prefs.density, prefs.expandLevel));
    mmRef.current = mm;
    onReady?.();
  }, [onReady]);

  // 主题色/密度/展开层级 或 markdown 变化时：更新 options 后重渲染。
  // density/expandLevel 切换无需重建实例——markmap-view 支持 setData(root, opts)
  // 会先 setOptions 再 initializeData（重新应用 initialExpandLevel），故重新 transform 出干净的 root 即可。
  useEffect(() => {
    const mm = mmRef.current;
    if (!mm) return;
    applyThemeVars(theme);
    const opts = buildOptions(theme, density, expandLevel);
    if (empty) {
      const { root } = transformer.transform('');
      mm.setData(root, opts);
      return;
    }
    const { root } = transformer.transform(markdown);
    mm.setData(root, opts);
    mm.fit().then(() => setScale(1));
  }, [markdown, empty, theme, density, expandLevel]);

  useImperativeHandle(ref, () => ({
    exportSVG: () => (svgRef.current ? buildExportSvg(svgRef.current, theme, false) : null),
    exportRasterSVG: () => (svgRef.current ? buildExportSvg(svgRef.current, theme, true) : null),
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
    <div
      className="relative w-full h-full transition-[background] duration-300"
      style={{ background: `linear-gradient(to bottom right, ${theme.bgFrom}, ${theme.bgTo})` }}
    >
      <svg
        ref={svgRef}
        className={`w-full h-full transition-opacity duration-300 ${empty ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={{ minHeight: '100%' }}
      />

      {/* 样式弹窗（主题 / 密度 / 展开层级） */}
      {styleOpen && !empty && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setStyleOpen(false)} />
          <div className="absolute bottom-4 right-[4.25rem] z-20 w-[248px] bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-zinc-200/70 p-3.5 animate-[fadeUp_0.18s_ease-out]">
            {/* 主题 */}
            <div className="text-[11px] font-medium text-zinc-500 mb-1.5">主题</div>
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {THEMES.map((t) => {
                const active = t.id === visualPrefs.theme;
                return (
                  <button
                    key={t.id}
                    onClick={() => setVisualPrefs({ theme: t.id })}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs transition-colors ${
                      active ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-zinc-200 hover:bg-zinc-50 text-zinc-600'
                    }`}
                    title={t.name}
                  >
                    <span className="flex -space-x-1 shrink-0">
                      {t.palette.slice(0, 3).map((c, i) => (
                        <span key={i} className="w-3 h-3 rounded-full ring-1 ring-white" style={{ background: c }} />
                      ))}
                    </span>
                    <span className="truncate">{t.name}</span>
                    {active && <Check size={12} className="ml-auto shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* 密度 */}
            <div className="text-[11px] font-medium text-zinc-500 mb-1.5">布局密度</div>
            <div className="flex bg-zinc-100 rounded-lg p-0.5 mb-3">
              {(Object.keys(DENSITY_LABELS) as Density[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setVisualPrefs({ density: d })}
                  className={`flex-1 py-1 rounded-md text-xs transition-all ${
                    visualPrefs.density === d ? 'bg-white shadow-sm text-indigo-600 font-medium' : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {DENSITY_LABELS[d]}
                </button>
              ))}
            </div>

            {/* 展开层级 */}
            <div className="text-[11px] font-medium text-zinc-500 mb-1.5">展开层级</div>
            <div className="flex bg-zinc-100 rounded-lg p-0.5">
              {EXPAND_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setVisualPrefs({ expandLevel: o.value })}
                  className={`flex-1 py-1 rounded-md text-xs transition-all ${
                    visualPrefs.expandLevel === o.value ? 'bg-white shadow-sm text-indigo-600 font-medium' : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {!empty && (
      <div className="absolute bottom-4 right-4 flex flex-col gap-2 bg-white/80 backdrop-blur-md rounded-xl p-1.5 shadow-lg border border-zinc-200/60 z-10">
        <button
          onClick={() => setStyleOpen((v) => !v)}
          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
            styleOpen ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-indigo-100 text-zinc-700'
          }`}
          title="导图样式（主题 / 密度 / 展开层级）"
        >
          <Palette size={15} />
        </button>
        <div className="h-px bg-zinc-200/70 mx-0.5" />
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
