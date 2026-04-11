import { describe, expect, it } from 'vitest';
import {
  createRedisOptions,
  hasSentinelConfig,
  hasStandaloneConfig,
  parseSentinelEndpoints,
} from '../redis-client.js';

describe('parseSentinelEndpoints', () => {
  it('parses single endpoint', () => {
    const result = parseSentinelEndpoints('host1:26379');
    expect(result).toEqual([{ host: 'host1', port: 26379 }]);
  });

  it('parses multiple endpoints', () => {
    const result = parseSentinelEndpoints('host1:26379,host2:26380,host3:26381');
    expect(result).toHaveLength(3);
    expect(result[1]).toEqual({ host: 'host2', port: 26380 });
  });

  it('defaults port to 26379 if missing', () => {
    const result = parseSentinelEndpoints('host1');
    expect(result[0].port).toBe(26379);
  });

  it('handles whitespace around entries', () => {
    const result = parseSentinelEndpoints(' host1:26379 , host2:26380 ');
    expect(result).toHaveLength(2);
    expect(result[0].host).toBe('host1');
  });

  it('filters empty strings', () => {
    const result = parseSentinelEndpoints('host1:26379,,host2:26380');
    expect(result).toHaveLength(2);
  });

  it('returns empty array for empty string', () => {
    const result = parseSentinelEndpoints('');
    expect(result).toHaveLength(0);
  });
});

describe('hasSentinelConfig', () => {
  it('returns true when both sentinels and masterName present', () => {
    expect(hasSentinelConfig({ sentinels: 'host:26379', masterName: 'mymaster' })).toBe(true);
  });

  it('returns false when only sentinels present', () => {
    expect(hasSentinelConfig({ sentinels: 'host:26379' })).toBe(false);
  });

  it('returns false when only masterName present', () => {
    expect(hasSentinelConfig({ masterName: 'mymaster' })).toBe(false);
  });

  it('returns false for empty config', () => {
    expect(hasSentinelConfig({})).toBe(false);
  });
});

describe('hasStandaloneConfig', () => {
  it('returns true when url present', () => {
    expect(hasStandaloneConfig({ url: 'redis://localhost:6379' })).toBe(true);
  });

  it('returns false when url missing', () => {
    expect(hasStandaloneConfig({})).toBe(false);
  });

  it('returns false for empty url', () => {
    expect(hasStandaloneConfig({ url: '' })).toBe(false);
  });
});

describe('createRedisOptions', () => {
  it('returns default options', () => {
    const opts = createRedisOptions();
    expect(opts.enableOfflineQueue).toBe(true);
    expect(opts.connectTimeout).toBe(5000);
    expect(opts.maxRetriesPerRequest).toBe(3);
  });

  it('merges overrides', () => {
    const opts = createRedisOptions({ connectTimeout: 10000 });
    expect(opts.connectTimeout).toBe(10000);
    expect(opts.enableOfflineQueue).toBe(true);
  });

  it('allows null maxRetriesPerRequest for subscriber', () => {
    const opts = createRedisOptions({ maxRetriesPerRequest: null });
    expect(opts.maxRetriesPerRequest).toBeNull();
  });
});
