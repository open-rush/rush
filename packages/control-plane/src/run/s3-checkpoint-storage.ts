import type { CheckpointStorage } from './checkpoint-service.js';

/**
 * S3-backed checkpoint storage adapter.
 * Wraps any object that has upload/download methods (e.g. @lux/integrations StorageService).
 */
export interface S3StorageAdapter {
  upload(key: string, body: Buffer | Uint8Array, options?: { contentType?: string }): Promise<void>;
  download(key: string): Promise<Buffer>;
}

export class S3CheckpointStorage implements CheckpointStorage {
  constructor(
    private storage: S3StorageAdapter,
    private prefix = 'checkpoints'
  ) {}

  async uploadSnapshot(runId: string, data: Buffer): Promise<string> {
    const key = `${this.prefix}/${runId}/${Date.now()}-messages.json`;
    await this.storage.upload(key, data, { contentType: 'application/json' });
    return key;
  }

  async downloadSnapshot(ref: string): Promise<Buffer> {
    return this.storage.download(ref);
  }
}
