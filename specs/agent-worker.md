# Agent Worker Spec

> Status: draft
> Created: 2026-04-12

## 概述

Agent Worker 是运行在 sandbox 容器内的 Hono HTTP 服务(:8787)。通过 AI SDK (`streamText`) + Claude Code Provider (`ai-sdk-provider-claude-code`) 执行 AI 对话，流式返回结果。

## 连接模式

Model 由环境变量控制，不在代码中硬编码：
- `ANTHROPIC_MODEL`: Bedrock ARN 或标准 model ID
- `CLAUDE_CODE_USE_BEDROCK=1` + AWS 凭据: Bedrock 模式
- `ANTHROPIC_API_KEY`: Anthropic API 直连
- `ANTHROPIC_BASE_URL`: 自定义 endpoint

## API

### POST /prompt

**Given** 收到 `{ prompt: string, sessionId?: string }`
**When** prompt 非空
**Then** 返回 text stream response (AI SDK v6 格式)
  - Content-Type: text/plain; charset=utf-8
  - 流式文本输出，兼容 `useChat` 前端

**Given** prompt 为空或缺失
**When** 请求到达
**Then** 返回 400 `{ error: "prompt is required" }`

**Given** AI SDK 执行出错（API key 无效、网络超时等）
**When** streamText 抛出异常
**Then** 返回 500 `{ error: "错误信息" }`

### POST /abort

**Given** 有活跃会话 sessionId
**When** 收到 abort 请求
**Then** 中断 AbortController，返回 `{ aborted: true }`

**Given** sessionId 不存在
**When** 收到 abort 请求
**Then** 返回 404 `{ aborted: false, reason: "session not found" }`

### GET /health

**Given** 服务运行中
**When** 收到健康检查
**Then** 返回 `{ status: "ok", service: "agent-worker", activeRuns: N }`

## 测试要点

- [ ] prompt → 流式响应 (mock streamText)
- [ ] 空 prompt → 400
- [ ] SDK 错误 → 500
- [ ] abort → 会话中断
- [ ] health → activeRuns 计数
- [ ] model 从 env 读取，不硬编码
