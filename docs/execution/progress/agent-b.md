# Agent-B (Runtime + Worker) 进度

## 总览
负责 task-10 / task-11 / task-12 / task-13 / task-14。文件域:
- `apps/agent-worker/src/*`
- `apps/web/app/api/v1/agents/*`
- `packages/control-plane/src/run/*`、`packages/control-plane/src/event-store.ts`、`packages/control-plane/src/drizzle-event-store.ts`
- `packages/stream/src/*`(仅 task-10 真需要时)

**Worktree**: 工作在 `/Users/kris/develop/open-rush-task-10/`,隔离 Agent-A 的 task-7 未提交代码踩踏。所有命令以 `cd /Users/kris/develop/open-rush-task-10 && ...` 前缀。

---

## task-10 ✅(已合 PR #144 → commit `6829060`)

核心:
- `EventStore.appendAssignSeq` — pg_advisory_xact_lock + scalar subquery 单写者 seq 分配
- `RunOrchestrator` v1 flag-gated 扩展事件注入(`OPENRUSH_V1_EVENTS_ENABLED=true` 才生效)
- `data-openrush-run-started` / `run-done` 对称 no-orphan 不变式
- `detectGaps` 兼容 0-based legacy 和 1-based v1
- agent-worker zero code change(已正确),补合约单测

3 轮 Sparring 9 个问题闭环。feature flag 默认关,旧 stream 100% 向后兼容。

---

## task-11 ✅(Sparring APPROVE,待 commit)

- **分支**: `feat/task-11`(从 origin/main 起,rebase 到含 task-10 的最新 main)
- **依赖**: task-3 / task-4 / task-7(全 merged)

### 核心交付

**1. Idempotency helpers** — `packages/control-plane/src/run/idempotency.ts`
- `canonicalJsonStringify` — key-sorted JSON(`{a:1,b:2}` === `{b:2,a:1}`)
- `computeIdempotencyHash` — SHA-256(canonical JSON) = 64 hex chars(匹配 task-3 列宽)
- `scopeIdempotencyKey(agentId, key)` → `agent:<agentId>|<key>`(agent 作用域)
- `IdempotencyConflictError` — code='IDEMPOTENCY_CONFLICT'
- `LOCK_NS_IDEMPOTENCY = 0x1D3110C7` — 2-arg advisory-lock namespace
- `IDEMPOTENCY_WINDOW_MS = 24*60*60*1000`

**2. RunService** — `packages/control-plane/src/run/run-service.ts`
- `Run` / `CreateRunInput` 加 `agentDefinitionVersion` / `idempotencyKey` / `idempotencyRequestHash`
- `createRunWithIdempotency(input, { key, requestHash, nowMs?, windowMs? })` — 幂等版创建
- `resolveCreateInput()` — 继承 parentRunId 的 definitionVersion(显式 > 继承 > null)
- `cancelRun(runId)`:
  - completed/failed/finalized → RunAlreadyTerminalError
  - finalizing_retryable_failed → RunCannotCancelError
  - 其余 11 个非终态 → transition to failed with CANCELLED_MESSAGE='cancelled by user'
- 状态机 sync check 单测保证未来状态机改动不会破坏 cancel 流

**3. DrizzleRunDb** — `packages/control-plane/src/run/drizzle-run-db.ts`
- mapRow + buildInsertValues 扩展 3 字段
- `findLatestByIdempotencyKey(key, since)` — 24h 窗口 DESC 查询(用 task-3 partial index)
- `createWithIdempotencyTx(input, lookup, onExisting)` — tx + `pg_advisory_xact_lock(LOCK_NS_IDEMPOTENCY, hashtext(scopedKey))` + 单条件 INSERT

**4. 单测覆盖**(537 → 538 tests in control-plane)
- `idempotency.test.ts` 26 tests — canonical JSON 边界、hash 稳定、常量宽度、error 类
- `run-service.test.ts` 26 tests — parent-version 继承、幂等 replay/conflict/expired/windowMs 调参/跨 agent 隔离/fallback、cancel 11+3+1 状态表、状态机 sync
- `drizzle-run-db.test.ts` +8 tests — findLatest/createWithIdempotencyTx PGlite 集成、控制流并发契约(真并发验证留 task-18 E2E)
- 4 个现有 mock test 文件更新:加 `idempotencyKey` + `idempotencyRequestHash` 字段

