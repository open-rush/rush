# Agent-A (Registry + Auth) Progress

## Overview
负责 task-7 → task-8 → task-9 串行。文件域:
- `packages/control-plane/src/agent-definition-service.ts`
- `apps/web/app/api/v1/{agent-definitions,vaults}/*`
- (auth route 部分,task-5/6 已由 Agent-0-relay 完成)

## task-7: AgentDefinitionService(PATCH 版本化 + 乐观并发)
- **状态**: ✅ 完成,等 Sparring + PR
- **分支**: `feat/task-7`
- **文件域**:
  - `packages/control-plane/src/agent-definition-service.ts`(新,~355 行实现)
  - `packages/control-plane/src/__tests__/agent-definition-service.test.ts`(新,28 tests)
  - `packages/control-plane/src/index.ts`(添加 exports,仅新增自己的符号)
  - `docs/execution/TASKS.md`(勾选 checkbox)
- **关键决策**:
  - **Ports/Adapters**: 跟随 `ProjectAgentService` 模式,直接消费 `DbClient`(drizzle-orm 事务),不抽象 DB port。测试用 pglite(同 repo 其他测试约定)。
  - **事务 & 悲观锁**: PATCH 和 archive 都在 `db.transaction` 内用 `.for('update')` 行锁,保证同 agent 的并发 PATCH 严格串行(spec §PATCH 流程 6 步原子)。
  - **乐观并发**: `If-Match` 在行锁后与 `agents.current_version` 比较,不匹配 → `AgentDefinitionVersionConflictError`(API 层映射 409 VERSION_CONFLICT)。
  - **Snapshot 格式**: 只存 editable 字段(13 个),排除 id / projectId / currentVersion / archivedAt / createdAt / updatedAt / lastActiveAt / activeStreamId / createdBy / isBuiltin / customTitle / status。测试 assertion 明确排除这些字段。与 `agentDefinitionEditableSchema`(contracts v1)对齐。
  - **domain vs contract 类型**: 内部 `AgentDefinition` 保留 `Date` 对象,由 API 路由(task-8)转 ISO。避免在 service 层做 ISO 字符串转换(复用不方便)。
  - **空 patch 快速拒绝**: `pickEditablePatch()` 过滤出真正要改的 editable 字段,空集直接抛 `EmptyAgentDefinitionPatchError`(400),不进事务 — 和 Zod `patchAgentDefinitionRequestSchema` 的 refine 语义完全对齐。
  - **archive 幂等**: 已 archive 的再 archive 不 bump version、不更新 archived_at(测试覆盖)。归档是 metadata,不改 definition。
  - **getByVersion 的 updatedAt**: 用 version 行的 `createdAt`(= 该版本写入时间),不是 agents 表的 updatedAt。这样客户端 sort history 的时间戳是"这个版本生成的时刻",语义一致。
  - **listVersions cursor**: 用 `version` 数字本身作 opaque cursor,`lt(version, cursor)` 查下一页;`limit + 1` fetch 检测 hasMore。
  - **NotFound 错误链**: `getByVersion` 先校验 agent 存在(`AgentDefinitionNotFoundError`),再校验 version(`AgentDefinitionVersionNotFoundError`)。
  - **错误类设计**: 5 个专属错误类(NotFound / VersionNotFound / VersionConflict / Archived / EmptyPatch),API 层可按 `instanceof` 映射到 v1 ErrorCode + HTTP 状态。
- **测试覆盖**(28 tests,分 6 section):
  - create:v1 snapshot 一致性 / changeNote 默认 null / config 存 jsonb 往返
  - get:正常 / NotFound / 归档后仍可 get
  - getByVersion:snapshot 合并 / VersionNotFound / AgentNotFound 优先 / 非正整数拒绝
  - listVersions:desc 排序无 snapshot / cursor 分页 3 页正确 / NotFound / limit clamp
  - patch:原子 bump / 409 conflict / 并发 Promise.allSettled 只一个赢 / archive 后 patch 被拒 / 空 patch 拒绝 / 未覆盖字段保留 / 显式 null 允许
  - archive:设置 archived_at / 幂等(二次 archive)/ NotFound / FK cascade sanity
  - 不变量:两 agent 共用 version=1 / 单调 version per agent
