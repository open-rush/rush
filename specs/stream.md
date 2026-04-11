# Stream Specification

packages/stream 提供 Redis-backed 可恢复 SSE 流，用于 control-worker → web 的事件传输。

## 核心概念

- **StreamRegistry**: 管理流的生命周期（publish/resume/exists/invalidate/close）
- **publish**: 将 ReadableStream 写入 Redis，客户端可订阅
- **resume**: 从断点恢复流（基于 cursor），支持断线重连
- **exists**: 检查流是否存在（活跃或已完成）
- **invalidate**: 清理僵死流的 sentinel key

## 架构

```
Control Worker → publish(streamId, streamFactory) → Redis
Browser        → resume(streamId)                  → ReadableStream<string>
```

底层使用 `resumable-stream` 库处理 cursor 管理、Redis 缓冲、TTL。

## Redis 配置

支持两种模式：

1. **Standalone**（开发环境）: `url: "redis://localhost:6379"`
2. **Sentinel**（生产 HA）: `sentinels: "host1:port1,host2:port2"`, `masterName: "mymaster"`

优雅降级：Redis 不可用时 `createStreamRegistry()` 返回 null，调用方回退到 DB-only 模式。

## 公开 API

```typescript
// 创建 registry（Redis 不可用返回 null）
createStreamRegistry(config: StreamRegistryConfig): StreamRegistry | null

// StreamRegistry 方法
publish(streamId: string, streamFactory: () => ReadableStream<string>): Promise<void>
resume(streamId: string): Promise<ReadableStream<string> | null>
exists(streamId: string): Promise<boolean>
invalidate(streamId: string): Promise<void>
close(): Promise<void>

// Redis 工具
createRedisClient(config: RedisClientConfig): IORedis | null
createRedisOptions(overrides?: Partial<RedisOptions>): RedisOptions
parseSentinelEndpoints(sentinelsStr: string): SentinelEndpoint[]
hasSentinelConfig(config: RedisClientConfig): boolean
hasStandaloneConfig(config: RedisClientConfig): boolean
```

## 文件结构

```
packages/stream/src/
  redis-client.ts      — Redis 连接工厂（standalone + sentinel）
  stream-registry.ts   — StreamRegistry（publish/resume/exists/invalidate）
  index.ts             — barrel export
```

## 测试策略

- Redis client: mock ioredis，测试配置解析、sentinel endpoint 解析、错误处理
- StreamRegistry: mock resumable-stream context，测试 publish/resume/exists/invalidate 流程
- 目标 ~35 个测试用例
