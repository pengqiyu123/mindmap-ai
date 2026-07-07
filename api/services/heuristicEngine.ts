/**
 * 启发式中文 NLP 引擎
 *  - 分句
 *  - N-gram 抽词 + 停用词过滤 + 边界过滤
 *  - TextRank 关键词提取（含长度加权）
 *  - 共现挂句构建树
 *  - 输出 Markmap Markdown
 */

// 常见中文停用词 + 英文高频词
const STOPWORDS = new Set([
  '的', '了', '和', '是', '在', '我', '有', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '那', '他', '她', '它', '们', '这个', '那个', '什么', '怎么',
  '为', '以', '及', '或', '但', '而', '与', '之', '其', '对', '于', '中',
  '被', '把', '让', '给', '从', '向', '如', '还', '又', '再', '才', '能', '可以',
  '可能', '应该', '因为', '所以', '如果', '虽然', '但是', '然后', '接着', '接下来',
  '比如', '例如', '就是', '这样', '那样', '一些', '这些', '那些', '非常', '真的',
  '其实', '大概', '已经', '一下', '一点', '很多', '多少', '所有', '每', '各',
  '我们', '你们', '他们', '它们', '自己', '大家', '内容', '方面', '问题', '东西',
  '时候', '地方', '进行', '通过', '关于', '对于', '以及', '还是', '或者', '而且',
  '并', '并且', '并将', '并在', '也不', '也是', '还有', '还要', '还是',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have',
  'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
  'from', 'as', 'into', 'through', 'during', 'before', 'after', 'and', 'but',
  'or', 'nor', 'so', 'if', 'then', 'than', 'because', 'while', 'although',
]);

// 不能作为词首/词尾的字（虚词/标点）
const BAD_START = new Set(['的','了','和','是','在','有','就','不','也','很','到','说','要','去','会','着','没','我','你','他','她','它','这','那','都','上','下','里','中','把','被','让','给','从','向','与','及','或','但','而','为','以','如','还','又','再','才','能','吧','呢','啊','吗','哦','呀','么','个','些','等','之','其','对','于','也','太','最','更','只','请','让']);
const BAD_END = new Set(['的','了','和','是','在','有','就','不','也','很','到','说','要','去','会','着','没','我','你','他','她','它','这','那','都','上','下','里','中','把','被','让','给','从','向','与','及','或','但','而','为','以','如','还','又','再','才','能','吧','呢','啊','吗','哦','呀','么','个','些','等','之','其','对','于','也','太','最','更','只','在','是','也']);

// 句子切分
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  // 先按句号/问号/感叹号/换行分大句
  const big = normalized
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // 大句内再按列举类标点（顿号）切小片段
  const out: string[] = [];
  for (const s of big) {
    // 如果包含顿号"、"，按顿号切分（中文列举）
    if (s.includes('、') && s.length < 100) {
      const rawParts = s.split('、').map((x) => x.trim()).filter(Boolean);
      if (rawParts.length >= 3) {
        // 清理每段：去掉第一段的前缀引导语（直到动词/虚词结束），去掉末段的尾巴
        const parts = rawParts.map((p, idx) => {
          let cleaned = p;
          if (idx === 0) {
            // 去除"我想学习xxx，内容包括"/"xxx，包含"/"包括"等前导
            cleaned = cleaned.replace(/^[\u4e00-\u9fa5]{0,8}?(?:想学习|要学习|学习|了解|整理|规划|总结|包括|包含|有|如|例如|比如|是|为|：|:)/, '');
          }
          if (idx === rawParts.length - 1) {
            cleaned = cleaned.replace(/等[\u4e00-\u9fa5A-Za-z]{0,8}$/, '');
            // 去句末标点
            cleaned = cleaned.replace(/[。！？!?，,；;：:]+$/, '');
          }
          // 去尾部虚词
          while (cleaned.length > 2 && BAD_END.has(cleaned[cleaned.length - 1])) cleaned = cleaned.slice(0, -1);
          return cleaned.replace(/\s+/g, '').trim();
        }).filter((p) => p.length >= 2 && p.length <= 12 && !STOPWORDS.has(p));
        out.push(s); // 保留整句（主题引入）
        for (const p of parts) out.push(p);
        continue;
      }
    }
    out.push(s);
  }
  return out;
}