- **坑 / 经验**:
  - **context 被 hijack 一次**: 中途有外部进程把我切到 `feat/task-5` 并且 pull origin main 合掉我的 branch。靠 `git fsck --lost-found` 在 dangling tree 里找回了 blob `16b01e92...`(service)+ `110291272...`(test),cat-file 存到 /tmp 后再 restore。教训:untracked 文件随时可能消失,尽早 commit。
  - **biome 格式差异**: 写代码时没跑 format,第一次 verify.sh 被 lint 卡。`pnpm exec biome check --write` 修掉 import 排序 + line 折行。现在两文件都 clean。
  - **FOR UPDATE 在 pglite**: `.for('update')` 在 pglite 单进程里是 no-op 但 syntax 合法,生产 PG 才真有行锁。测试里靠 Promise.allSettled 同步触发并发 — 由于 pglite 是单线程,两个 patch 会串行,但 version 检查仍保证只有一个成功。结论:测试逻辑覆盖 409,production lock 靠 PG。
  - **drizzle update 的 undefined 清洗**: `.set({})` 里 undefined 字段 drizzle 会跳过,但安全起见在 patch 里手动 `delete updateValues[k]` 清掉 undefined 防止覆盖为 NULL。
  - `Repo 隐性约定` 同 agent-0 笔记 §2/5:控制面 test 文件要 inline DDL 三处同步(但我只新加测试,不改 schema,所以只动自己这一个文件的 DDL block,保持和 pglite-helpers.ts 一致)。
- **Sparring 轮 1**(Codex gpt-5.3-codex-xhigh):
  - **MUST-FIX**: snapshot 字段 camelCase 与 0009 migration 回填的 snake_case 不一致,`getByVersion` 读旧 v1 会漏字段。
    → 修:加 `readSnapshotField()` 容错读(两种 key 都试),同时加测试 `reads legacy snake_case v1 snapshot`。
  - **SHOULD-FIX**: `getByVersion(0)` 抛 NotFound 不符合 VALIDATION 语义;同理 `patch(ifMatchVersion=-1)` 抛 Conflict 混淆。
    → 修:新增 `InvalidAgentDefinitionInputError` 错误类,`getByVersion` + `patch` 前置校验用它,映射 VALIDATION_ERROR。
  - **SHOULD-FIX**: PGlite 单线程不能证明 PG `FOR UPDATE` 行锁语义。
    → 修:在并发 test 加 NOTE 注明这是 service 层 optimistic check 证据,真实 PG 锁留给 task-8 API 集成测试。
- **Sparring 轮 2**: **APPROVE**(逐项确认 snake_case 兼容 / 错误分类可区分 / 并发证据 / 无回归)
- **验证结果**(修复后):
  - `pnpm --filter @open-rush/control-plane build` PASS(tsup + DTS)
  - `pnpm --filter @open-rush/control-plane check` PASS
  - `pnpm --filter @open-rush/control-plane lint` 无 error(3 warnings 都是 pre-existing)
  - `pnpm --filter @open-rush/control-plane test` 35 files / 476 tests(含我的 1 file / 30 tests)全绿
  - `./docs/execution/verify.sh task-7` PASS

## task-8: API /api/v1/agent-definitions/* (6 endpoints)
- **状态**: ✅ 本地验证全绿,等 Sparring + PR
- **分支**: `feat/task-8` 在 `/tmp/agent-wt/a` 专属 worktree(基于 origin/main 5ffc60b — 包含 task-5/6/7/10 merged commits)
- **文件域**:
  - `apps/web/app/api/v1/agent-definitions/route.ts`(POST + GET list,新)
  - `apps/web/app/api/v1/agent-definitions/[id]/route.ts`(GET + PATCH,新)
  - `apps/web/app/api/v1/agent-definitions/[id]/versions/route.ts`(GET versions,新)
  - `apps/web/app/api/v1/agent-definitions/[id]/archive/route.ts`(POST archive,新)
  - `apps/web/app/api/v1/agent-definitions/helpers.ts`(definitionToV1 + mapAgentDefinitionError,新)
  - `apps/web/app/api/v1/agent-definitions/*.test.ts`(4 route 测试文件,新,共 48 tests)
  - `apps/web/lib/api/v1-responses.ts`(v1Success / v1Error / v1Paginated / v1ValidationError,新)
  - `apps/web/lib/api/v1-responses.test.ts`(helper 单测,新,10 tests)
  - `packages/control-plane/src/agent-definition-service.ts`(+ `list(opts)` 方法 + `ListAgentDefinitionsOptions/Result` types + cursor encode/decode helpers,+ 8 tests)
  - `packages/control-plane/src/index.ts`(+ 2 types re-export)
  - `docs/execution/TASKS.md`(勾选 task-8 checkbox)
