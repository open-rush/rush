import type { CreateMemoryInput, MemoryCategory } from './types.js';

export interface ExtractionResult {
  memories: CreateMemoryInput[];
}

export interface MemoryExtractor {
  extract(agentId: string, projectId: string, conversationText: string): Promise<ExtractionResult>;
}

export class SimpleExtractor implements MemoryExtractor {
  private patterns: Array<{ pattern: RegExp; category: MemoryCategory; importance: number }> = [
    { pattern: /(?:remember|note|important):\s*(.+)/gi, category: 'fact', importance: 0.8 },
    { pattern: /(?:prefer|always|never)\s+(.+)/gi, category: 'preference', importance: 0.7 },
    { pattern: /(?:decided|chose|selected)\s+(.+)/gi, category: 'decision', importance: 0.6 },
  ];

  async extract(
    agentId: string,
    projectId: string,
    conversationText: string
  ): Promise<ExtractionResult> {
    const memories: CreateMemoryInput[] = [];

    for (const { pattern, category, importance } of this.patterns) {
      pattern.lastIndex = 0;
      for (const match of conversationText.matchAll(pattern)) {
        if (match[1]?.trim()) {
          memories.push({
            agentId,
            projectId,
            content: match[1].trim(),
            category,
            importance,
          });
        }
      }
    }

    return { memories };
  }
}
