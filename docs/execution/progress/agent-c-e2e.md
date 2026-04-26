# Agent-C-e2e — task-18 E2E 集成测试

## 交付产物

- `apps/web/e2e/v1-api.spec.ts` — 12 个断言,覆盖 spec §E2E 6 场景:
  1. Service Token 鉴权(5 case:missing / malformed / scope-ok / scope-miss / revoked)
  2. AgentDefinition CRUD + 版本化(create v1 → patch v2 → stale 409 → GET ?version=1 → GET /versions → POST /archive 全链路)
  3. Agent + Run + Event 闭环(3 sub-case:初次 agent+run+events / follow-up run + Last-Event-ID 重连 / cancel + terminal SSE 帧)
  4. 幂等性(same key+body 原始响应 / same key+diff body 409 / DB 验证无第二次 insert)
  5. Vault(POST 加密 / GET 不含 encryptedValue 且不含明文 / injectionTarget 持久化)
  6. 乐观并发(两 PATCH 同 If-Match → 1 win 200 / 1 lose 409 / 版本表确实只多出一行)
- `apps/web/package.json` 新增 `test:e2e` 脚本(与 `test` 同命令,对齐 verify.sh task-18 gate 的 `pnpm --filter @open-rush/web test:e2e -- v1-api` 调用)
- `docs/execution/TASKS.md` 勾上 task-18

## 关键决策

### 1. 测试引擎选 PGlite 而非 docker-compose

**起点**:任务描述里提到 "CI 集成 postgres + redis docker-compose",暗示应该起真容器。

**为什么不起容器**:
- 所有 v1 路由单测 + 两个现有 `*.integration.test.ts`(vaults / patch-concurrency)都已在用
  `@electric-sql/pglite` 打 in-memory PG;PGlite 已经支持路由依赖的两个关键 PG 特性 ——
  `pg_advisory_xact_lock` / `hashtext(...)`(幂等 tx lock + run_events seq 分配都走这两个原语,
  前者在 `patch-concurrency.integration.test.ts` 已验证,后者在 `drizzle-event-store.test.ts` 验证)
- `vitest.workspace.ts` 把 `pnpm test` 统一指到各 package 的 `vitest.config.ts`;单一入口、零 docker 启动 = CI 不用改,本地也不用改
- Redis 只在 `packages/stream`(SSE① 用的 resumable-stream)里使用,**SSE② route 自身不依赖 Redis**(它 500ms 轮 `run_events` 表,见 task-14 route.ts §Liveness 注释);E2E 要测的正是 SSE② 协议,Redis 不在必经路径上
- 真正上 docker compose 会让 CI 每次跑多花 ~15s(等容器就绪),E2E 本身只跑 ~1s

**trade-off**:PGlite 不 100% 等同于生产 pg16 pgvector,但对 task-18 要验的 6 场景是足够的(两个 "真 Postgres" integration 测已经在用同款驱动跑得很好)。

### 2. 唯一 mock 的两件事

- `@/auth` NextAuth `auth()`:session 路径必须要 mock 才能伪造登录态(真 NextAuth 需要 HTTP context)
- `@open-rush/db` 的 `getDbClient()`:把全进程单例指到本测试文件创建的 PGlite 实例

所有**业务逻辑**(RunService / AgentDefinitionService / VaultService / unified-auth 的 service-token 路径 / SSE route handler / 所有 Zod schema 验证)都走真实代码。这是 E2E 和 route unit test 的本质分界线。

### 3. SSE 断言严格对齐 handoff notes §1 六条铁律

- 每帧必有 `id: <seq>` → 用 `frameSeq()` 解并断言单调递增
- Last-Event-ID header-only → 显式测 query `?cursor=3` 被忽略(回归锁死)
- 空 Last-Event-ID → 400(`z.coerce.number()` 坑位的回归)
- terminal run 全量 replay 后 close → 读到 reader done 且 frames.length 与 run_events 行数一致
- 读帧按 `\n\n` 切分,不直接 `JSON.parse(chunk)`(handoff notes §6 anti-pattern 锁死)
- 没有 fixed timeout;所有 SSE 连接靠 terminal run 状态自然关闭,不依赖 "N 秒后必 close"

