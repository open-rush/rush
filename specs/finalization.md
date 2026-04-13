# Finalization Specification

Run 完成后的产物收集和持久化。

## 流程

```
running → finalizing_prepare
  ↓ checkpoint 创建（events snapshot → S3）
finalizing_uploading
  ↓ workspace artifacts 上传（TODO）
finalizing_verifying
  ↓ checksum 验证（TODO）
finalizing_metadata_commit
  ↓ PR 创建 / metadata 写入（TODO）
finalized → completed
```

## Checkpoint 创建

RunOrchestrator.finalize() 在 finalizing_prepare 阶段：
1. 从 EventStore 读取所有事件
2. 序列化为 JSON Buffer
3. 通过 CheckpointService.createCheckpoint() 上传到 S3
4. 记录 lastEventSeq 到 run_checkpoints 表

Checkpoint 失败不阻塞 finalization（non-fatal，日志告警）。

## 存储层

- **DrizzleCheckpointDb**: run_checkpoints 表的 Drizzle 实现
- **S3CheckpointStorage**: 适配 @lux/integrations StorageService → CheckpointStorage 接口
  - Key 格式: `checkpoints/{runId}/{timestamp}-messages.json`

## 后续增强（TODO）

- Workspace snapshot 上传到 S3
- Git diff 导出 + PR 创建
- Artifact checksum 验证
- Finalization 失败重试（finalizing_retryable_failed 路径）
