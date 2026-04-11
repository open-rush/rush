export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs?: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterMs: 500,
};

export type ErrorClassification = 'retryable' | 'fatal' | 'budget_exceeded';

export function classifyError(error: unknown): ErrorClassification {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('rate_limit') ||
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('too many requests')
    )
      return 'retryable';
    if (msg.includes('budget') || msg.includes('token limit') || msg.includes('cost limit'))
      return 'budget_exceeded';
    if (msg.includes('invalid api key') || msg.includes('authentication')) return 'fatal';
    if (msg.includes('invalid_api_key') || msg.includes('permission_denied')) return 'fatal';
    if (msg.includes('timeout') || msg.includes('econnreset') || msg.includes('enotfound'))
      return 'retryable';
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('529'))
      return 'retryable';
    if (msg.includes('overloaded')) return 'retryable';
  }
  return 'fatal';
}

export function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponential = Math.min(config.baseDelayMs * 2 ** attempt, config.maxDelayMs);
  const jitter = config.jitterMs ? Math.random() * config.jitterMs : 0;
  return exponential + jitter;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const classification = classifyError(error);

      if (classification === 'fatal' || classification === 'budget_exceeded') {
        throw error;
      }

      if (attempt < config.maxRetries) {
        const delay = calculateDelay(attempt, config);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
