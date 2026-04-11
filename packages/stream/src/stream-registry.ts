import type Redis from 'ioredis';
import type { ResumableStreamContext } from 'resumable-stream';
import { createResumableStreamContext } from 'resumable-stream/ioredis';
import { createRedisClient, type RedisClientConfig } from './redis-client.js';

export interface StreamRegistryConfig {
  redisConfig?: RedisClientConfig;
  redisUrl?: string;
}

function resolveRedisConfig(config: StreamRegistryConfig): RedisClientConfig | null {
  if (config.redisConfig) return config.redisConfig;
  if (config.redisUrl) return { url: config.redisUrl };
  return null;
}

export class StreamRegistry {
  private context: ResumableStreamContext;
  private publisher: Redis;
  private subscriber: Redis;

  constructor(publisher: Redis, subscriber: Redis, context: ResumableStreamContext) {
    this.publisher = publisher;
    this.subscriber = subscriber;
    this.context = context;
  }

  async createStream(
    streamId: string,
    streamFactory: () => ReadableStream<string>
  ): Promise<ReadableStream<string> | null> {
    return this.context.createNewResumableStream(streamId, streamFactory);
  }

  async resumeOrCreate(
    streamId: string,
    streamFactory: () => ReadableStream<string>,
    skipCharacters?: number
  ): Promise<ReadableStream<string> | null> {
    return this.context.resumableStream(streamId, streamFactory, skipCharacters);
  }

  async resume(
    streamId: string,
    skipCharacters?: number
  ): Promise<ReadableStream<string> | null | undefined> {
    return this.context.resumeExistingStream(streamId, skipCharacters);
  }

  async exists(streamId: string): Promise<boolean> {
    const result = await this.context.hasExistingStream(streamId);
    return result !== null;
  }

  async isDone(streamId: string): Promise<boolean> {
    const result = await this.context.hasExistingStream(streamId);
    return result === 'DONE';
  }

  async invalidate(streamId: string): Promise<void> {
    const sentinelKey = `resumable-stream:sentinel:${streamId}`;
    await this.publisher.del(sentinelKey);
  }

  async close(): Promise<void> {
    await this.publisher.quit();
    await this.subscriber.quit();
  }
}

export function createStreamRegistry(config: StreamRegistryConfig): StreamRegistry | null {
  const redisConfig = resolveRedisConfig(config);
  if (!redisConfig) return null;

  const publisher = createRedisClient(redisConfig);
  if (!publisher) return null;

  const subscriber = createRedisClient(redisConfig, { subscriber: true });
  if (!subscriber) {
    publisher.quit();
    return null;
  }

  const context = createResumableStreamContext({
    waitUntil: null,
    publisher,
    subscriber,
  });

  return new StreamRegistry(publisher, subscriber, context);
}
