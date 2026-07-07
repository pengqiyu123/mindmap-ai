# MindFlow AI · 实时思维导图生成器

一个实时 AI 思维导图 **本地工具**。浏览器里有一张会实时生长的导图，有两种驱动方式：

1. **对话模式**（默认）：用户在前端聊天框输入，后端启发式 NLP 或 LLM 生成导图。
2. **IDE 协同模式**（推荐）：用户在 Trae / Cursor / Claude Code / Codex / Zed 等 IDE 的 AI 对话框里直接说「帮我整理 XXX 的思维导图」，**IDE AI 执行本项目提供的 CLI/API 把内容推过去**，浏览器自动轮询刷新，导图立刻更新。全程无需复制粘贴、无需 API Key。

   IDE 协同模式有**两条推送路径**：
   - **路径 A · 默认兼容**：把原始文本交给后端 NLP 引擎生成（`npm run ide:send` / `POST /api/ide/push`），任何环境可用。
   - **路径 B · 专家优先（推荐）**：有模型能力的 IDE AI 自己整理成完整 Markmap markdown 直提（`POST /api/ide/push-markmap`），不依赖项目 LLM，效果更好、更可控。续接时先 `GET /api/ide/active` 读当前导图再合并成完整新版提交。

> 📌 **给 IDE AI 的工作指南**见 [`AGENTS.md`](./AGENTS.md)（IDE 协同模式的接口、命令、流程）。

---

## 技术栈

