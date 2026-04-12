# Web UI Spec

> Status: draft
> Created: 2026-04-12

## 概述

Rush Web UI 是基于 Next.js 16 的 AI 对话工作台。使用 AI SDK v6 的 `useChat` hook (from `@ai-sdk/react`) + `TextStreamChatTransport` 实现流式对话。UI 组件为 Tailwind-only 轻量实现（无 Radix/shadcn 依赖）。

## 设计参考

`docs/design.md` — OKLCH 色彩系统、排版、组件规范、布局。

## 页面结构

### App Shell (认证后)
- Sidebar (240px, collapsible): 品牌 + 新建按钮 + 对话列表 + 用户菜单
- Main Area: 对话界面

### 对话界面
- MessageList: 消息列表，自动滚动
- MessageBubble: 用户右对齐 / 助手左对齐
- PromptInput: 输入框 + 发送/停止按钮

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

### 暗色模式

**Given** 用户点击主题切换
**When** 切换到 dark
**Then** .dark 类加到 html，CSS 变量切换，localStorage 持久化

### 认证保护

**Given** 未登录用户
**When** 访问对话页面
**Then** 重定向到 /login

## API

### POST /api/chat

**Given** 认证用户发送 `{ messages: Message[] }`
**When** 请求到达
**Then** streamText + claudeCode(env model) → toTextStreamResponse()

Model 配置: `process.env.ANTHROPIC_MODEL || 'sonnet'`

## 组件清单

| 组件 | 类型 | 位置 |
|------|------|------|
| Button | UI | components/ui/button.tsx |
| Input | UI | components/ui/input.tsx |
| Card | UI | components/ui/card.tsx |
| Badge | UI | components/ui/badge.tsx |
| Avatar | UI | components/ui/avatar.tsx |
| ScrollArea | UI | components/ui/scroll-area.tsx |
| Separator | UI | components/ui/separator.tsx |
| AppShell | Layout | components/layout/app-shell.tsx |
| Sidebar | Layout | components/layout/sidebar.tsx |
| ThemeProvider | Provider | components/theme-provider.tsx |
| ChatView | Chat | components/chat/chat-view.tsx |
| MessageList | Chat | components/chat/message-list.tsx |
| MessageBubble | Chat | components/chat/message-bubble.tsx |
| PromptInput | Chat | components/chat/prompt-input.tsx |
| ToolCard | Chat | components/chat/tool-card.tsx |
| CodeBlock | Chat | components/chat/code-block.tsx |

## 测试要点

- [ ] 消息渲染 (用户 + 助手)
- [ ] 空状态
- [ ] 暗色模式切换
- [ ] 未登录重定向
- [ ] /api/chat 返回流