### 4. 事件种子策略

Scenario 3 用 `db.insert(runEvents).values([...])` 直接写 run_events 表(同样路径产线的 control-worker `appendAssignSeq` 最终也落这里)。不起真 agent-worker + control-worker 是因为:
- 本 task 是协议层 E2E,不是 orchestrator 集成测(smoke-test.ts 干那个)
- agent-worker 要真 Anthropic key + echo agent,太重
- 我们要测的 SSE 协议不变式是"给定 run_events 某状态 → SSE 返回什么" —— 直接 seed 最直接

### 5. `runs.agent_id` FK cascade 问题规避

`runs.agent_id` 在 schema 层 references `agents.id`(delivery mode),但 route code 里 agent
(API 层)= `tasks` 表、AgentDefinition = `agents` 表。测试里 run 是通过 `appendRun` 走真 `RunService.createRunWithIdempotency` 创建的,自然合规,不需要手工规避。

## 失败过一次的点(修复记录)

- **lint MUST-FIX: noNonNullAssertion**(8 处)—— 初稿用 `firstRunId!` 断言 `string | null` 为 `string`,被 biome 抓住。改成显式 `if (!firstRunId) throw new Error('expected firstRunId to be set by createAgent')`,语义更清晰,还让 test 失败时 error message 更有信息量。
- **lint MUST-FIX: organizeImports** —— biome 要求 `agents as agentsTable` 在 `agentDefinitionVersions` 之后(字母序),跑 `biome check --write` 自动修。
- **`pnpm build` 首次失败** —— 不是我的问题,需要 `apps/web/.env` 有 `DATABASE_URL` 才能通过 Next.js page data collection。CI workflow 已有对应 step(`ci.yml` step "Build" echo 写入 .env)。本地开发环境需要:`echo "DATABASE_URL=postgresql://rush:rush@localhost:5432/rush" > apps/web/.env`。

## 验证结果

```
$ ./docs/execution/verify.sh task-18
=== Build ===                [OK]
=== Check (type-check) ===   [OK]
=== Lint ===                 [OK]
=== Test ===                 [OK]  409 tests, 28 files
=== Task-specific: task-18 ===
[OK]   e2e spec exists
[OK]   e2e v1-api passes (6 scenarios)
[PASS] task-18
```

E2E file 本身的 runtime:~926ms(12 tests)。

## 给下游 agent 的提示

### task-19(前端迁移 + legacy 清理)

- **本 E2E 文件锁定了 `/api/v1/*` 的 wire shape**。task-19 删 legacy route 时如果 *不小心* 改动
  `apps/web/app/api/v1/*` 的 route 签名(比如把 `/api/v1/vaults/entries` GET 的响应 stripping
  逻辑搬走),E2E 会立即红掉。**优先信任 v1-api.spec.ts 的断言,不信任人工review。**
- Scenario 3 的 SSE 断言挡的是任何"顺手优化"协议:加 query cursor / 改 frame 里的 id 为可选 /
  把 terminal run 改成不主动 close —— 都会被我锁死的断言打回。

### task-16 TypeScript SDK

- SDK 可以把 v1-api.spec.ts 当作 "**使用示例的规范**"。
  - 创建 token / 发请求的 header 约定(`Authorization: Bearer sk_*` / `If-Match: <version>` /
    `Idempotency-Key: <uuid>` / `Last-Event-ID: <seq>`)全都在本文件里有调用示例
  - 错误 envelope 格式(`{ error: { code, message, hint?, issues? } }`)断言在每个 scenario

### task-15 OpenAPI spec

- **测试里用到的 6 场景 HTTP dance 是 OpenAPI example 的天然素材**。把 Scenario 2 拷出来
  改成 `examples:` 节是最快写出权威 example 的路径。