### Sparring

Round 1 → 2 MUST-FIX + 2 SHOULD-FIX + 1 NIT:
1. cancelRun 没处理 finalized / finalizing_retryable_failed(会抛通用 Error,500 风险)
2. parentRunId 继承只在注释,未实现
3. 幂等作用域无 agentId,跨 agent 串扰风险
4. PGlite Promise.all 不能证明跨连接 advisory lock
5. 24h magic number

Round 2 → **APPROVE**,全部闭环。

### 发布策略

- 无 feature flag — 新方法 `createRunWithIdempotency` 只有 API 层(task-13)调用时才激活
- 现有 `createRun` 保留向后兼容
- 新字段全部 nullable,已有 mock / recovery 代码无须改动

---

## 坑 & 隐性约定(给 agent-b-relay 交接用)

- **共享 worktree 问题**:开工时 Agent-A/B/0-relay 共用主 worktree,会互相 `git checkout` 到别人分支。固定方案:`git worktree add /Users/kris/develop/open-rush-taskXX feat/taskXX` 独立 worktree。
- **apps/web/.env DATABASE_URL**:`pnpm build` 会走 Next.js page-data collection,需要 env。CI 在 build step 前 `echo "DATABASE_URL=..." >> apps/web/.env`,本地验证同。
- **PGlite advisory lock**:支持但必须在事务内,且 PGlite 是单连接 — Promise.all 测试只验证控制流,真正的跨连接证明要跑真 Postgres(task-18 Docker 集成)。
- **pglite helpers 三处双写**(agent-0 提醒已验证还在):`packages/db/test/pglite-helpers.ts` + `packages/control-plane/src/__tests__/drizzle-{event-store,run-db}.test.ts` 的 inline CREATE。schema 改动三处同步。
- **biome 格式化 + lint-staged**:`pnpm format` fix 格式 / import 排序;commit 时 lint-staged 可能再改文件 → 二次 `git add -A && git commit`。不要 `--no-verify`。
- **advisory lock pattern**(重复使用):
  - task-1: `pg_advisory_xact_lock(hashtext(...))` + MAX+1 为 AgentDefinition PATCH
  - task-6: `pg_advisory_xact_lock(ns, djb2(userId))` + count+insert cap 竞态
  - task-10: `pg_advisory_xact_lock(hashtext(run_id))` + appendAssignSeq seq
  - task-11: `pg_advisory_xact_lock(LOCK_NS_IDEMPOTENCY, hashtext(scopedKey))` + 幂等
  - 所有未来 TOCTOU 场景都用同款
- **受保护文件**:不得 edit plan / verify.sh / 3 份 spec(managed-agents-api / agent-definition-versioning / service-token-auth)/ TASKS.md(只允许勾 checkbox)。需要改 → SendMessage team-lead。

---

## task-12/13/14 给 agent-b-relay 的关键提示

### task-12 API `/api/v1/agents/*`(4 endpoint)

文件域:`apps/web/app/api/v1/agents/*`(**非** runs 子路径)

- POST `/api/v1/agents` — 创建 Agent(task 行)+ 第一个 Run。需要事务:
  1. `authenticate(req)` — 用 `apps/web/lib/auth/unified-auth.ts::authenticate`(task-5 merged)
  2. 解析 body via `v1.createAgentRequestSchema`(contracts)
  3. 调用 AgentDefinitionService.getByVersion 校验 (definitionId, version) 存在
  4. 插 tasks 行 + 调 runService.createRunWithIdempotency 创第一 run(inherit definitionVersion 到 run)
  5. 返回 `v1.createAgentResponseSchema`
