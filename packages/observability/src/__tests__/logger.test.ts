import { describe, expect, it } from 'vitest';
import { withRequestContext } from '../context.js';
import { createLogger } from '../logger.js';

function collectLogs() {
  const chunks: string[] = [];
  const dest = {
    write(chunk: string) {
      chunks.push(chunk);
    },
  };
  return { chunks, dest };
}

describe('createLogger', () => {
  it('creates a pino logger with expected methods', () => {
    const logger = createLogger({ service: 'test-service' });
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('respects custom log level', () => {
    const logger = createLogger({ service: 'test', level: 'warn' });
    expect(logger.level).toBe('warn');
  });

  it('defaults to info level', () => {
    const logger = createLogger({ service: 'test' });
    expect(logger.level).toBe('info');
  });

  it('includes service in base fields', () => {
    const { chunks, dest } = collectLogs();
    const logger = createLogger({ service: 'my-service', destination: dest });
    logger.info('hello');

    const parsed = JSON.parse(chunks[0]);
    expect(parsed.service).toBe('my-service');
    expect(parsed.msg).toBe('hello');
  });

  it('enriches logs with request context via mixin', () => {
    const { chunks, dest } = collectLogs();
    const logger = createLogger({ service: 'test', destination: dest });

    withRequestContext({ requestId: 'req-mixin-test', service: 'web', runId: 'run-42' }, () => {
      logger.info('hello from context');
    });

    expect(chunks.length).toBe(1);
    const parsed = JSON.parse(chunks[0]);
    expect(parsed.requestId).toBe('req-mixin-test');
    expect(parsed.runId).toBe('run-42');
    expect(parsed.msg).toBe('hello from context');
  });

  it('produces clean logs without context', () => {
    const { chunks, dest } = collectLogs();
    const logger = createLogger({ service: 'test', destination: dest });
    logger.info('no context');

    expect(chunks.length).toBe(1);
    const parsed = JSON.parse(chunks[0]);
    expect(parsed.requestId).toBeUndefined();
    expect(parsed.msg).toBe('no context');
  });

  it('redacts sensitive fields by default', () => {
    const { chunks, dest } = collectLogs();
    const logger = createLogger({ service: 'test', destination: dest });
    logger.info({ password: 'secret123', token: 'abc' }, 'login attempt');

    const parsed = JSON.parse(chunks[0]);
    expect(parsed.password).toBe('[REDACTED]');
    expect(parsed.token).toBe('[REDACTED]');
  });

  it('redacts nested sensitive fields', () => {
    const { chunks, dest } = collectLogs();
    const logger = createLogger({ service: 'test', destination: dest });
    logger.info({ headers: { authorization: 'Bearer xxx', cookie: 'session=abc' } }, 'request');

    const parsed = JSON.parse(chunks[0]);
    expect(parsed.headers.authorization).toBe('[REDACTED]');
    expect(parsed.headers.cookie).toBe('[REDACTED]');
  });

  it('supports custom redact paths', () => {
    const { chunks, dest } = collectLogs();
    const logger = createLogger({ service: 'test', redact: ['customSecret'], destination: dest });
    logger.info({ customSecret: 'my-secret', password: 'also-secret' }, 'custom');

    const parsed = JSON.parse(chunks[0]);
    expect(parsed.customSecret).toBe('[REDACTED]');
    expect(parsed.password).toBe('[REDACTED]');
  });

  it('includes optional domain IDs from context', () => {
    const { chunks, dest } = collectLogs();
    const logger = createLogger({ service: 'test', destination: dest });

    withRequestContext(
      {
        requestId: 'req-1',
        service: 'control-worker',
        runId: 'run-1',
        agentId: 'agent-1',
        sandboxId: 'sbx-1',
      },
      () => {
        logger.info('with domain ids');
      }
    );

    const parsed = JSON.parse(chunks[0]);
    expect(parsed.runId).toBe('run-1');
    expect(parsed.agentId).toBe('agent-1');
    expect(parsed.sandboxId).toBe('sbx-1');
  });
});
