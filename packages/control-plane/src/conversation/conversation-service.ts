export interface Conversation {
  id: string;
  projectId: string;
  agentId: string | null;
  userId: string;
  title: string | null;
  summary: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateConversationInput {
  projectId: string;
  userId: string;
  agentId?: string;
  title?: string;
  metadata?: unknown;
}

export interface ConversationDb {
  create(input: CreateConversationInput): Promise<Conversation>;
  findById(id: string): Promise<Conversation | null>;
  listByProject(projectId: string, limit?: number): Promise<Conversation[]>;
  updateTitle(id: string, title: string): Promise<Conversation | null>;
  updateSummary(id: string, summary: string): Promise<Conversation | null>;
  remove(id: string): Promise<boolean>;
}

export class ConversationService {
  constructor(private db: ConversationDb) {}

  async create(input: CreateConversationInput): Promise<Conversation> {
    return this.db.create(input);
  }

  async getById(id: string): Promise<Conversation | null> {
    return this.db.findById(id);
  }

  async listByProject(projectId: string, limit = 50): Promise<Conversation[]> {
    return this.db.listByProject(projectId, limit);
  }

  async setTitle(id: string, title: string): Promise<Conversation> {
    const updated = await this.db.updateTitle(id, title);
    if (!updated) throw new Error('Conversation not found');
    return updated;
  }

  async generateTitle(id: string, firstMessage: string): Promise<string> {
    const title = firstMessage.length > 80 ? `${firstMessage.slice(0, 77)}...` : firstMessage;
    await this.setTitle(id, title);
    return title;
  }

  async setSummary(id: string, summary: string): Promise<Conversation> {
    const updated = await this.db.updateSummary(id, summary);
    if (!updated) throw new Error('Conversation not found');
    return updated;
  }

  async remove(id: string): Promise<void> {
    const removed = await this.db.remove(id);
    if (!removed) throw new Error('Conversation not found');
  }
}