- GET / GET:id — 列表 / 详情
- DELETE `/api/v1/agents/:id` — soft cancel:task.status='cancelled',有 activeRun 先调 runService.cancelRun
  - cancelRun 返回后 API 层 **把 run.status 'failed' 映射回 response.status='cancelled'**(spec §E2E 3.5)
  - RunAlreadyTerminalError / RunCannotCancelError 需要 try/catch 映射到友好 200(terminal)或 409(retryable)

### task-13 API `/api/v1/agents/:id/runs/*`(非 events,4 endpoint)

文件域:`apps/web/app/api/v1/agents/[agentId]/runs/*`

- POST create(带 `Idempotency-Key` header):
  ```typescript
  const auth = await authenticate(req);
  if (!auth) return 401;
  
  const body = v1.createRunRequestSchema.parse(await req.json());
  const key = req.headers.get('Idempotency-Key');
  const hash = key ? computeIdempotencyHash(body) : undefined;
  
  // 查 agent 的 definitionVersion
  const task = await db.select().from(tasks).where(eq(tasks.id, agentId)).limit(1);
  const definitionVersion = task[0]?.definitionVersion ?? agent.currentVersion;
  
  try {
    const run = await runService.createRunWithIdempotency(
      { agentId, prompt: body.input, taskId: agentId, agentDefinitionVersion: definitionVersion, parentRunId: body.parentRunId },
      key ? { key, requestHash: hash! } : undefined
    );
    return Response.json({ data: run }, { status: 201 });
  } catch (err) {
    if (err instanceof IdempotencyConflictError) return 409 IDEMPOTENCY_CONFLICT;
    throw err;
  }
  ```
- GET list / GET :runId — 基础 CRUD via DrizzleRunDb.listByAgent / findById
- POST :runId/cancel:
  ```typescript
  try {
    const cancelled = await runService.cancelRun(runId);
    // v0.1 spec §E2E 3.5: 响应 status 映射为 'cancelled'
    return Response.json({ data: { ...cancelled, status: 'cancelled' } });
  } catch (err) {
    if (err instanceof RunAlreadyTerminalError) {
      // 已终结 — 幂等返回
      const run = await runService.getById(runId);
      return Response.json({ data: { ...run, status: 'cancelled' } });
    }
    if (err instanceof RunCannotCancelError) {
      return Response.json({ error: { code: 'VALIDATION_ERROR', message: err.message, hint: 'wait for retry to resolve' } }, { status: 409 });
    }
    if (err instanceof RunNotFoundError) return 404;
    throw err;
  }
  ```

### task-14 API SSE `/events` + Last-Event-ID

文件域:`apps/web/app/api/v1/agents/[agentId]/runs/[runId]/events/route.ts`

- 协议:`Content-Type: text/event-stream`,仅 `Last-Event-ID` header(无 query cursor)
- 每条事件 `id: <seq>`(seq 是 appendAssignSeq 分配的 1-based)
- 流程:
  1. Last-Event-ID 解析为整数 N(默认 0)
  2. `SELECT * FROM run_events WHERE run_id=? AND seq > N ORDER BY seq`
  3. 发 replay 帧(id + data)
  4. run 未结束 → 订阅 Redis pub/sub(StreamRegistry)继续 live
  5. run 已结束(completed/failed) → 发完 replay 后关连接
- 断线重连时浏览器自动 set `Last-Event-ID`,服务端只需读 header

**feature flag** `OPENRUSH_V1_EVENTS_ENABLED`:
- 关(默认) → run_events 表是 task-10 `appendAssignSeq` 写的,但 legacy counter `append` 也可能写。seq 从 0 or 1 起,事件流依然能 replay
- 开 → 纯 v1 单写者,seq 严格 1-based,带 `data-openrush-*` 扩展事件

### Sparring / verify 建议

- 每个 task PR 都至少跑 1 轮 Sparring。复杂的(task-12/13)可能 2-3 轮
- 每次 push 前 `git fetch + git rebase origin/main`
- commit 前 `pnpm build/check/lint/test` + `./docs/execution/verify.sh task-N`
- 不碰 `packages/control-plane/src/index.ts`(Agent-A 的 re-export 区)
- 跨 file 域冲突 → SendMessage team-lead