// N-gram 抽取 2-4字词（带边界过滤）
function extractNgrams(sentence: string): string[] {
  const cn = sentence.match(/[\u4e00-\u9fa5]+/g) || [];
  const en = sentence.match(/[a-zA-Z][a-zA-Z0-9_-]{1,}/g) || [];
  const grams: string[] = [];

  for (const seg of cn) {
    // 优先抽 3-4 字词，再补 2 字词
    for (const n of [4, 3, 2]) {
      for (let i = 0; i + n <= seg.length; i++) {
        const g = seg.slice(i, i + n);
        if (STOPWORDS.has(g)) continue;
        if (BAD_START.has(g[0])) continue;
        if (BAD_END.has(g[g.length - 1])) continue;
        // 避免全是虚词
        if (g.split('').every((c) => BAD_START.has(c) || BAD_END.has(c))) continue;
        grams.push(g);
      }
    }
  }
  for (const w of en) {
    if (w.length >= 2 && !STOPWORDS.has(w.toLowerCase())) {
      grams.push(w);
    }
  }
  return grams;
}

// 包含检查（处理英文大小写、中文子串）
function contains(sentence: string, gram: string): boolean {
  if (/^[a-zA-Z]/.test(gram)) {
    const re = new RegExp(`\\b${gram.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return re.test(sentence);
  }
  return sentence.includes(gram);
}

// TextRank（带长度权重）
function textRank(sentences: string[]): { word: string; score: number }[] {
  const wordSet = new Set<string>();
  const sentenceWords: string[][] = [];
  // 词频统计用于过滤仅出现一次的（除非是4字及以上有意义词）
  const freq = new Map<string, number>();
  for (const s of sentences) {
    const grams = extractNgrams(s);
    // 同句内去重，但优先保留长词
    const unique = Array.from(new Set(grams)).sort((a, b) => b.length - a.length);
    // 移除被长词完全包含的短词
    const filtered: string[] = [];
    for (const g of unique) {
      if (g.length === 2) {
        // 2字词只在不被3/4字词包含时保留
        if (filtered.some((p) => p.includes(g))) continue;
      }
      filtered.push(g);
      freq.set(g, (freq.get(g) || 0) + 1);
    }
    sentenceWords.push(filtered);
    filtered.forEach((w) => wordSet.add(w));
  }
  let words = Array.from(wordSet);
  // 过滤：2字词必须出现 ≥2 次或出现在多个句子中
  words = words.filter((w) => {
    if (w.length >= 3) return true;
    return (freq.get(w) || 0) >= 2;
  });
  if (words.length === 0) {
    // 退化为所有 grams
    words = Array.from(wordSet);
  }
  const idx = new Map<string, number>();
  words.forEach((w, i) => idx.set(w, i));
  const n = words.length;
  if (n === 0) return [];

  const graph: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const outWeight = new Array(n).fill(0);
  for (const ws of sentenceWords) {
    const present = ws.filter((w) => idx.has(w));
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const a = idx.get(present[i])!;
        const b = idx.get(present[j])!;
        graph[a][b] += 1;
        graph[b][a] += 1;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    outWeight[i] = graph[i].reduce((a, b) => a + b, 0);
  }
  let score = new Array(n).fill(1);
  const d = 0.85;
  for (let iter = 0; iter < 25; iter++) {
    const next = new Array(n).fill(1 - d);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j && graph[j][i] > 0 && outWeight[j] > 0) {
          next[i] += d * (graph[j][i] / outWeight[j]) * score[j];
        }
      }
    }
    score = next;
  }
  // 长度加权：3字词加 30%，4字词加 60%
  return words
    .map((w, i) => {
      let s = score[i];
      if (w.length === 3) s *= 1.3;
      else if (w.length >= 4) s *= 1.6;
      // 频次加成
      s *= 1 + Math.min((freq.get(w) || 1), 5) * 0.08;
      return { word: w, score: s };
    })
    .sort((a, b) => b.score - a.score);
}

export interface MindNode {
  label: string;
  children: MindNode[];
  sentences?: string[];
}

// 避免关键词互相包含（长词优先，保留得分更高的）
function dedupKeywords(keywords: { word: string; score: number }[], topK: number): string[] {
  const picked: { word: string; score: number }[] = [];
  for (const kw of keywords) {
    // 如果当前词被已选词包含或反之，保留得分更高/更长的
    const conflictIdx = picked.findIndex((p) => p.word.includes(kw.word) || kw.word.includes(p.word));
    if (conflictIdx >= 0) {
      const existing = picked[conflictIdx];
      // 新的词更长 或 得分显著更高则替换
      if (kw.word.length > existing.word.length || kw.score > existing.score * 1.2) {
        picked[conflictIdx] = kw;
      }
      continue;
    }
    picked.push(kw);
    if (picked.length >= topK) break;
  }
  return picked.map((p) => p.word);
}

// 从全部消息构建导图
export function buildMindMap(messages: { role: string; content: string }[]): { markdown: string; reply: string } {
  const userTexts = messages.filter((m) => m.role === 'user').map((m) => m.content);
  const rawSentences: string[] = [];
  for (const t of userTexts) rawSentences.push(...splitSentences(t));
  // 过滤过短句
  const sentences = rawSentences.filter((s) => s.replace(/\s/g, '').length >= 2);

  if (sentences.length === 0) {
    return { markdown: '# 等待你的输入\n\n- 开始输入，我会在这里整理思路...\n', reply: '我已准备好，请开始输入你想整理的内容。' };
  }

  // 主题提取：优先检测 "学习/了解/关于/整理/规划/总结/记录/分析 X" 这类模式
  const joined = userTexts.join(' ').replace(/\s+/g, '');
  const root = extractTopic(joined);

  // 从列举项中抽取叶子
  const listItems = extractListItems(userTexts.join('\n'));

  // 过滤掉主题相关句子用于分支提取
  const branchSentences = sentences.filter((s) => {
    // 如果句子主要是主题引入，不作为分支内容
    return !isIntroPhrase(s, root);
  });

  const ranked = textRank(branchSentences.length > 0 ? branchSentences : sentences);
  let topKeywords = dedupKeywords(ranked, 8);

  // 移除与 root 相同或被 root 完全包含的关键词
  topKeywords = topKeywords.filter((k) => !root.includes(k) && k !== root);
  // 移除低质量关键词（开头/结尾虚词，或明显无意义短语）
  const BAD_KW_PREFIX = /^(我想|我要|帮我|我们|内容|就是|还有|包括|这个|那个|一些|几个|核心|主要)/;
  const BAD_KW_SUFFIX = /(包括|就是|还有|内容|一个|一些|问题|方面)$/;
  topKeywords = topKeywords.filter((k) => {
    if (k.length < 2) return false;
    if (BAD_KW_PREFIX.test(k) || BAD_KW_SUFFIX.test(k)) return false;
    if (BAD_START.has(k[0]) || BAD_END.has(k[k.length - 1])) return false;
    return true;
  });

  // 如果有明确列举项，把它们作为一级分支（替代/补充 TextRank 结果）
  let branches: string[] = [];
  if (listItems.length >= 3) {
    branches = listItems.slice(0, 6);
    // 再补充 1-2 个 TextRank 关键词（不含在列举中）
    for (const kw of topKeywords) {
      if (branches.length >= 6) break;
      if (!branches.some((b) => b.includes(kw) || kw.includes(b))) {
        branches.push(kw);
      }
    }
  } else {
    branches = topKeywords.length > 0 ? topKeywords : ['要点'];
  }

  const tree: MindNode = {
    label: root,
    children: branches.map((b) => ({ label: b, children: [], sentences: [] })),
  };

  const unassigned: string[] = [];
  for (const s of sentences) {
    const clean = s.replace(/\s+/g, ' ').trim();
    const noPunct = clean.replace(/[，。！？、；;：:""'']/g, '');
    if (noPunct.length < 2) continue;
    // 过滤开头引导语/尾巴残余碎片（来自逗号切分）
    if (/^(我想|我要|帮我|我们|内容|包括|还有|另外|然后|还有就是)/.test(noPunct) && noPunct.length < 8) {
      continue;
    }
    if (isIntroPhrase(clean, root) && listItems.length === 0) {
      unassigned.push(clean);
      continue;
    }
    // 列举项本身已是分支标题，不重复挂
    if (listItems.some((item) => noPunct.includes(item) && item.length >= noPunct.length * 0.6)) continue;
    // 过滤掉仅仅是 "xxx包括" / "内容包括" 这类碎语
    if (/包括$|就是$|还有$|内容$/.test(noPunct) && noPunct.length < 6) continue;

    let bestIdx = -1;
    let bestHit = 0;
    for (let i = 0; i < tree.children.length; i++) {
      const kw = tree.children[i].label;
      if (contains(clean, kw)) {
        const hit = kw.length;
        if (hit > bestHit) {
          bestHit = hit;
          bestIdx = i;
        }
      }
    }
    if (bestIdx >= 0) {
      tree.children[bestIdx].sentences!.push(clean);
    } else {
      unassigned.push(clean);
    }
  }
  if (unassigned.length > 0) {
    const other = tree.children.find((c) => c.label === '其他') || null;
    const target = other || { label: '其他', children: [], sentences: [] };
    target.sentences!.push(...unassigned);
    if (!other && target.sentences!.length > 0) tree.children.push(target);
  }

  // 叶子去重 & 截断
  for (const b of tree.children) {
    const seen = new Set<string>();
    const leaves: string[] = [];
    const isItem = listItems.includes(b.label);
    for (const s of b.sentences || []) {
      // 列举项下不挂整句引入语（整句包含太多其他关键词）
      if (isItem && s.length > 18 && /我想|我要|帮我/.test(s)) continue;
      const t = truncate(s, 28);
      if (!seen.has(t) && t.length >= 2 && t !== b.label) {
        seen.add(t);
        leaves.push(t);
      }
    }
    if (isItem && leaves.length === 0) {
      leaves.push('（待补充细节）');
    }
    b.children = leaves.slice(0, 6).map((l) => ({ label: l, children: [] }));
    delete b.sentences;
  }
  tree.children = tree.children.filter((c) => c.children.length > 0 || c.label === '其他');

  let md = '';
  md += `# ${tree.label}\n\n`;
  for (const b of tree.children) {
    md += `## ${b.label}\n\n`;
    for (const leaf of b.children) {
      md += `- ${leaf.label}\n`;
    }
    md += '\n';
  }

  const reply = generateReply(root, tree.children.length, sentences.length);
  return { markdown: md, reply };
}

// 检测主题（学习/了解/整理/关于/规划/总结/... X）
function extractTopic(text: string): string {
  const patterns = [
    /(?:我想|我要|帮我|我们来|来|准备|打算|正在|开始)(?:学习|了解|整理|规划|总结|记录|分析|梳理|做|写|学|看|读|复习|回顾)([\u4e00-\u9fa5A-Za-z0-9+#]{1,14})/,
    /(?:关于|对于|针对|有关)([\u4e00-\u9fa5A-Za-z0-9+#]{1,14})/,
    /^([\u4e00-\u9fa5A-Za-z0-9+#]{2,12})(?:学习|笔记|计划|总结|整理|入门|教程|指南|知识)/,
    /(?:主题|标题|题目)[:：是为叫]\s*([\u4e00-\u9fa5A-Za-z0-9+#]{1,14})/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1] && !STOPWORDS.has(m[1]) && !BAD_START.has(m[1][0]) && !BAD_END.has(m[1][m[1].length - 1])) {
      // 清除尾部虚词
      let topic = m[1];
      while (topic.length > 2 && BAD_END.has(topic[topic.length - 1])) topic = topic.slice(0, -1);
      if (topic.length >= 2) return topic;
    }
  }
  // fallback: 取第一句的前 10 字
  const firstLine = text.split(/[。！？!?\n，,、]/)[0] || text;
  return truncate(firstLine.replace(/^(我想|我要|帮我|我们)/, ''), 10) || '思维导图';
}

// 判断是否为介绍性短语（非要点）
function isIntroPhrase(sentence: string, root: string): boolean {
  const clean = sentence.replace(/\s+/g, '');
  // 整句是 "我想学习xxx，包括..." 的引入，包含顿号逗号列举时不视为独立内容句
  if (clean.length < 15 && /我想|我要|帮我|我们来/.test(clean) && !/[。！？]/.test(sentence)) return true;
  if (/^我?想?学习/.test(clean) && clean.includes(root) && clean.length < 20) return true;
  if (/^关于/.test(clean) && clean.length < 10) return true;
  return false;
}

// 从 "A、B、C、D" 或 "A，B，C，D" 等格式提取列举项
function extractListItems(text: string): string[] {
  const items: string[] = [];
  // 按顿号/逗号分割的中文名词短语
  const lines = text.split(/[\n。！？!?]/);
  for (const line of lines) {
    if (!line.includes('、') && !line.includes('，')) continue;
    // 用顿号优先
    let parts: string[];
    if ((line.match(/、/g) || []).length >= 2) {
      parts = line.split(/、/);
    } else if ((line.match(/[，,]/g) || []).length >= 3) {
      parts = line.split(/[，,]/);
    } else {
      continue;
    }
    // 清理前缀（直到动词/虚词结束）
    const cleaned = parts.map((p) => {
      // 去掉前缀引导词（如"内容包括"/"包括"/"有"）以及尾巴残余
      let s = p.replace(/^(?:内容)?(?:包括|有|包含|如|例如|比如|是|为|：|:)/, '').replace(/\s+/g, '').trim();
      // 去尾部"等..."/"等核心概念"/"等"
      s = s.replace(/等[\u4e00-\u9fa5A-Za-z]{0,6}$/, '');
      // 去尾部虚词
      while (s.length > 2 && BAD_END.has(s[s.length - 1])) s = s.slice(0, -1);
      return s;
    }).filter((p) => p.length >= 2 && p.length <= 12 && !STOPWORDS.has(p) && !/^(内容|包括|核心|主要|一些|几个)/.test(p));
    if (cleaned.length >= 3) {
      for (const c of cleaned) {
        if (!items.some((i) => i === c || i.includes(c) || c.includes(i))) {
          items.push(c);
        }
      }
    }
  }
  // 数字编号列举：1. xxx / 1）xxx / - xxx
  const numbered = text.match(/(?:^|\n)\s*(?:\d+[.)、）]\s*|[-*•]\s+)([\u4e00-\u9fa5A-Za-z0-9+#]{2,14})/g);
  if (numbered) {
    for (const n of numbered) {
      const m = n.match(/[\u4e00-\u9fa5A-Za-z0-9+#]{2,14}/);
      if (m) {
        const item = m[0];
        if (!items.some((i) => i === item || i.includes(item))) items.push(item);
      }
    }
  }
  return items.slice(0, 8);
}

function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, ' ').replace(/^[\s，。！？!?,.、；;：:""'']+|[\s，。！？!?,.、；;：:""'']+$/g, '').trim();
  return clean.length > n ? clean.slice(0, n) + '…' : clean;
}

function generateReply(root: string, branchCount: number, sentenceCount: number): string {
  const responses = [
    `已收到内容，我围绕「${root}」整理出了 ${branchCount} 个主要分支，共 ${sentenceCount} 个要点。你可以继续补充，导图会实时生长。`,
    `我提取到了核心主题「${root}」，并把内容分成 ${branchCount} 个板块。继续输入更多细节，分支会越来越丰富。`,
    `导图已更新！主题「${root}」下有 ${branchCount} 个分支、${sentenceCount} 条要点。如果有新的角度随时补充～`,
    `好的，已把你的想法整理到「${root}」这张图里（${branchCount} 个分支）。继续说，我会把新内容挂到最合适的位置。`,
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

/**
 * 模拟流式输出（逐字符定时回调）
 */
export async function streamReply(
  reply: string,
  onReplyDelta: (delta: string) => void,
): Promise<void> {
  const chars = Array.from(reply);
  for (let i = 0; i < chars.length; i++) {
    onReplyDelta(chars[i]);
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 20));
  }
}
