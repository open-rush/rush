# Web UI Spec

> Status: draft
> Created: 2026-04-12

## 概述

Lux Web UI 是基于 Next.js 16 的 AI 对话工作台。使用 AI SDK v6 的 `useChat` hook (from `@ai-sdk/react`) + `TextStreamChatTransport` 实现流式对话。UI 组件为 Tailwind-only 轻量实现（无 Radix/shadcn 依赖）。

## 设计参考

`docs/design.md` — OKLCH 色彩系统、排版、组件规范、布局。

## 页面结构

### App Shell (认证后)
- Desktop Sidebar (256px): 品牌 + 项目入口 + `Work / Build / Observe` 导航 + 用户区 + 登出
- Mobile Shell: 顶部轻量用户栏 + 底部 5 项导航，保证小屏也能切页和登出
- Main Area: 首页 Hub、聊天工作台、Studio / Skills / MCP / Runs 页面

### 首页 Hub
- Hero 输入区：任务描述 + 发送按钮 + Agent 选择
- Suggestion Cards：预置任务模板，点击后直接进入聊天工作台
- 行为：提交后跳转到 `/chat/new?prompt=...&agent=...`

### 聊天工作台
- 左侧：Conversation + PromptInput + 停止按钮
- 右侧：`Preview / Code / Files` 三个标签页
- 行为：`/chat/new` 会消费 query 中的首条 prompt 并自动发起第一轮对话

## 行为契约

### 发送消息

**Given** 用户在 PromptInput 输入文字
**When** 点击发送或 Enter
**Then** 消息立即显示（乐观更新），开始流式接收回复

### 流式渲染

**Given** useChat 正在接收流
**When** 新文本到达
**Then** 实时追加到当前助手消息

### 停止生成

**Given** 流正在进行
**When** 用户点击停止按钮
**Then** 调用 stop()，流中断，已接收内容保留

### 认证保护

**Given** 未登录用户
**When** 访问对话页面
**Then** 重定向到 /login

### 本地开发免登录

**Given** `NODE_ENV=development` 且 `AUTH_SKIP_LOGIN=true`
**When** 访问受保护页面或 API
**Then** 中间件放行，并由 `auth()` 返回本地开发用户会话

## API

### POST /api/chat

**Given** 认证用户发送 `{ messages: Message[] }`
**When** 请求到达
**Then** streamText + claudeCode(env model) → toTextStreamResponse()

Model 配置: `process.env.CLAUDE_MODEL || 'sonnet'`

可选端点透传：
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_API_KEY`

## 组件清单

| 组件 | 类型 | 位置 |
|------|------|------|
| Button | UI | components/ui/button.tsx |
| Input | UI | components/ui/input.tsx |
| Card | UI | components/ui/card.tsx |
| Badge | UI | components/ui/badge.tsx |
| AppShell | Layout | components/layout/app-shell.tsx |
| Sidebar | Layout | components/layout/sidebar.tsx |
| ThemeProvider | Provider | components/theme-provider.tsx |
| Home Hub | Page | app/(app)/page.tsx |
| Chat Workspace | Page | app/(app)/chat/[id]/page.tsx |
| Agent Studio | Page | app/(app)/studio/page.tsx |
| Skills | Page | app/(app)/skills/page.tsx |
| MCP Servers | Page | app/(app)/mcps/page.tsx |
| Runs & Analytics | Page | app/(app)/runs/page.tsx |

## 测试要点

- [ ] 首页 Hub 可提交 prompt 并跳转到 `/chat/new`
- [ ] `/chat/new` 自动发送首条消息
- [ ] 消息渲染 (用户 + 助手)
- [ ] 空状态
- [ ] 未登录重定向
- [ ] 本地免登录开关
- [ ] /api/chat 仅认证用户可访问并返回流
- [ ] 移动端底部导航可切页
