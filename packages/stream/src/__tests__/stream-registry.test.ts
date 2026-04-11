import { describe, expect, it, vi } from 'vitest';
import { StreamRegistry } from '../stream-registry.js';

describe('StreamRegistry', () => {
  function createMockContext() {
    return {
      resumableStream: vi.fn().mockResolvedValue(null),
      resumeExistingStream: vi.fn().mockResolvedValue(undefined),
      createNewResumableStream: vi.fn().mockResolvedValue(null),
      hasExistingStream: vi.fn().mockResolvedValue(null),
    };
  }

  function createMockRedis() {
    return {
      quit: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };
  }

  function createTestRegistry() {
    const publisher = createMockRedis();
    const subscriber = createMockRedis();
    const context = createMockContext();
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const registry = new StreamRegistry(publisher as any, subscriber as any, context as any);
    return { registry, publisher, subscriber, context };
  }

  describe('createStream', () => {
    it('calls createNewResumableStream with factory result', async () => {
      const { registry, context } = createTestRegistry();
      const factory = () => new ReadableStream<string>();
      await registry.createStream('stream-1', factory);
      expect(context.createNewResumableStream).toHaveBeenCalledWith('stream-1', factory);
    });
  });

  describe('resumeOrCreate', () => {
    it('calls resumableStream with streamId and factory', async () => {
      const { registry, context } = createTestRegistry();
      const factory = () => new ReadableStream<string>();
      await registry.resumeOrCreate('stream-1', factory);
      expect(context.resumableStream).toHaveBeenCalledWith('stream-1', factory, undefined);
    });

    it('passes skipCharacters', async () => {
      const { registry, context } = createTestRegistry();
      const factory = () => new ReadableStream<string>();
      await registry.resumeOrCreate('stream-1', factory, 100);
      expect(context.resumableStream).toHaveBeenCalledWith('stream-1', factory, 100);
    });
  });

  describe('resume', () => {
    it('returns undefined for non-existent stream', async () => {
      const { registry } = createTestRegistry();
      const result = await registry.resume('non-existent');
      expect(result).toBeUndefined();
    });

    it('returns null when stream is DONE', async () => {
      const { registry, context } = createTestRegistry();
      context.resumeExistingStream.mockResolvedValue(null);
      const result = await registry.resume('done-stream');
      expect(result).toBeNull();
    });

    it('returns ReadableStream when active', async () => {
      const { registry, context } = createTestRegistry();
      const mockStream = new ReadableStream<string>();
      context.resumeExistingStream.mockResolvedValue(mockStream);
      const result = await registry.resume('active-stream');
      expect(result).toBe(mockStream);
    });

    it('passes skipCharacters', async () => {
      const { registry, context } = createTestRegistry();
      await registry.resume('stream-1', 50);
      expect(context.resumeExistingStream).toHaveBeenCalledWith('stream-1', 50);
    });
  });

  describe('exists', () => {
    it('returns false when hasExistingStream returns null', async () => {
      const { registry } = createTestRegistry();
      expect(await registry.exists('ghost')).toBe(false);
    });

    it('returns true when hasExistingStream returns true', async () => {
      const { registry, context } = createTestRegistry();
      context.hasExistingStream.mockResolvedValue(true);
      expect(await registry.exists('active')).toBe(true);
    });

    it('returns true when hasExistingStream returns "DONE"', async () => {
      const { registry, context } = createTestRegistry();
      context.hasExistingStream.mockResolvedValue('DONE');
      expect(await registry.exists('done')).toBe(true);
    });
  });

  describe('isDone', () => {
    it('returns false for active stream', async () => {
      const { registry, context } = createTestRegistry();
      context.hasExistingStream.mockResolvedValue(true);
      expect(await registry.isDone('active')).toBe(false);
    });

    it('returns true for DONE stream', async () => {
      const { registry, context } = createTestRegistry();
      context.hasExistingStream.mockResolvedValue('DONE');
      expect(await registry.isDone('done')).toBe(true);
    });

    it('returns false for non-existent stream', async () => {
      const { registry } = createTestRegistry();
      expect(await registry.isDone('ghost')).toBe(false);
    });
  });

  describe('invalidate', () => {
    it('deletes sentinel key from Redis', async () => {
      const { registry, publisher } = createTestRegistry();
      await registry.invalidate('stale-stream');
      expect(publisher.del).toHaveBeenCalledWith('resumable-stream:sentinel:stale-stream');
    });
  });

  describe('close', () => {
    it('quits both publisher and subscriber', async () => {
      const { registry, publisher, subscriber } = createTestRegistry();
      await registry.close();
      expect(publisher.quit).toHaveBeenCalled();
      expect(subscriber.quit).toHaveBeenCalled();
    });
  });
});
