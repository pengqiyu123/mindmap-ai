import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Session, SessionSummary } from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 会话数据存放在仓库根目录的 data/ 下（在 nodemon 监听的 api/ 目录之外），
// 避免每次保存会话触发 dev server 重启、把内存里的「活动会话」清空。
const DATA_DIR = path.resolve(__dirname, '../../data/sessions');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ID_RE = /^[a-z0-9]+$/i;

function filePath(id: string) {
  if (!ID_RE.test(id)) {
    throw new Error('invalid session id');
  }
  const resolved = path.resolve(path.join(DATA_DIR, `${id}.json`));
  // 双保险：解析后路径必须仍在 DATA_DIR 内，防止路径遍历
  if (!resolved.startsWith(DATA_DIR + path.sep) && resolved !== DATA_DIR) {
    throw new Error('invalid session id');
  }
  return resolved;
}

export function generateId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

export function listSessions(): SessionSummary[] {
  ensureDir();
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  const sessions: SessionSummary[] = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, f), 'utf-8');
      const s: Session = JSON.parse(raw);
      sessions.push({
        id: s.id,
        title: s.title,
        messageCount: s.messages.length,
        updatedAt: s.updatedAt,
      });
    } catch {
      // ignore corrupted files
    }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(id: string): Session | null {
  ensureDir();
  const p = filePath(id);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const s = JSON.parse(raw) as Session;
    // 向后兼容：老 session 文件没有 markmapHistory 字段，补默认空数组
    if (!Array.isArray(s.markmapHistory)) s.markmapHistory = [];
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  ensureDir();
  const finalPath = filePath(s.id);
  const tmpPath = finalPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(s, null, 2), 'utf-8');
  fs.renameSync(tmpPath, finalPath);
}

export function deleteSession(id: string): boolean {
  const p = filePath(id);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

export function createSession(title = '新的思维导图'): Session {
  const now = Date.now();
  const s: Session = {
    id: generateId(),
    title,
    messages: [],
    markmap: '',
    markmapHistory: [],
    createdAt: now,
    updatedAt: now,
  };
  saveSession(s);
  return s;
}
