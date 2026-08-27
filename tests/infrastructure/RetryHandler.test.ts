import { RetryHandler } from '../../src/infrastructure/retry/RetryHandler';

describe('RetryHandler', () => {
  test('should succeed on first attempt', async () => {
    const handler = new RetryHandler({ maxRetries: 3, baseDelayMs: 1 });
    const result = await handler.execute(async () => 'ok', 'test');
    expect(result).toBe('ok');
  });

  test('should retry on retryable error and succeed', async () => {
    const handler = new RetryHandler({ maxRetries: 3, baseDelayMs: 1 });
    let attempts = 0;
    const result = await handler.execute(async () => {
      attempts++;
      if (attempts < 3) {
        const err = new Error('connection reset');
        (err as any).code = 'ECONNRESET';
        throw err;
      }
      return 'recovered';
    }, 'test');
    expect(result).toBe('recovered');
    expect(attempts).toBe(3);
  });

  test('should throw after exhausting retries', async () => {
    const handler = new RetryHandler({ maxRetries: 2, baseDelayMs: 1 });
    const err = new Error('timeout');
    (err as any).code = 'ETIMEDOUT';
    await expect(
      handler.execute(async () => { throw err; }, 'test')
    ).rejects.toThrow('timeout');
  });

  test('should not retry on non-retryable error', async () => {
    const handler = new RetryHandler({ maxRetries: 3, baseDelayMs: 1 });
    let attempts = 0;
    await expect(
      handler.execute(async () => {
        attempts++;
        throw new Error('validation failed');
      }, 'test')
    ).rejects.toThrow('validation failed');
    expect(attempts).toBe(1);
  });

  test('should retry on 503 status code', async () => {
    const handler = new RetryHandler({ maxRetries: 2, baseDelayMs: 1 });
    let attempts = 0;
    const result = await handler.execute(async () => {
      attempts++;
      if (attempts === 1) {
        const err = new Error('Service Unavailable');
        (err as any).statusCode = 503;
        throw err;
      }
      return 'ok';
    }, 'test');
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  test('should retry on timeout message', async () => {
    const handler = new RetryHandler({ maxRetries: 2, baseDelayMs: 1 });
    let attempts = 0;
    const result = await handler.execute(async () => {
      attempts++;
      if (attempts === 1) throw new Error('Request timeout after 30000ms');
      return 'ok';
    }, 'test');
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });
});
