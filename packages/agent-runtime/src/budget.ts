export interface BudgetConfig {
  maxTokens?: number;
  maxCostCents?: number;
  maxDurationMs?: number;
}

export interface BudgetUsage {
  tokens: number;
  costCents: number;
  startedAt: number;
}

export type BudgetExceededReason = 'token_limit' | 'cost_limit' | 'duration_limit';

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: BudgetExceededReason;
  usage: BudgetUsage;
}

export class BudgetGuard {
  private usage: BudgetUsage;

  constructor(private config: BudgetConfig) {
    this.usage = { tokens: 0, costCents: 0, startedAt: Date.now() };
  }

  record(tokens: number, costCents: number): void {
    this.usage.tokens += tokens;
    this.usage.costCents += costCents;
  }

  check(): BudgetCheckResult {
    if (this.config.maxTokens !== undefined && this.usage.tokens >= this.config.maxTokens) {
      return { allowed: false, reason: 'token_limit', usage: this.getUsage() };
    }

    if (
      this.config.maxCostCents !== undefined &&
      this.usage.costCents >= this.config.maxCostCents
    ) {
      return { allowed: false, reason: 'cost_limit', usage: this.getUsage() };
    }

    if (this.config.maxDurationMs !== undefined) {
      const elapsed = Date.now() - this.usage.startedAt;
      if (elapsed >= this.config.maxDurationMs) {
        return { allowed: false, reason: 'duration_limit', usage: this.getUsage() };
      }
    }

    return { allowed: true, usage: this.getUsage() };
  }

  getUsage(): BudgetUsage {
    return { ...this.usage };
  }

  reset(): void {
    this.usage = { tokens: 0, costCents: 0, startedAt: Date.now() };
  }
}
