export interface RateLimiterConfig {
  maxRequestsPerMinute: number;
}

export class RateLimiter {
  private timestamps: number[] = [];

  constructor(private config: RateLimiterConfig) {}

  tryAcquire(): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;

    this.timestamps = this.timestamps.filter((ts) => ts > windowStart);

    if (this.timestamps.length >= this.config.maxRequestsPerMinute) {
      return false;
    }

    this.timestamps.push(now);
    return true;
  }

  getRemaining(): number {
    const now = Date.now();
    const windowStart = now - 60_000;
    const active = this.timestamps.filter((ts) => ts > windowStart).length;
    return Math.max(0, this.config.maxRequestsPerMinute - active);
  }

  getRetryAfterMs(): number {
    if (this.timestamps.length === 0) return 0;
    const now = Date.now();
    const oldest = this.timestamps[0];
    const expiry = oldest + 60_000;
    return Math.max(0, expiry - now);
  }

  reset(): void {
    this.timestamps = [];
  }
}
