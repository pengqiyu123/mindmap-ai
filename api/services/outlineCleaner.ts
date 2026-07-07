/**
 * 结构化输入清洗（第七波 B · 任务 1）
 *
 * 只清洗、不解析：把树形绘制字符 / 中文编号大纲里的「脏字符」去掉，
 * 保留层级缩进和正文，输出一段干净文本，仍交给 AI / 本地引擎去理解结构。
 * 不在这里转 markmap（那是被废弃的 A 包「结构化直出」，7B 不做）。
 */

export type StructuredKind = 'tree-chars' | 'cn-numbered' | null;

// 制表 / 树形绘制字符（U+2500–U+257F），自然语言里不会出现，可放心识别与剔除
const BOX_DRAWING = /[\u2500-\u257F]/;
const BOX_DRAWING_G = /[\u2500-\u257F]/g;

// 中文编号大纲的三种形态
const CN_NUM_PATTERNS = [
  /^[一二三四五六七八九十百零]+、/, // 一、二、
  /^[（(][一二三四五六七八九十百零]+[)）、]/, // （一） (一)
  /^\d+[.、)]\s/, // 1.  2、  3)
];

/**
 * 识别输入是否为结构化大纲。
 * - tree-chars：含任一树形绘制字符（≥1 行即可——box-drawing 字符不会误伤自然语言，
 *   且单行 `├─ 一、测试` 也需命中）
 * - cn-numbered：≥2 行匹配中文/数字编号
 * - 纯自然语言：返回 null，走原路径（误伤防护）
 */
export function detectStructured(text: string): StructuredKind {
  if (!text) return null;
  if (BOX_DRAWING.test(text)) return 'tree-chars';

  const lines = text.split('\n');
  let numbered = 0;
  for (const raw of lines) {
    const line = raw.trimStart();
    if (CN_NUM_PATTERNS.some((re) => re.test(line))) numbered += 1;
  }
  if (numbered >= 2) return 'cn-numbered';

  return null;
}

/**
 * 清洗结构化输入为干净文本（不转 markmap）。
 * - tree-chars：剔除绘制字符，保留缩进空格与正文（缩进反映层级深度）
 * - cn-numbered：保留编号（一、/（一）/1.）作为层级提示，不动正文
 * - null：原样返回（trim 两端）
 */
export function cleanStructured(text: string, kind: StructuredKind): string {
  if (!text) return text;
  if (kind === 'tree-chars') {
    return text
      .split('\n')
      // 绘制字符替换为空格以保留水平缩进，随后去掉行尾多余空白
      .map((line) => line.replace(BOX_DRAWING_G, ' ').replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '');
  }
  // cn-numbered：编号即层级提示，只做行尾清理，不动编号与正文
  if (kind === 'cn-numbered') {
    return text
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '');
  }
  return text.trim();
}
