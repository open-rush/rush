export interface MemoryEntry {
  id: string;
  agentId: string;
  projectId: string;
  content: string;
  embedding: number[] | null;
  category: MemoryCategory;
  importance: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  accessedAt: Date;
}

export type MemoryCategory = 'fact' | 'preference' | 'context' | 'skill' | 'decision';

export interface CreateMemoryInput {
  agentId: string;
  projectId: string;
  content: string;
  category?: MemoryCategory;
  importance?: number;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchOptions {
  agentId: string;
  projectId: string;
  query: string;
  limit?: number;
  minScore?: number;
  categories?: MemoryCategory[];
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  matchType: 'vector' | 'text' | 'hybrid';
}
