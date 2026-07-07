# MindFlow AI · 实时思维导图生成器

> 你现在打开的是 MindFlow 项目。当用户提到"导图 / 思维导图 / mindmap"相关需求时，请优先使用下面的「IDE 协同模式」把内容推到浏览器里的实时导图，而不是只在聊天里回复文字。

---

## 项目简介

一个实时 AI 思维导图 Web 应用。浏览器里有一张会实时生长的导图，有两种驱动方式：

1. **对话模式**（默认）：用户在前端聊天框输入，后端启发式 NLP 或 LLM 生成导图。
2. **IDE 协同模式**（推荐）：用户在 Trae / Cursor / Claude Code / Codex / Zed 等 IDE 的 AI 对话框里直接说"帮我整理 XXX 的思维导图"，**你（IDE AI）执行本项目提供的 CLI/API 把内容推过去**，浏览器自动轮询刷新，导图立刻更新。全程无需复制粘贴、无需 API Key。

---

## 技术栈

- **前端**：React 18 + TypeScript + Vite + TailwindCSS 3 + Zustand + markmap-lib/markmap-view + lucide-react + react-markdown
- **后端**：Express 4 + TypeScript（ESM），提供 REST + SSE + 长轮询
- **存储**：本地 JSON 文件（`data/sessions/*.json`，位于仓库根）
- **包管理器**：npm（也兼容 pnpm）
- **端口**：前端 dev server 5173（Vite），后端 API 3001（Express），前端会代理 `/api` 到后端

---

## 常用命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 同时启动前端 (5173) 和后端 (3001) |
| `npm run client:dev` | 仅前端 |
| `npm run server:dev` | 仅后端（tsx + nodemon 热重载） |
| `npm run build` | 类型检查 + 前端构建到 `dist/` |
| `npm run check` | TypeScript 类型检查 |
| **`npm run ide:send -- "你的想法内容"`** | **IDE 协同模式：把一段内容推到导图**（详见下方） |
| `npm run ide:health` | 检查导图服务是否在运行 |

---

## 目录结构

```
mindmap-ai/
├── api/                       # 后端 Express
│   ├── routes/
│   │   ├── mindmap.ts         # 对话模式路由（/api/chat SSE 等）
│   │   └── ide.ts             # IDE 协同路由（/api/ide/*）
│   ├── services/
│   │   ├── heuristicEngine.ts # 中文 NLP 引擎（TextRank + 列举识别）
│   │   ├── llmClient.ts       # OpenAI 兼容 LLM 客户端（可选）
│   │   └── aiService.ts
│   ├── repositories/sessionRepo.ts
│   ├── state/activeSession.ts # 内存中"当前活动会话"
│   ├── app.ts
│   └── server.ts              # 本地入口（端口 3001）
├── scripts/
│   └── ide-send.mjs           # CLI：npm run ide:send
├── src/                       # 前端 React
│   ├── components/
│   │   ├── TopBar.tsx         # 含模式切换（对话 / IDE 协同）
│   │   ├── ChatPanel.tsx
│   │   ├── IdeCollabPanel.tsx # IDE 协同面板（长轮询状态 + CLI 说明）
│   │   ├── MarkmapView.tsx    # Markmap SVG 渲染封装
│   │   └── SessionDrawer.tsx
│   ├── pages/Home.tsx
│   ├── store/useStore.ts      # Zustand store
│   └── lib/{api.ts, idePrompt.ts}
├── shared/types.ts            # 前后端共享类型
└── AGENTS.md                  # 本文件
```

---

## 🤖 给 IDE AI（Trae / Cursor / Claude Code 等）的工作指南

**当用户在 IDE 聊天里要求生成/更新思维导图时，按以下流程操作：**

### 1. 检查服务是否在跑

先执行（或询问用户是否已启动）：

```bash
npm run ide:health
```

- 如果返回 JSON `{success: true, data: {status: "ok", ...}}` → 服务已运行，跳到第 3 步。
- 如果连接失败 → 第 2 步启动服务。

### 2. 启动开发服务器（如果没跑）

```bash
npm run dev
```

启动后前端地址 http://localhost:5173 ，告诉用户"已启动，请在浏览器打开 http://localhost:5173 并切换到「IDE 协同」模式"。后端在 3001 端口，继续第 3 步。

### 3. 把用户的想法推到导图（两条路径）

MindFlow 有**两条推送路径**，按你的能力选择：

- **路径 A · 默认兼容**：把原始文本交给后端 NLP 引擎生成导图。适合任何环境，无脑可用。
- **路径 B · 专家优先（推荐）**：对有模型能力的 IDE AI（Trae / Cursor / Claude Code / ZCode），**优先自己把内容整理成完整 Markmap markdown 再用 `push-markmap` 直提**，不依赖项目 LLM，效果最好、最可控。

---

#### 路径 B（推荐给你）：自己整理 markmap 后直提

你有大模型能力，直接把用户的想法整理成**完整**的 Markmap markdown，用 `push-markmap` 提交：

```bash
curl -s -X POST http://127.0.0.1:3001/api/ide/push-markmap \
  -H "Content-Type: application/json" \
  -d '{"markdown":"# Python\n## 基础语法\n- 变量与类型\n- 条件判断\n## 函数\n- 参数与返回","reply":"已整理为 2 个主要分支"}'
```

**续接已有导图（关键，别只提交增量）**：在已有导图上追加或修改时，`push-markmap` 是**整图替换**而非合并。若只提交新增部分，旧内容会被覆盖。正确流程：

