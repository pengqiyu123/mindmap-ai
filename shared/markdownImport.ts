export interface MarkdownImportResult {
  markdown: string;
  title: string | null;
  nodeLikeLineCount: number;
}

export const MINDFLOW_MARKDOWN_FORMAT_SPEC = `格式要求（MindFlow 标准大纲）：
- 第一行用 # 作为根节点（主题，只 1 个）
- 用 ## 作为一级分支（3-7 个核心板块）
- 用 - 作为二级要点（每分支 3-8 条）
- 缩进的 - 作为三级细节（可选）
- 只用纯文本，不加粗/链接/图片/代码块`;

export const STANDARD_MARKDOWN_PROMPT = `请把以下内容整理成 Markdown 大纲格式的思维导图。

${MINDFLOW_MARKDOWN_FORMAT_SPEC}

直接输出 Markdown，不要加解释。

内容：
[在这里粘贴你的内容]`;

const MARKDOWN_EXT_RE = /\.(md|markdown)$/i;
const IMPORT_TITLE_EXT_RE = /\.(txt|md|markdown)$/i;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const LIST_RE = /^\s{0,12}(?:[-*+]|\d+[.)、）])\s+(.+?)\s*$/;

export function isMarkdownFilename(filename: string | undefined): boolean {
  return MARKDOWN_EXT_RE.test(filename || '');
}

export function titleFromFilename(filename: string | undefined): string | undefined {
  const title = (filename || '').replace(IMPORT_TITLE_EXT_RE, '').trim().slice(0, 30);
  return title || undefined;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
}

function stripMarkdownTitle(line: string): string {
  const match = line.trim().match(HEADING_RE);
  return (match?.[2] || line).replace(/\s+/g, ' ').trim();
}

/**
 * Detect already-structured Markdown outlines and return a safe Markmap input.
 *
 * This is intentionally conservative: plain prose in a .md file still goes to AI,
 * while heading/list outlines from Doubao/WPS/normal Markdown editors are direct.
 */
export function analyzeMarkdownOutline(
  content: string,
  titleFallback?: string,
): MarkdownImportResult | null {
  const normalized = normalizeLineEndings(content);
  if (!normalized) return null;

  const lines = normalized.split('\n');
  let headingCount = 0;
  let h1Title: string | null = null;
  let listCount = 0;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(HEADING_RE);
    if (heading) {
      headingCount += 1;
      if (!h1Title && heading[1] === '#') h1Title = stripMarkdownTitle(line);
      continue;
    }
    if (LIST_RE.test(line)) listCount += 1;
  }

  const hasH1 = !!h1Title;
  const hasNestedStructure = headingCount >= 2 || listCount >= 2;
  const listOnlyOutline = headingCount === 0 && listCount >= 4;
  if (!((hasH1 && hasNestedStructure) || headingCount >= 2 || listOnlyOutline)) {
    return null;
  }

  let markdown = normalized;
  const title = h1Title || titleFallback || null;
  if (!hasH1) {
    markdown = `# ${title || '导入的导图'}\n\n${markdown}`;
  }

  return {
    markdown,
    title,
    nodeLikeLineCount: headingCount + listCount,
  };
}
