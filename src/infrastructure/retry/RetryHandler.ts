export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors?: string[];
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableErrors: ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EAI_AGAIN'],
};

export class RetryHandler {
  private options: RetryOptions;

  constructor(options?: Partial<RetryOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async execute<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === this.options.maxRetries) break;
        if (!this.isRetryable(lastError)) break;

        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private isRetryable(error: Error): boolean {
    const code = (error as any).code;
    if (code && this.options.retryableErrors?.includes(code)) return true;

    const status = (error as any).statusCode;
    if (status && (status === 502 || status === 503 || status === 504)) return true;

    const msg = error.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('econnreset')) return true;

    return false;
  }

  private calculateDelay(attempt: number): number {
    const exponential = this.options.baseDelayMs * Math.pow(2, attempt);
    return Math.min(exponential, this.options.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
