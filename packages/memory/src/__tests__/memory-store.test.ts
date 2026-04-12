import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EmbeddingProvider, MemoryDb } from '../memory-store.js';
import { MemoryStore } from '../memory-store.js';
import type { MemoryEntry, MemorySearchResult } from '../types.js';

class MockEmbedding implements EmbeddingProvider {
  dimensions = 3;
  async embed(_text: string): Promise<number[]> {
    return [Math.random(), Math.random(), Math.random()];
  }
}

class InMemoryMemoryDb implements MemoryDb {
  private entries = new Map<string, MemoryEntry>();

  async insert(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'accessedAt'>): Promise<MemoryEntry> {
    const full: MemoryEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: new Date(),
      accessedAt: new Date(),
    };
    this.entries.set(full.id, full);
    return full;
  }

  async findById(id: string): Promise<MemoryEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async vectorSearch(
    agentId: string,
    projectId: string,
    _embedding: number[],
    limit: number
  ): Promise<MemorySearchResult[]> {
    return Array.from(this.entries.values())
      .filter((e) => e.agentId === agentId && e.projectId === projectId)
      .slice(0, limit)
      .map((entry) => ({ entry, score: 0.8, matchType: 'vector' as const }));
  }

  async textSearch(
    agentId: string,
    projectId: string,
    query: string,
    limit: number
  ): Promise<MemorySearchResult[]> {
    return Array.from(this.entries.values())
      .filter(
        (e) =>
          e.agentId === agentId &&
          e.projectId === projectId &&
          e.content.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, limit)
      .map((entry) => ({ entry, score: 0.6, matchType: 'text' as const }));
  }

  async listByAgent(agentId: string, projectId: string, limit = 50): Promise<MemoryEntry[]> {
    return Array.from(this.entries.values())
      .filter((e) => e.agentId === agentId && e.projectId === projectId)
      .slice(0, limit);
  }

  async remove(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  async updateAccessedAt(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry) entry.accessedAt = new Date();
  }
}

describe('MemoryStore', () => {
  let store: MemoryStore;
  const agentId = randomUUID();
  const projectId = randomUUID();

  beforeEach(() => {
    store = new MemoryStore(new InMemoryMemoryDb(), new MockEmbedding());
  });

  describe('add', () => {
    it('creates a memory entry', async () => {
      const entry = await store.add({ agentId, projectId, content: 'User prefers TypeScript' });
      expect(entry.id).toBeDefined();
      expect(entry.content).toBe('User prefers TypeScript');
      expect(entry.category).toBe('fact');
      expect(entry.embedding).toBeDefined();
    });

    it('supports custom category and importance', async () => {
      const entry = await store.add({
        agentId,
        projectId,
        content: 'Always use strict mode',
        category: 'preference',
        importance: 0.9,
      });
      expect(entry.category).toBe('preference');
      expect(entry.importance).toBe(0.9);
    });
  });

  describe('search', () => {
    it('returns hybrid search results', async () => {
      await store.add({ agentId, projectId, content: 'User prefers TypeScript' });
      await store.add({ agentId, projectId, content: 'Project uses React' });

      const results = await store.search({ agentId, projectId, query: 'TypeScript' });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('respects limit', async () => {
      for (let i = 0; i < 10; i++) {
        await store.add({ agentId, projectId, content: `Memory ${i}` });
      }
      const results = await store.search({ agentId, projectId, query: 'memory', limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('filters by category', async () => {
      await store.add({ agentId, projectId, content: 'A fact', category: 'fact' });
      await store.add({ agentId, projectId, content: 'A preference', category: 'preference' });

      const results = await store.search({
        agentId,
        projectId,
        query: 'something',
        categories: ['preference'],
      });
      for (const r of results) {
        expect(r.entry.category).toBe('preference');
      }
    });
  });

  describe('getById', () => {
    it('returns entry by id', async () => {
      const created = await store.add({ agentId, projectId, content: 'Test' });
      const found = await store.getById(created.id);
      expect(found?.content).toBe('Test');
    });

    it('returns null for non-existent', async () => {
      expect(await store.getById(randomUUID())).toBeNull();
    });
  });

  describe('listByAgent', () => {
    it('lists memories for agent', async () => {
      await store.add({ agentId, projectId, content: 'M1' });
      await store.add({ agentId, projectId, content: 'M2' });
      const list = await store.listByAgent(agentId, projectId);
      expect(list).toHaveLength(2);
    });
  });

  describe('remove', () => {
    it('removes entry', async () => {
      const created = await store.add({ agentId, projectId, content: 'To remove' });
      await store.remove(created.id);
      expect(await store.getById(created.id)).toBeNull();
    });

    it('throws for non-existent', async () => {
      await expect(store.remove(randomUUID())).rejects.toThrow('not found');
    });
  });
});
