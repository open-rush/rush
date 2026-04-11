import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { getRequestContext } from './context.js';

const DEFAULT_REDACT_PATHS = [
  'authorization',
  'cookie',
  'token',
  'password',
  'apiKey',
  'secret',
  'credentials',
  '*.authorization',
  '*.cookie',
  '*.token',
  '*.password',
  '*.apiKey',
  '*.secret',
  '*.credentials',
];

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  redact?: string[];
  version?: string;
  destination?: DestinationStream;
}

export function createLogger(opts: CreateLoggerOptions): Logger {
  const isDev = process.env.NODE_ENV === 'development';
  const level = opts.level ?? process.env.LOG_LEVEL ?? 'info';

  const redactPaths = [...DEFAULT_REDACT_PATHS, ...(opts.redact ?? [])];

  const pinoOpts: LoggerOptions = {
    level,
    base: {
      service: opts.service,
      env: process.env.NODE_ENV ?? 'development',
      ...(opts.version ? { version: opts.version } : {}),
    },
    redact: {
      paths: redactPaths,
      censor: '[REDACTED]',
    },
    mixin() {
      const ctx = getRequestContext();
      if (!ctx) return {};
      const fields: Record<string, string> = {
        requestId: ctx.requestId,
      };
      if (ctx.runId) fields.runId = ctx.runId;
      if (ctx.agentId) fields.agentId = ctx.agentId;
      if (ctx.sandboxId) fields.sandboxId = ctx.sandboxId;
      return fields;
    },
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true },
          },
        }
      : {}),
  };

  if (opts.destination) {
    return pino(pinoOpts, opts.destination);
  }
  return pino(pinoOpts);
}