- **关键决策**:
  - **v1 响应契约独立于 legacy**:`api-utils.apiSuccess/apiError` 用 `{success, data, error, code}`(legacy)。v1 契约要求 `{data}` / `{error: {code, message, hint?, issues?}}`。新建 `lib/api/v1-responses.ts` 做干净分离,单测覆盖 8 个 ErrorCode → HTTP status 映射。
  - **错误分类 1:1 映射**:`helpers.ts.mapAgentDefinitionError` 把 service 6 个错误类映射到 v1 ErrorCode(NotFound/VersionNotFound → 404,VersionConflict → 409 + hint,Archived/EmptyPatch/InvalidInput → 400,未知 → rethrow → 500)。
  - **project-membership 前/后置**:
    - POST / GET?projectId=X:**前置**校验(快速失败、不泄露存在性)
    - GET/PATCH/archive 按 id:**后置**校验(`service.get` 拿 projectId 再 verifyProjectAccess)。存在但无权 → 403;不存在 → 404
    - GET 无 projectId:扫 caller 可见的 projectIds(memberships + createdBy fallback),`service.list({ projectIds })` 批量过滤;`projectIds=[]` 早短路
  - **list() 服务扩展**:task-7 只有 listVersions。task-8 在 AgentDefinitionService 加 `list(opts)` 支持 `{ projectId | projectIds, includeArchived, limit, cursor }`。keyset 分页 `(created_at DESC, id DESC)`,opaque base64url cursor 编码 `createdAt.ISO|id`,非法 cursor 静默回落到首页。
  - **If-Match 必填**:Route 显式检查 header 缺失 → 400 VALIDATION,再用 `ifMatchHeaderSchema`(coerce positive int)校验内容。
  - **Next.js 16 params**:`params: Promise<{ id: string }>` + `await params`。id 用 `getAgentDefinitionParamsSchema.safeParse` 做 uuid 校验。
  - **日期序列化集中在 helpers**:service 返回 `Date`,route 通过 `definitionToV1(d)` 一次性 toISOString 再输出。契约 schema 期望 `z.string().datetime({offset:true})`,route test 断言字面字符串。
  - **mock 策略防止 next-auth 塌房**:`@/lib/api-utils` 依赖 `@/auth` → next-auth 在 vitest ESM 下会 `Cannot find module 'next/server'`。测试直接 `vi.mock('@/lib/api-utils', () => ({ verifyProjectAccess: ... }))` 不 importActual,绕过整个 adapter 链。
  - **ZodError 结构化类型**:apps/web 无直接 zod 依赖,inline `ZodIssueLike / ZodErrorLike` 避免 import zod。
- **测试覆盖** (总 66 new tests):
  - `route.test.ts` (12):POST 401/403/400 invalid-JSON/400 schema/403 project/201 ISO/rethrow + GET 401/403/400 limit/403 project/paginated ISO
  - `[id]/route.test.ts` (20):GET 401/403/400 id/404/403 project/200 current/200 ?version=N/400 invalid version/404 unknown version;PATCH 401/403/400 no-If-Match/400 bad-If-Match/400 invalid-JSON/400 empty body/403 project/404/409 conflict+hint/400 archived/200 bumped
  - `[id]/versions/route.test.ts` (9):401/403/400 id/404/403 project/desc+ISO+nextCursor/cursor pass-through/400 non-numeric cursor/null nextCursor
  - `[id]/archive/route.test.ts` (7):401/403/400 id/404/403 project/200 ISO/幂等第二次同 archivedAt
  - `lib/api/v1-responses.test.ts` (10):v1Success/v1Paginated 格式 + v1Error 8 code→status 映射 + v1ValidationError 多 issue 合并 + 空 issues
  - control-plane `list()` (8):DESC 排序 / projectId / projectIds / `projectIds=[]` 短路 / includeArchived / cursor 3 页 round-trip / 非法 cursor 宽松 / limit 夹紧
