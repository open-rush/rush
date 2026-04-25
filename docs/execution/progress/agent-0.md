# Agent-0 Foundation 进度

## 总览
负责 M1 六个任务(schema + contracts + auth middleware)。严格串行执行。

## task-1 Schema agent_definition_versions + agents 字段
- **状态**: ✅ 完成,等待合并
- **分支**: `feat/task-1`
- **文件域**: `packages/db/src/schema/agents.ts`, `packages/db/src/schema/agent-definition-versions.ts`, `packages/db/drizzle/0009_agent_definition_versions.sql`, 相关测试 + pglite helper 更新
- **关键决策**:
  - 新增 `agent_definition_versions` 表,FK `agent_id → agents.id ON DELETE CASCADE`,`created_by → users.id ON DELETE SET NULL`。
  - `agents` 表扩两列:`current_version integer NOT NULL DEFAULT 1`、`archived_at timestamptz`。
  - Migration 中使用 `to_jsonb(agents.*) - 'id' - 'created_at' - ...` 剥掉 metadata/runtime 字段,符合 spec §初次 migration。
  - 采用手写 migration SQL 而非 drizzle-kit 生成,因现有 journal 在 0007/0008 已存在 snapshot 漂移(0007 无 snapshot,0008 snapshot 未反映其变更);drizzle-kit 生成的会尝试重建已有的 tasks/mcp_* 等表。
  - 同步更新 `packages/db/test/pglite-helpers.ts` + `packages/control-plane/src/__tests__/*` 三处 agents 表 DDL(加两列),保证所有依赖 PGlite 的测试不挂。
  - 测试覆盖:unique 约束、同 agent 单调递增、不同 agent 可共用版本号、FK cascade、FK set null、default 行为、migration 回填 v1 snapshot。
- **已知问题**:`docs/execution/verify.sh` 使用了错误的 scope 名 `@openrush/db`(实际是 `@open-rush/db`),task-specific filter 是 no-op。由于 verify.sh 是受保护文件,不修改;通用 `pnpm test` 已覆盖本任务全部测试。
- **验证结果**: `pnpm build/check/lint/test` 全绿;`./docs/execution/verify.sh task-1` PASS(69 个 db 测试通过)。
