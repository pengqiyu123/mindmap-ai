// 第八波 · 基础导图视觉与布局优化
// 主题预设 / 布局密度 / 展开层级 + 用户偏好持久化。
// 仅在 markmap 能力范围内做视觉调整，不改数据模型、不换渲染引擎。

export interface MindmapTheme {
  id: string;
  name: string;
  palette: string[]; // 节点/连接线颜色，按 depth 循环
  bgFrom: string; // 画布渐变起点
  bgTo: string; // 画布渐变终点
  nodeStyle?: {
    borderRadius?: number; // px
    borderWidth?: number; // px（用 box-shadow 描边，不占布局尺寸）
    borderColor?: string;
    fontFamily?: string;
    fontWeight?: number;
    bg?: string; // 节点底色
  };
  linkStyle?: {
    stroke?: string; // 连接线颜色（留空则沿用 palette）
    strokeWidth?: number;
  };
}

export const THEMES: MindmapTheme[] = [
  {
    id: 'classic',
    name: '经典商务',
    palette: ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4'],
    bgFrom: '#ffffff',
    bgTo: '#f5f3ff',
    nodeStyle: { borderRadius: 8, bg: 'rgba(99,102,241,0.06)' },
  },
  {
    id: 'cool-blue',
    name: '冷静蓝灰',
    palette: ['#3b82f6', '#64748b', '#0ea5e9', '#06b6d4', '#475569', '#0284c7'],
    bgFrom: '#f8fafc',
    bgTo: '#e0e7ef',
    nodeStyle: { borderRadius: 6, bg: 'rgba(59,130,246,0.06)' },
  },
  {
    id: 'fresh-green',
    name: '清新浅绿',
    palette: ['#10b981', '#22c55e', '#84cc16', '#14b8a6', '#65a30d', '#16a34a'],
    bgFrom: '#f0fdf4',
    bgTo: '#dcfce7',
    nodeStyle: { borderRadius: 10, bg: 'rgba(16,185,129,0.07)' },
  },
  {
    id: 'high-contrast',
    name: '高对比演示',
    palette: ['#1e293b', '#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#7c3aed'],
    bgFrom: '#ffffff',
    bgTo: '#ffffff',
    nodeStyle: { fontWeight: 600, borderWidth: 2, borderColor: '#1e293b', borderRadius: 4 },
  },
];

export function getTheme(id: string): MindmapTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export type Density = 'compact' | 'standard' | 'presentation';

export interface DensityPreset {
  spacingH: number;
  spacingV: number;
  maxWidth: number;
  duration: number;
}

export const DENSITY_PRESETS: Record<Density, DensityPreset> = {
  compact: { spacingH: 50, spacingV: 3, maxWidth: 240, duration: 300 },
  standard: { spacingH: 80, spacingV: 5, maxWidth: 300, duration: 500 },
  presentation: { spacingH: 120, spacingV: 10, maxWidth: 400, duration: 700 },
};

export const DENSITY_LABELS: Record<Density, string> = {
  compact: '紧凑',
  standard: '标准',
  presentation: '展示',
};

// -1 = 全展开，0 = 仅主题，1/2/3 = 展开到对应层级
export type ExpandLevel = -1 | 0 | 1 | 2 | 3;

export const EXPAND_OPTIONS: { value: ExpandLevel; label: string }[] = [
  { value: -1, label: '全部' },
  { value: 1, label: '1 级' },
  { value: 2, label: '2 级' },
  { value: 3, label: '3 级' },
];

export interface VisualPrefs {
  theme: string;
  density: Density;
  expandLevel: ExpandLevel;
}

export const DEFAULT_PREFS: VisualPrefs = {
  theme: 'classic',
  density: 'standard',
  expandLevel: -1,
};

export const PREF_KEY = 'mindflow:visualPrefs';

const VALID_DENSITY: Density[] = ['compact', 'standard', 'presentation'];
const VALID_EXPAND: ExpandLevel[] = [-1, 0, 1, 2, 3];

export function loadVisualPrefs(): VisualPrefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<VisualPrefs>;
    return {
      theme: THEMES.some((t) => t.id === parsed.theme) ? parsed.theme! : DEFAULT_PREFS.theme,
      density: VALID_DENSITY.includes(parsed.density as Density) ? (parsed.density as Density) : DEFAULT_PREFS.density,
      expandLevel: VALID_EXPAND.includes(parsed.expandLevel as ExpandLevel)
        ? (parsed.expandLevel as ExpandLevel)
        : DEFAULT_PREFS.expandLevel,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveVisualPrefs(prefs: VisualPrefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage 不可用时静默降级：本次运行内偏好仍在内存生效
  }
}