- **坑 / 经验**:
  - **Worktree 隔离必须严格**:第一次启动 task-8 时仍在 `/Users/kris/develop/open-rush` 主 worktree 工作,team-lead 提醒后切到 `/tmp/agent-wt/a`。中间尝试 `git stash -u` 再 `git checkout origin/main -- .` 引入了 task-6 的未追踪改动 — 最终 `git reset --hard origin/main` 干净恢复。教训:worktree 内的 git 写操作保持最小,冲突用 reset + 让 untracked 文件自然保留。
  - **task-6/10 中途 merge 到 main**:起步时 main 在 961716d,期间 coordinator merge 了 task-6(auth/tokens)+ task-10(agent-worker)。rebase 到新 main(5ffc60b)后域不冲突。
  - **DATABASE_URL for build**:`pnpm build` 经 turbo 不透传 env。解决:`echo 'DATABASE_URL=postgresql://dummy:...' > apps/web/.env`(gitignored),复刻 CI 做法。pre-existing 问题。
  - **Next-auth ESM 解析塌房**:`@/lib/api-utils` → `@/auth` → next-auth → Cannot find module 'next/server'。用 `vi.mock('@/lib/api-utils', () => ({ verifyProjectAccess: ... }))` 直接替换,不 importActual。
- **验证结果**:
  - `pnpm build` PASS(需 DATABASE_URL,同 CI)
  - `pnpm check` / `pnpm lint` PASS(2 pre-existing warnings)
  - `pnpm test` PASS:web 17 files / 249 tests,control-plane 35 / 505
  - `./docs/execution/verify.sh task-8` **PASS**
- **Sparring 轮 1**(Codex gpt-5.3-codex-xhigh):CONCERNS
  - MUST-FIX 1: `listAccessibleProjectIds()` 在 `project_members` 分支没 filter `projects.deletedAt` → 软删项目的 definition 仍能被 member 列出。
    → 修:改成 innerJoin projects + `isNull(projects.deletedAt)`;加回归 integration 测试(soft-deleted project exclusion)。
  - MUST-FIX 2: "集成测试覆盖乐观并发 409" 仅用 mock service 不算集成。
    → 修:新建 `patch-concurrency.integration.test.ts`,用真实 AgentDefinitionService + PGlite + 真实 route 链路(只 mock auth / verifyProjectAccess / getDbClient)。4 测试:并发 200/409、顺序无 false-conflict、stale If-Match 409、软删项目排除。加 `@electric-sql/pglite` 为 apps/web devDep。
  - SHOULD-FIX 1: `/versions?cursor=1abc` 被 Number.parseInt 接受为 1 — 宽松。
    → 修:严格正则 `/^[1-9]\d*$/`,5 个非法值(abc, 1abc, -1, 0, 1.5)全 400 测试覆盖。
  - SHOULD-FIX 2: list cursor Date.toISOString 是 ms 精度但 PG timestamptz 是 μs → 同 ms 内 μs-不同的行可能被跳过。
    → 修:`WHERE` + `ORDER BY` 两侧都用 `date_trunc('milliseconds', created_at)` 统一到 ms 精度;现在比较一致、不丢行。
- **Sparring 轮 2**: **APPROVE**(逐项确认 4 项修复成立 + 其他 Round 1 项不退化;NIT 仅建议补 Docker PG 多连接用例,非阻塞)

## task-9: API /api/v1/vaults/entries/*(待 task-8 merge 后)
- 依赖 task-5(已 merged)+ task-4(已 merged)
- 复用 task-8 的 `v1-responses.ts` helpers + 前/后置 membership check 模式

## 纪律 / 流程

- 每 task 单独 branch、单独 PR、Sparring APPROVE 才 commit
- context > 50% 通知 team-lead,> 70% 必换
- 受保护文件不改;只勾 TASKS.md checkbox
- 每 Bash 调用前缀 `cd /tmp/agent-wt/a && ...`(worktree 隔离)
