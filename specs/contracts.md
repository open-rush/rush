# Contracts Specification

packages/contracts 定义 Lux 平台所有核心数据类型的 Zod schema。零运行时依赖（仅 Zod）。

## 设计原则

- Zod schema 是 single source of truth，TypeScript 类型从 Zod 推导
- 每个 schema 文件对应一个领域概念
- 枚举值、状态机转换规则、验证逻辑全部在 contracts 中定义
- DB schema (packages/db) 的列类型必须与 contracts 保持一致

## 文件结构

```
packages/contracts/src/
  enums.ts              — 所有枚举值
  run.ts                — Run, RunSpec, RunStatus 状态机
  agent.ts              — Agent
  project.ts            — Project, ProjectMember
  events.ts             — UIMessageChunk (16 types), RunEvent
  artifact.ts           — Artifact, ArtifactKind
  sandbox.ts            — SandboxInfo, SandboxStatus
  vault.ts              — VaultEntry, VaultScope
  checkpoint.ts         — RunCheckpoint
  api.ts                — ApiResponse, CreateRunRequest/Response
  index.ts              — barrel export
```

## 枚举定义

### RunStatus（15 状态状态机）

```
queued → provisioning → preparing → running
  → finalizing_prepare → finalizing_uploading → finalizing_verifying
  → finalizing_metadata_commit → finalized → completed

异常路径:
  任意 → failed（大部分状态可直接失败）
  failed → queued（重试）
  running → worker_unreachable → failed | running（恢复或失败）
  finalizing_* → finalizing_retryable_failed → finalizing_uploading | finalizing_timeout
  finalizing_timeout → finalizing_manual_intervention → failed
```

### AgentStatus
`active | closed`

### TriggerSource
`user | webhook | api`

### Provider
`claude-code`（当前唯一，预留扩展）

### ConnectionMode
`anthropic | bedrock | custom`

### ArtifactKind
`diff | patch | log | screenshot | build | report`

### SandboxStatus
`creating | running | idle | destroying | destroyed | error`

### VaultScope
`platform | project`

### CheckpointStatus
`in_progress | completed | failed`

### ProjectMemberRole
`owner | admin | member`

## UIMessageChunk 事件类型（16 种）

浏览器端 SSE 流式事件：

```
text-start, text-delta, text-end
reasoning-start, reasoning-delta, reasoning-end
tool-input-start, tool-input-delta, tool-input-available
tool-output-available, tool-output-error
start, finish, error
start-step, finish-step
```

## 状态机转换规则

VALID_RUN_TRANSITIONS 是一个 Record<RunStatus, RunStatus[]>，定义了每个状态可以转换到哪些状态。
任何不在转换表中的状态变更应被拒绝。

## 验证规则

- Run.prompt: 非空字符串
- Run.retryCount: 非负整数，<= maxRetries
- Run.maxRetries: 正整数，默认 3
- Agent.customTitle: 最长 200 字符
- Project.name: 非空，最长 255 字符
- Artifact.size: 非负整数
- Artifact.checksum: 非空字符串
- VaultEntry: scope='platform' 时 projectId 必须为 null，scope='project' 时 projectId 必须非 null

## 测试要求

每个 schema 需要测试：
1. 正常路径：合法数据能通过验证
2. 默认值：省略可选字段后默认值正确
3. 边界值：空字符串、最大长度、零值
4. 非法输入：类型错误、违反约束、非法枚举值
5. 状态机：合法/非法的状态转换
