# Agent-B (Runtime + Worker) 进度

## 总览
负责 task-10 / task-11 / task-12 / task-13 / task-14。文件域:
- `apps/agent-worker/src/*`
- `apps/web/app/api/v1/agents/*`
- `packages/control-plane/src/run/*`、`packages/control-plane/src/event-store.ts`、`packages/control-plane/src/drizzle-event-store.ts`
- `packages/stream/src/*`(仅在 task-10 真需要时)

**Worktree**: 工作在 `/Users/kris/develop/open-rush-task-10/`,隔离 Agent-A 的 task-7 未提交代码踩踏。

## task-10 Agent Worker AI SDK UIMessage stream + 单写者模型
- **状态**: 代码完成,等 Sparring APPROVE 后 commit/PR
- **分支**: `feat/task-10`
- **依赖**: task-3 / task-4(均 merged)

### 改造总结

1. **EventStore 接口扩展** — `appendAssignSeq(event: Omit<EventStoreEvent, 'seq'>)`
   - `InMemoryEventStore`: 每 runId 一条 Promise chain 串行化并发写,seq 从 1 起
   - `DrizzleEventStore`: 事务内先 `pg_advisory_xact_lock(hashtext(run_id::text))`,单 INSERT 用 `COALESCE((SELECT MAX(seq) FROM run_events WHERE run_id = $1), 0) + 1` 原子分配
   - 保留 `append(event)` 向后兼容旧路径

2. **Run 类型扩展** — `agentDefinitionVersion: number | null`
   - `Run` 接口加字段
   - `DrizzleRunDb.mapRow` 从 `runs.agent_definition_version` 列读(task-3 已有)
   - 5 处测试 mock Run 对象加 `agentDefinitionVersion: null`

3. **RunOrchestrator 改造**
   - 导出 `isV1EventsEnabled(env)` 函数读 `OPENRUSH_V1_EVENTS_ENABLED === 'true'`(默认 off)
   - `execute()`:v1 开 → 在 sendPrompt 前 `emitRunStarted`(带 definitionVersion),成功后 `emitRunDone(success)`;catch 分支 `emitRunDone(failed, error)`(仅在 started 已发过时,避免 done-before-started)
   - `consumeStream(runId, response, v1Enabled)`:v1 开 → `appendAssignSeq`,v1 关 → 旧 `append(seq=i)` 路径,**100% 向后兼容**
   - `emitRunStarted`: 若 `agentDefinitionVersion` 为 null(legacy 或 task-11 前的 run),跳过扩展事件注入(Zod schema 要求 definitionVersion ≥ 1)
   - `emitRunDone`: status=success | failed | cancelled

4. **agent-worker server.ts** — 零代码改动(已是正确的 `toUIMessageStreamResponse`)。只补单测。

### 单测覆盖

- `packages/control-plane/src/__tests__/event-store.test.ts` — +6 tests: InMemory appendAssignSeq seq=1 起、monotonic、per-run 独立、50 并发无 gap、与 legacy append 共存、错误链重启
- `packages/control-plane/src/__tests__/drizzle-event-store.test.ts` — +7 tests: DrizzleEventStore appendAssignSeq PGlite 集成、legacy/v1 并存、25 并发无 gap、schemaVersion、data-openrush-run-started payload
- `packages/control-plane/src/__tests__/run-orchestrator.test.ts` — +5 tests: flag off 默认行为不变(seq 0 起,无扩展事件)、flag on 注入 run-started/run-done 带正确 definitionVersion、null version 跳过 run-started、error 路径 emit run-done failed、env 字符串 "false"/"0"/空 视为 off
- `apps/agent-worker/src/__tests__/server.test.ts` — +3 tests: SSE① 通过 toUIMessageStreamResponse 委托、agent-worker 不 import control-plane EventStore、AI SDK 6 UIMessageChunk 全家族 pass-through

### 验证结果

- `pnpm --filter @open-rush/control-plane check` — ✅
- `pnpm --filter @open-rush/control-plane test` — ✅ 464 tests pass
- `pnpm --filter @open-rush/agent-worker test` — ✅ 25 tests pass
- `pnpm lint` — ✅(3 个 pre-existing warning,非我改动)
- `pnpm test` — ✅(整 workspace 通过,含 web 149 tests)
- `./docs/execution/verify.sh task-10` — ✅ **PASS**

### 发布策略符合度

- `OPENRUSH_V1_EVENTS_ENABLED=false` 默认 → `consumeStream` 走 legacy counter,**agent-worker → control-worker 流完全和 main 行为一致**,不破坏现有生产 stream
- `OPENRUSH_V1_EVENTS_ENABLED=true` 开启时才激活单写者模型和扩展事件
- 符合 plan §10 "task-19 合入前一直关" 要求

### 坑

- **共享 worktree 问题**(开工即踩):Agent-A 和我原本在同一个 git 工作树,他们 uncommitted 的 task-7 代码会"切"过来。转用独立 worktree `/Users/kris/develop/open-rush-task-10/` 完全隔离后再未出现。**后续 task 也都在独立 worktree 做**。
- **Sandbox destroy 导致 worker_unreachable 转换**:`run-orchestrator.test.ts` 里旧有测试预期只转到 `failed`,但我加的扩展事件顺序是 `running → emit started → sendPrompt`,若 sendPrompt 失败直接进 catch。我在 catch 里按 `runStartedEmitted` 控制 run-done 发送,避免在 sendPrompt 抛异常时 emit done-before-started。
- **PGlite advisory lock**:PGlite 支持 `pg_advisory_xact_lock`,但必须在事务内(verify 已通过:25 并发 run 正确分配 seq 1-25 无 gap)。
- **web build 需要 apps/web/.env DATABASE_URL**:CI 是通过 `echo "DATABASE_URL=..." >> apps/web/.env` 在 build step 前写入。本地验证时也需要创建此文件。