1. `GET /api/ide/active` 读当前会话与 `markmap`
2. 你自己把新内容**合并**进当前 markmap，生成一份**完整**的新 markmap
3. `POST /api/ide/push-markmap` 提交完整新版

> 覆盖保护：如果提交的新导图行数明显少于当前（疑似只提交了增量），接口会返回 `warning` 字段、CLI 打印黄字提示（**不阻塞**，导图仍会更新）。若确实误覆盖，用户可在网页顶栏「历史」里一键恢复到旧版本。

**树形字符 → markmap 转换示例**（你自己转，不依赖后端）：

输入（用户给的树形/缩进结构）：

```
Python
├─ 基础语法
│  ├─ 变量与类型
│  └─ 条件判断
└─ 函数
   └─ 参数与返回
```

你转成 Markmap markdown 再提交：

```
# Python
## 基础语法
- 变量与类型
- 条件判断
## 函数
- 参数与返回
```

---

#### 路径 A（默认兼容）：交给后端 NLP 引擎

```bash
npm run ide:send -- "用户的想法内容（可以很长、可以含顿号逗号列举、可以多段）"
```

例如用户说"帮我整理 Python 学习笔记：基础语法、函数、类、装饰器、闭包"，执行：

```bash
npm run ide:send -- "Python 学习笔记：基础语法、函数、类、装饰器、闭包"
```

或直接 POST JSON（可指定标题、分多次追加，后端会基于活动会话增量合并）：

```bash
curl -s -X POST http://127.0.0.1:3001/api/ide/push \
  -H "Content-Type: application/json" \
  -d '{"title":"日本旅行","message":"东京塔、浅草寺、京都清水寺、大阪城，预算1万，5天行程"}'
```

> 🧹 **路径 A 的文本推送现在会自动清洗**：`ide:send` / `push` 传入的内容若含树形绘制字符（`├─ └─ │`）或中文/数字编号大纲（`一、`/`（一）`/`1.`），后端会先去掉脏字符再交给引擎，导图不会出现 `│├└─` 符号。纯自然语言原样通过，无需你手动清理。（路径 B 的 `push-markmap` 不清洗——那是你自己生成的干净 markmap。）

### 4. 告诉用户结果

推送成功后 CLI 会返回类似：

```
✅ 导图已更新
   会话: xxxxxx
   标题: Python 学习笔记
   AI 回复: 已收到内容，围绕「Python」整理出了 5 个分支...
   浏览器打开 http://localhost:5173 查看实时导图
```

**你可以简短告诉用户**："已推送到导图，浏览器 http://localhost:5173 会自动刷新看到。继续说其他内容我随时追加。"

### 5. 持续追加

- 用户继续在 IDE 里说新内容 → 再次 `npm run ide:send -- "新内容"` 即可。后端会基于已有导图增量合并，不会丢失之前的节点。
- 如果要换一张新图：`curl -X POST http://127.0.0.1:3001/api/ide/new` 然后再 send。
- 浏览器侧的"IDE 协同"面板会通过长轮询（25秒超时，自动重连）实时感知更新，导图自动重绘，**用户什么都不用做**。

### 关键接口速查

| Method | Path | 用途 |
|--------|------|------|
| GET  | `/api/ide/health` | 健康检查 + 使用说明 |
| POST | `/api/ide/push` | **推送一段文本**，自动识别主题/列举/生成 Markmap（body: `{message, title?, sessionId?}`） |
| POST | `/api/ide/push-markmap` | 直接提交 AI 自己生成好的 Markmap markdown（body: `{markdown, userMessage?, reply?}`） |
| POST | `/api/ide/new` | 新建一张空导图（body: `{title?}`） |
| POST | `/api/ide/active` | 设置当前活动会话 `{sessionId}` |
| GET  | `/api/ide/active` | 查看当前活动会话 |
| GET  | `/api/ide/events?since=ts&sessionId?` | 浏览器长轮询用，AI 一般不需要调 |

### 重要原则

1. **优先走路径 B（push-markmap）**：你有模型能力，自己整理好完整 markmap 直提，比让后端 NLP 兜底效果更好、更可控。路径 A（`ide:send` / `push`）是给无模型能力环境的兜底。
2. **不要让用户复制粘贴**：你（IDE AI）直接执行命令，用户只看浏览器即可。
3. **不要把导图内容用 markdown 代码块在聊天里贴一大坨**：推过去就行，用户看浏览器。
4. **续接导图先读后合并**：用 `push-markmap` 追加内容前，先 `GET /api/ide/active` 读当前 markmap，合并成完整新版再提交，别只提交增量（会覆盖旧图）。误覆盖了可让用户在顶栏「历史」里恢复。
5. **多次追加用同一会话**：默认接口会自动复用"活动会话"，不要每次都 new。
6. **服务没启动就先启动**：用 `npm run dev`，如果 3001 端口被占用提醒用户。
7. **如果用户想在前端对话框里输入**：让他切换回"对话模式"即可（顶栏切换按钮）。两种模式共用同一份会话数据。

---

## 代码规范

- 缩进：2 空格
- 引号：单引号（JS/TS），JSX 属性用双引号
- 分号：无（ASI）
- 组件：函数式 + TypeScript，`.tsx`，每个组件 < 300 行
- 图标：lucide-react
- 导图：封装在 MarkmapView 组件里
- 后端：ESM，导入路径带 `.js` 后缀