- **前端**：React 18 + TypeScript + Vite + TailwindCSS 3 + Zustand + markmap-lib / markmap-view + lucide-react + react-markdown
- **后端**：Express 4 + TypeScript（ESM），提供 REST + SSE + 长轮询
- **存储**：本地 JSON 文件（`data/sessions/*.json`，位于仓库根，自动创建）
- **LLM**（可选）：OpenAI 兼容 / Anthropic Messages 双协议；可从本机 [CC Switch](https://github.com/farion1231/cc-switch) 配置只读读取
- **包管理器**：npm
- **端口**：前端 dev server `5173`（Vite），后端 API `3001`（Express），前端代理 `/api` 到后端

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2.（可选）配置 LLM —— 不配置则用本地启发式引擎
cp .env.example .env
# 编辑 .env 填入 OPENAI_API_KEY 或 ANTHROPIC_API_KEY

# 3. 同时启动前端 + 后端
npm run dev
```

启动后浏览器打开 http://localhost:5173 ：

- **对话模式**：直接在左侧输入框输入想法，导图实时生长。
- **IDE 协同**：点顶栏切换到「IDE 协同」模式，然后在你的 IDE 里执行（无需在网页输入）：
  ```bash
  npm run ide:send -- "Python 学习笔记：基础语法、函数、类、装饰器、闭包"
  ```
  浏览器会自动刷新看到导图。
- **导入 / 导出**：顶栏「导入」可选 `.txt` / `.md` 文件，内容会作为一条消息送入生成链路（自动清洗结构化字符）；「导出」下拉支持 PNG / SVG / Markdown / 纯文本。

---

## 常用命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 同时启动前端 (5173) 和后端 (3001) |
| `npm run client:dev` | 仅前端 |
| `npm run server:dev` | 仅后端（tsx + nodemon 热重载） |
| `npm run build` | 类型检查 + 前端构建到 `dist/` |
| `npm run check` | TypeScript 类型检查 |
| `npm run lint` | ESLint |
| `npm run preview` | 预览构建产物 |
| **`npm run ide:send -- "你的想法内容"`** | **IDE 协同模式：把一段内容推到导图** |
| `npm run ide:health` | 检查导图服务是否在运行 |

`ide:send` 更多用法（标题、stdin、直接提交 markdown、指定会话）见 `npm run ide:send -- --help`。

---

## 文件导入与标准格式

MindFlow 支持导入 `.txt` 和 `.md` 文件生成思维导图。点顶栏「导入」按钮选择文件即可。

### 标准格式：Markdown 大纲

导入效果取决于文件格式。**结构化的 Markdown 大纲会直接生成导图**（不走 AI，结构原样保留）：

```markdown
# 根节点（主题，只 1 个）

## 一级分支（核心板块，3-7 个）

- 二级要点（具体内容）
- 二级要点
  - 三级细节（可选，缩进 2 空格）
```

| 层级 | Markdown | 用途 | 数量建议 |
|---|---|---|---|
| 根节点 | `#` | 主题 | 1 个 |
| 一级分支 | `##` | 核心板块 | 3-7 个 |
| 二级要点 | `-` | 具体内容 | 每分支 3-8 条 |
| 三级细节 | `  -`（缩进） | 补充 | 可选 |

**纯文本/文章型 `.md` 或 `.txt`** 会交给 AI 整理成导图（需要配置 LLM 或走本地引擎）。

### 用 AI 生成标准格式

无论你用豆包、ChatGPT、Claude 还是 Gemini，用以下提示词即可生成 MindFlow 兼容的格式：

```
请把以下内容整理成 Markdown 大纲格式的思维导图。

格式要求：
1. 第一行用 # 作为根节点（主题）
2. 用 ## 作为一级分支（3-7 个核心板块）
3. 用 - 作为二级要点（每个板块 3-8 条）
4. 缩进的 - 作为三级细节（可选）
5. 只用纯文本，不加粗/链接/图片/代码块
6. 直接输出 Markdown，不要加解释

内容：
[在这里粘贴你的内容]
```

详细的格式说明、各 AI 适配、常见问题见 [`导入格式说明.md`](./导入格式说明.md)。

---

## 配置 LLM（可选）

不配置任何 LLM 时，后端使用**本地启发式引擎**（TextRank 关键词抽取 + 列举识别，纯中文优化）生成导图，零依赖、即时响应。

要启用真实 LLM 获得更好效果，有**两种方式**：

### 方式 A：环境变量（`.env`）

```bash
# OpenAI 兼容（任选其一协议）
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1   # 可选，默认即此
OPENAI_MODEL=gpt-4o-mini                     # 可选

# 或 Anthropic Messages
ANTHROPIC_API_KEY=sk-ant-xxx                 # 或 ANTHROPIC_AUTH_TOKEN
ANTHROPIC_BASE_URL=https://api.anthropic.com # 可选
ANTHROPIC_MODEL=claude-3-5-sonnet-latest     # 可选
```

### 方式 B：CC Switch 配置（推荐，图形化）

如果你本机装了 [CC Switch](https://github.com/farion1231/cc-switch) 并配置了 Claude Code / Codex 供应商：

1. 启动服务 `npm run dev`
2. 浏览器点顶栏「模型」按钮
3. 设置面板会**只读读取** CC Switch 的所有模型配置（不修改 ccswitch 任何数据）
4. 选择一个模型并「测试连通」→ 即生效

优先级：**CC Switch 运行时选中 > 环境变量 > 本地启发式引擎**。

---

## 目录结构

```
mindmap-ai/
├── api/                       # 后端 Express
│   ├── routes/
│   │   ├── mindmap.ts         # 对话模式路由（/api/chat SSE、/api/sessions/* 等）
│   │   ├── ide.ts             # IDE 协同路由（/api/ide/*）
│   │   └── models.ts          # 模型设置路由（/api/models/*，读 ccswitch）
│   ├── services/
│   │   ├── heuristicEngine.ts # 本地启发式 NLP 引擎（TextRank + 列举识别）
│   │   ├── llmClient.ts       # OpenAI / Anthropic LLM 客户端
│   │   ├── aiService.ts       # 对话流式响应编排
│   │   └── ccswitchReader.ts  # 从 CC Switch 的 SQLite db 只读读取模型
│   ├── repositories/sessionRepo.ts   # 会话 JSON 文件读写
│   ├── state/activeSession.ts        # 内存中「当前活动会话」
│   ├── app.ts                 # Express 应用（中间件 + 路由挂载）
│   └── server.ts              # 本地入口（端口 3001）
├── data/sessions/             # 会话 JSON 数据（运行时自动创建，已 gitignore）
├── scripts/
│   └── ide-send.mjs           # CLI：npm run ide:send
├── src/                       # 前端 React
│   ├── components/
│   │   ├── TopBar.tsx         # 顶栏（模式切换 / 重新生成 / 导出 / 模型设置）
│   │   ├── ChatPanel.tsx      # 对话模式面板
│   │   ├── IdeCollabPanel.tsx # IDE 协同面板（长轮询状态 + 实时活动 feed）
│   │   ├── MarkmapView.tsx    # Markmap SVG 渲染封装
│   │   ├── SessionDrawer.tsx  # 会话列表抽屉
│   │   └── SettingsPanel.tsx  # 模型设置面板
│   ├── pages/Home.tsx         # 主页（模式切换 + 布局）
│   ├── store/useStore.ts      # Zustand store
│   └── lib/{api.ts}
├── shared/types.ts            # 前后端共享类型
└── AGENTS.md                  # 给 IDE AI 的工作指南
```

---

## 数据与隐私

- 所有会话以 JSON 文件存于 `data/sessions/`，**仅本机**，不上传任何服务器。
- `data/` 已加入 `.gitignore`，不会被提交。
- LLM 调用（若启用）会把对话历史发给对应服务商（OpenAI / Anthropic / 你配置的中转），请注意敏感内容。

---

## 已知限制

- **本地工具定位**：设计为单机单用户使用，未做多实例 / 多用户 / 云部署适配（活动会话、模型选中态均为进程内存）。
- **移动端**：当前为桌面端体验优化，小屏只提示「请在桌面端体验完整功能」。
- **重新生成**：复用对话流的 AI 服务（有 LLM 走 LLM，无则降级本地引擎），与对话模式产出风格一致。
- **历史版本恢复**：只回滚导图内容，不回滚对话记录。下次生成会继续基于完整对话历史。
- **结构化输入清洗**：粘贴或导入含树形绘制字符（`├─ └─ │`）或中文/数字编号（`一、`/`（一）`/`1.`）的大纲时，会先自动清洗掉脏字符再交给 AI / 本地引擎理解，导图不会出现 `│├└─` 等符号。清洗只去脏字符、不做结构直出解析（纯自然语言原样通过）。

---

## 许可

私有项目。
