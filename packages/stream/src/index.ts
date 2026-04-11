export {
  type CreateRedisClientOptions,
  createRedisClient,
  createRedisOptions,
  hasSentinelConfig,
  hasStandaloneConfig,
  parseSentinelEndpoints,
  type RedisClientConfig,
  type SentinelEndpoint,
} from './redis-client.js';

export {
  createStreamRegistry,
  StreamRegistry,
  type StreamRegistryConfig,
} from './stream-registry.js';
