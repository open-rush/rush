import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type Conversation,
  type ConversationDb,
  ConversationService,
  type CreateConversationInput,
} from '../conversation/conversation-service.js';

class InMemoryConversationDb implements ConversationDb {
  private conversations = new Map<string, Conversation>();

  async create(input: CreateConversationInput): Promise<Conversation> {
    const now = new Date();
    const conv: Conversation = {
      id: randomUUID(),
      projectId: input.projectId,
      agentId: input.agentId ?? null,
      userId: input.userId,
      title: input.title ?? null,
      summary: null,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(conv.id, conv);
    return conv;
  }

  async findById(id: string): Promise<Conversation | null> {
    return this.conversations.get(id) ?? null;
  }

  async listByProject(projectId: string, limit = 50): Promise<Conversation[]> {
    return Array.from(this.conversations.values())
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async updateTitle(id: string, title: string): Promise<Conversation | null> {
    const conv = this.conversations.get(id);
    if (!conv) return null;
    conv.title = title;
    conv.updatedAt = new Date();
    return conv;
  }

  async updateSummary(id: string, summary: string): Promise<Conversation | null> {
    const conv = this.conversations.get(id);
    if (!conv) return null;
    conv.summary = summary;
    conv.updatedAt = new Date();
    return conv;
  }

  async remove(id: string): Promise<boolean> {
    return this.conversations.delete(id);
  }
}

describe('ConversationService', () => {
  let service: ConversationService;
  const projectId = randomUUID();
  const userId = randomUUID();

  beforeEach(() => {
    service = new ConversationService(new InMemoryConversationDb());
  });

  describe('create', () => {
    it('creates a conversation', async () => {
      const conv = await service.create({ projectId, userId });
      expect(conv.projectId).toBe(projectId);
      expect(conv.userId).toBe(userId);
      expect(conv.title).toBeNull();
    });

    it('creates with optional fields', async () => {
      const agentId = randomUUID();
      const conv = await service.create({ projectId, userId, agentId, title: 'My Chat' });
      expect(conv.agentId).toBe(agentId);
      expect(conv.title).toBe('My Chat');
    });
  });

  describe('getById', () => {
    it('returns conversation', async () => {
      const created = await service.create({ projectId, userId });
      const found = await service.getById(created.id);
      expect(found?.id).toBe(created.id);
    });

    it('returns null for non-existent', async () => {
      expect(await service.getById(randomUUID())).toBeNull();
    });
  });

  describe('listByProject', () => {
    it('lists conversations for a project', async () => {
      await service.create({ projectId, userId });
      await service.create({ projectId, userId });
      await service.create({ projectId: randomUUID(), userId });
      const list = await service.listByProject(projectId);
      expect(list).toHaveLength(2);
    });

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await service.create({ projectId, userId });
      }
      const list = await service.listByProject(projectId, 3);
      expect(list).toHaveLength(3);
    });
  });

  describe('setTitle', () => {
    it('updates title', async () => {
      const conv = await service.create({ projectId, userId });
      const updated = await service.setTitle(conv.id, 'New Title');
      expect(updated.title).toBe('New Title');
    });

    it('throws for non-existent', async () => {
      await expect(service.setTitle(randomUUID(), 'X')).rejects.toThrow('not found');
    });
  });

  describe('generateTitle', () => {
    it('generates title from short message', async () => {
      const conv = await service.create({ projectId, userId });
      const title = await service.generateTitle(conv.id, 'Help me build a todo app');
      expect(title).toBe('Help me build a todo app');
    });

    it('truncates long messages', async () => {
      const conv = await service.create({ projectId, userId });
      const longMsg = 'x'.repeat(100);
      const title = await service.generateTitle(conv.id, longMsg);
      expect(title).toHaveLength(80);
      expect(title.endsWith('...')).toBe(true);
    });
  });

  describe('setSummary', () => {
    it('sets summary', async () => {
      const conv = await service.create({ projectId, userId });
      const updated = await service.setSummary(conv.id, 'Built a todo app with React');
      expect(updated.summary).toBe('Built a todo app with React');
    });
  });

  describe('remove', () => {
    it('removes conversation', async () => {
      const conv = await service.create({ projectId, userId });
      await service.remove(conv.id);
      expect(await service.getById(conv.id)).toBeNull();
    });

    it('throws for non-existent', async () => {
      await expect(service.remove(randomUUID())).rejects.toThrow('not found');
    });
  });
});
