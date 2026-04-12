import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SimpleExtractor } from '../extractor.js';

describe('SimpleExtractor', () => {
  const extractor = new SimpleExtractor();
  const agentId = randomUUID();
  const projectId = randomUUID();

  it('extracts "remember" patterns', async () => {
    const result = await extractor.extract(
      agentId,
      projectId,
      'Remember: the API key is stored in Vault'
    );
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].content).toBe('the API key is stored in Vault');
    expect(result.memories[0].category).toBe('fact');
  });

  it('extracts "prefer" patterns', async () => {
    const result = await extractor.extract(
      agentId,
      projectId,
      'I prefer TypeScript over JavaScript'
    );
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].category).toBe('preference');
  });

  it('extracts "decided" patterns', async () => {
    const result = await extractor.extract(
      agentId,
      projectId,
      'We decided to use pino for logging'
    );
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].category).toBe('decision');
  });

  it('extracts multiple memories from one conversation', async () => {
    const text = `
      Remember: the database is PostgreSQL 16.
      Note: always use parameterized queries.
      We decided to use Drizzle ORM.
    `;
    const result = await extractor.extract(agentId, projectId, text);
    expect(result.memories.length).toBeGreaterThanOrEqual(3);
  });

  it('returns empty for no matches', async () => {
    const result = await extractor.extract(agentId, projectId, 'Just a normal conversation.');
    expect(result.memories).toHaveLength(0);
  });

  it('sets agentId and projectId on extracted memories', async () => {
    const result = await extractor.extract(agentId, projectId, 'Remember: test data');
    expect(result.memories[0].agentId).toBe(agentId);
    expect(result.memories[0].projectId).toBe(projectId);
  });

  it('assigns appropriate importance levels', async () => {
    const result = await extractor.extract(agentId, projectId, 'Important: critical config change');
    expect(result.memories[0].importance).toBe(0.8);
  });
});
