import Redis, { type RedisOptions } from 'ioredis';

export interface SentinelEndpoint {
  host: string;
  port: number;
}

export interface RedisClientConfig {
  url?: string;
  sentinels?: string;
  masterName?: string;
  password?: string;
}

export interface CreateRedisClientOptions {
  subscriber?: boolean;
}

export function createRedisOptions(overrides?: Partial<RedisOptions>): RedisOptions {
  return {
    enableOfflineQueue: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 3,
    ...overrides,
  };
}

export function parseSentinelEndpoints(sentinelsStr: string): SentinelEndpoint[] {
  return sentinelsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [host, portStr] = s.split(':');
      return { host, port: Number.parseInt(portStr || '26379', 10) };
    });
}

export function hasSentinelConfig(config: RedisClientConfig): boolean {
  return Boolean(config.sentinels && config.masterName);
}

export function hasStandaloneConfig(config: RedisClientConfig): boolean {
  return Boolean(config.url);
}

export function createRedisClient(
  config: RedisClientConfig,
  options?: CreateRedisClientOptions
): Redis | null {
  const baseOptions = createRedisOptions(
    options?.subscriber ? { maxRetriesPerRequest: null } : undefined
  );

  try {
    if (hasSentinelConfig(config)) {
      const sentinels = parseSentinelEndpoints(config.sentinels!);
      return new Redis({
        ...baseOptions,
        sentinels,
        name: config.masterName,
        password: config.password,
        sentinelPassword: config.password,
      });
    }

    if (hasStandaloneConfig(config)) {
      return new Redis(config.url!, baseOptions);
    }

    return null;
  } catch {
    return null;
  }
}
