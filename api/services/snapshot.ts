import type { Session, MarkmapSnapshot } from '../../shared/types.js';
import { generateId } from '../repositories/sessionRepo.js';

const MAX_HISTORY = 50;

/**
 * 在 markmap 被覆盖前，把当前 markmap 存入历史。
 * 空导图不入历史；上限 50 条，超出保留最近的。
 */
export function pushSnapshot(s: Session, source: MarkmapSnapshot['source']): void {
  if (!s.markmap) return;
  if (!s.markmapHistory) s.markmapHistory = [];
  s.markmapHistory.push({
    id: `snap_${generateId()}`,
    markdown: s.markmap,
    timestamp: Date.now(),
    source,
  });
  if (s.markmapHistory.length > MAX_HISTORY) {
    s.markmapHistory = s.markmapHistory.slice(-MAX_HISTORY);
  }
}

/**
 * 止血用：保证当前 markmap 作为真实内容版本进入 history（只进一次，不重复）。
 * 用于恢复/切换前，防止当前版丢失。
 * 用 s.markmapSource 记录的真实来源（chat/ide/regenerate），缺失时 fallback 'chat'——
 * 绝不标 'restore'，因为这是内容物化，不是操作痕迹（会被历史列表过滤）。
 */
export function materializeCurrentIfNeeded(s: Session): void {
  if (!s.markmap) return;
  if (!s.markmapHistory) s.markmapHistory = [];
  const exists = s.markmapHistory.some((h) => h.markdown === s.markmap);
  if (exists) return;
  s.markmapHistory.push({
    id: `snap_${generateId()}`,
    markdown: s.markmap,
    timestamp: Date.now(),
    source: s.markmapSource ?? 'chat',
  });
  if (s.markmapHistory.length > MAX_HISTORY) {
    s.markmapHistory = s.markmapHistory.slice(-MAX_HISTORY);
  }
}
