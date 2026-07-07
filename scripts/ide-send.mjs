#!/usr/bin/env node
/**
 * ide:send CLI
 *
 * 用法：
 *   node scripts/ide-send.mjs "你想整理的内容"
 *   npm run ide:send -- "你想整理的内容"
 *   echo "内容" | npm run ide:send -- --stdin
 *   npm run ide:send -- --title "日本旅行规划" "东京、京都、大阪、预算1万"
 *   npm run ide:send -- --markdown "# 根\n## 分支\n- 要点"     # 直接提交已生成的 markdown
 *
 * IDE 里的 AI 只要能执行 shell，就能用它把内容推到导图服务。
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.MINDFLOW_URL || 'http://127.0.0.1:3001';

function parseArgs(argv) {
  const args = { _: [], title: null, markdown: null, stdin: false, sessionId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title' || a === '-t') args.title = argv[++i];
    else if (a === '--markdown' || a === '-m') args.markdown = argv[++i];
    else if (a === '--session' || a === '-s') args.sessionId = argv[++i];
    else if (a === '--stdin') args.stdin = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || '请求失败');
  return json;
}

async function getHealth() {
  try {
    const res = await fetch(`${BASE}/api/ide/health`);
    const json = await res.json();
    return json.success ? json.data : null;
  } catch {
    return null;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`MindFlow IDE Sender
用法:
  npm run ide:send -- "你的想法内容"
  npm run ide:send -- -t "标题" "内容"
  npm run ide:send -- -m "# 根\\n## 分支"     # 直接提交 markdown
  echo "内容" | npm run ide:send -- --stdin
环境: MINDFLOW_URL (默认 http://127.0.0.1:3001)`);
    return;
  }

  const health = await getHealth();
  if (!health) {
    console.error('❌ 无法连接到导图服务，请先在另一个终端运行 npm run dev');
    console.error('   默认地址：' + BASE);
    process.exit(1);
  }

  let message = args._.join(' ').trim();
  if (args.stdin) {
    const piped = await readStdin();
    message = (message + ' ' + piped).trim();
  }

  try {
    let json;
    if (args.markdown) {
      // 直接提交 markdown
      let md = args.markdown;
      try {
        md = readFileSync(md, 'utf8');
      } catch {
        // 不是文件，当作 markdown 内容
      }
      json = await post('/api/ide/push-markmap', {
        sessionId: args.sessionId,
        markdown: md,
        userMessage: message || undefined,
        reply: '（由 IDE AI 生成）',
      });
    } else {
      if (!message) {
        console.error('❌ 请提供内容，例如: npm run ide:send -- "我想整理 Python 学习笔记"');
        process.exit(1);
      }
      json = await post('/api/ide/push', {
        sessionId: args.sessionId,
        title: args.title,
        message,
      });
    }
    const data = json.data;
    console.log('✅ 导图已更新');
    console.log(`   会话: ${data.sessionId}`);
    console.log(`   标题: ${data.title}`);
    if (data.reply) console.log(`   AI 回复: ${data.reply.slice(0, 80)}${data.reply.length > 80 ? '...' : ''}`);
    console.log(`   浏览器打开 http://localhost:5173 查看实时导图`);
    // 覆盖软警告（非阻塞）：黄字提示，导图已更新，如需回退用「历史版本」
    if (json.warning) {
      console.warn(`\x1b[33m⚠️  ${json.warning}\x1b[0m`);
      console.warn('\x1b[33m   （已更新，如误覆盖可在网页顶栏「历史」里恢复）\x1b[0m');
    }
  } catch (err) {
    console.error('❌ 推送失败:', err.message);
    process.exit(1);
  }
}

main();
