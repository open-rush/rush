import type { RunEvent } from '@lux/contracts';
import { describe, expect, it } from 'vitest';
import { reconstructMessages } from '../conversation/reconstruct-messages.js';

function makeEvent(seq: number, payload: Record<string, unknown>): RunEvent {
  return {
    id: `evt-${seq}`,
    runId: 'run-1',
    eventType: payload.type as string,
    payload,
    seq,
    schemaVersion: '1',
    createdAt: new Date('2026-01-01'),
  };
}

describe('reconstructMessages', () => {
  it('creates user message from prompt', () => {
    const messages = reconstructMessages('Hello', []);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello');
  });

  it('accumulates text-delta events into assistant message', () => {
    const events = [
      makeEvent(0, { type: 'text-delta', content: 'Hello' }),
      makeEvent(1, { type: 'text-delta', content: ' World' }),
      makeEvent(2, { type: 'finish', reason: 'end_turn' }),
    ];
    const messages = reconstructMessages('Hi', events);
    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('Hello World');
  });

  it('tracks tool calls with input and output', () => {
    const events = [
      makeEvent(0, { type: 'tool-input-start', toolName: 'Bash' }),
      makeEvent(1, { type: 'tool-input-available', input: { command: 'ls' } }),
      makeEvent(2, { type: 'tool-output-available', output: 'file1.ts\nfile2.ts' }),
      makeEvent(3, { type: 'text-delta', content: 'Done!' }),
    ];
    const messages = reconstructMessages('List files', events);
    expect(messages[1].toolCalls).toHaveLength(1);
    expect(messages[1].toolCalls[0].toolName).toBe('Bash');
    expect(messages[1].toolCalls[0].output).toBe('file1.ts\nfile2.ts');
    expect(messages[1].content).toBe('Done!');
  });

  it('handles tool errors', () => {
    const events = [
      makeEvent(0, { type: 'tool-input-start', toolName: 'Read' }),
      makeEvent(1, { type: 'tool-input-available', input: { file_path: '/missing' } }),
      makeEvent(2, { type: 'tool-output-error', errorText: 'File not found' }),
    ];
    const messages = reconstructMessages('Read file', events);
    expect(messages[1].toolCalls[0].error).toBe('File not found');
    expect(messages[1].toolCalls[0].output).toBeNull();
  });

  it('handles multiple tool calls', () => {
    const events = [
      makeEvent(0, { type: 'tool-input-start', toolName: 'Bash' }),
      makeEvent(1, { type: 'tool-input-available', input: { command: 'pwd' } }),
      makeEvent(2, { type: 'tool-output-available', output: '/home' }),
      makeEvent(3, { type: 'tool-input-start', toolName: 'Read' }),
      makeEvent(4, { type: 'tool-input-available', input: { file_path: '/home/file.ts' } }),
      makeEvent(5, { type: 'tool-output-available', output: 'content' }),
      makeEvent(6, { type: 'text-delta', content: 'Found it.' }),
    ];
    const messages = reconstructMessages('Find', events);
    expect(messages[1].toolCalls).toHaveLength(2);
    expect(messages[1].toolCalls[0].toolName).toBe('Bash');
    expect(messages[1].toolCalls[1].toolName).toBe('Read');
  });

  it('handles empty events (no assistant response)', () => {
    const messages = reconstructMessages('Hello', []);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });
});
