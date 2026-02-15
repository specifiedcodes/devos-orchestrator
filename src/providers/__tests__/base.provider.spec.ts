/**
 * BaseProvider Tests
 *
 * Tests for retry logic, timeout handling, rate limiting,
 * latency measurement, and cost calculation.
 *
 * Story 13-1: Provider Abstraction Layer
 */

import { BaseProvider } from '../base.provider';
import {
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ProviderHealthStatus,
  ProviderConfig,
  ModelPricing,
  ProviderError,
  TokenUsage,
} from '../interfaces';

/**
 * Concrete test implementation of BaseProvider for testing abstract methods
 */
class TestProvider extends BaseProvider {
  public executeCompleteFn: jest.Mock;
  public executeStreamFn: jest.Mock;
  public executeEmbedFn: jest.Mock;
  public executeHealthCheckFn: jest.Mock;
  public mapErrorFn: jest.Mock;

  constructor(config: Partial<ProviderConfig> = {}) {
    super({
      id: 'anthropic',
      name: 'Test Provider',
      enabled: true,
      maxRetries: 3,
      retryDelayMs: 100,
      timeoutMs: 5000,
      ...config,
    });

    this.executeCompleteFn = jest.fn();
    this.executeStreamFn = jest.fn();
    this.executeEmbedFn = jest.fn();
    this.executeHealthCheckFn = jest.fn();
    this.mapErrorFn = jest.fn();
  }

  protected async executeComplete(
    request: CompletionRequest,
    apiKey: string,
  ): Promise<CompletionResponse> {
    return this.executeCompleteFn(request, apiKey);
  }

  protected async executeStream(
    request: CompletionRequest,
    apiKey: string,
  ): Promise<AsyncIterable<StreamChunk>> {
    return this.executeStreamFn(request, apiKey);
  }

  protected async executeEmbed(
    text: string,
    model: string,
    apiKey: string,
  ): Promise<number[]> {
    return this.executeEmbedFn(text, model, apiKey);
  }

  protected async executeHealthCheck(
    apiKey: string,
  ): Promise<ProviderHealthStatus> {
    return this.executeHealthCheckFn(apiKey);
  }

  mapError(error: unknown): ProviderError {
    if (this.mapErrorFn.getMockImplementation()) {
      return this.mapErrorFn(error);
    }
    return new ProviderError(
      error instanceof Error ? error.message : 'Unknown error',
      'unknown_error',
      this.id,
    );
  }

  getModelPricing(model: string): ModelPricing {
    return { inputPer1M: 3.00, outputPer1M: 15.00, cachedInputPer1M: 0.30 };
  }

  supportsModel(modelId: string): boolean {
    return modelId === 'test-model';
  }

  // Expose protected methods for testing
  public testWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    return this.withRetry(fn);
  }

  public testWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return this.withTimeout(fn);
  }

  public testUpdateRateLimits(info: any): void {
    return this.updateRateLimits(info);
  }
}

describe('BaseProvider', () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider();
    jest.useFakeTimers({ advanceTimers: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('retry logic', () => {
    it('should retry on retryable errors up to maxRetries', async () => {
      const retryableError = new ProviderError(
        'Rate limited',
        'rate_limit_error',
        'anthropic',
        429,
        true,
      );

      let callCount = 0;
      const fn = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 4) {
          throw retryableError;
        }
        return 'success';
      });

      const promise = provider.testWithRetry(fn);

      // Advance timers for retries
      await jest.advanceTimersByTimeAsync(100); // Retry 1 (100ms)
      await jest.advanceTimersByTimeAsync(200); // Retry 2 (200ms)
      await jest.advanceTimersByTimeAsync(400); // Retry 3 (400ms)

      const result = await promise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should use exponential backoff', async () => {
      const retryableError = new ProviderError(
        'Rate limited',
        'rate_limit_error',
        'anthropic',
        429,
        true,
      );

      const sleepSpy = jest.spyOn(provider as any, 'sleep');

      const fn = jest.fn()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('success');

      const promise = provider.testWithRetry(fn);

      await jest.advanceTimersByTimeAsync(100); // First retry delay: 100 * 2^0 = 100
      await jest.advanceTimersByTimeAsync(200); // Second retry delay: 100 * 2^1 = 200

      await promise;

      expect(sleepSpy).toHaveBeenCalledTimes(2);
      expect(sleepSpy).toHaveBeenNthCalledWith(1, 100); // 100 * 2^0
      expect(sleepSpy).toHaveBeenNthCalledWith(2, 200); // 100 * 2^1
    });

    it('should not retry non-retryable errors', async () => {
      const nonRetryableError = new ProviderError(
        'Invalid request',
        'invalid_request_error',
        'anthropic',
        400,
        false,
      );

      const fn = jest.fn().mockRejectedValue(nonRetryableError);

      await expect(provider.testWithRetry(fn)).rejects.toThrow(nonRetryableError);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should respect retryAfterMs from rate limit errors', async () => {
      const retryableError = new ProviderError(
        'Rate limited',
        'rate_limit_error',
        'anthropic',
        429,
        true,
        5000, // retryAfterMs
      );

      const sleepSpy = jest.spyOn(provider as any, 'sleep');

      const fn = jest.fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('success');

      const promise = provider.testWithRetry(fn);
      await jest.advanceTimersByTimeAsync(5000);
      await promise;

      expect(sleepSpy).toHaveBeenCalledWith(5000);
    });
  });

  describe('timeout handling', () => {
    it('should throw timeout_error after configured timeout', async () => {
      jest.useRealTimers();

      const shortTimeoutProvider = new TestProvider({ timeoutMs: 100 });

      const slowFn = () => new Promise<string>((resolve) => {
        setTimeout(() => resolve('done'), 5000);
      });

      try {
        await shortTimeoutProvider.testWithTimeout(slowFn);
        fail('Expected timeout error');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).type).toBe('timeout_error');
        expect((error as ProviderError).retryable).toBe(true);
      }
    });

    it('should return result if within timeout', async () => {
      jest.useRealTimers();

      const testProvider = new TestProvider({ timeoutMs: 5000 });

      const fastFn = () => new Promise<string>((resolve) => {
        setTimeout(() => resolve('done'), 10);
      });

      const result = await testProvider.testWithTimeout(fastFn);
      expect(result).toBe('done');
    });
  });

  describe('rate limit tracking', () => {
    it('should store and return rate limit info', () => {
      expect(provider.getRateLimitStatus()).toBeNull();

      const rateLimitInfo = {
        remaining: 50,
        limit: 100,
        resetAt: new Date(),
        retryAfter: 10,
      };

      provider.testUpdateRateLimits(rateLimitInfo);
      expect(provider.getRateLimitStatus()).toEqual(rateLimitInfo);
    });
  });

  describe('latency measurement', () => {
    it('should measure latency in complete() calls', async () => {
      jest.useRealTimers();

      const testProvider = new TestProvider({ timeoutMs: 10000 });
      testProvider.executeCompleteFn.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          content: 'test',
          model: 'test-model',
          usage: { inputTokens: 10, outputTokens: 20 },
          cost: { amount: 0, currency: 'USD' },
          latency: 0,
          provider: 'anthropic',
          finishReason: 'end_turn',
        };
      });

      const request: CompletionRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 100,
      };

      const response = await testProvider.complete(request, 'test-key');
      expect(response.latency).toBeGreaterThanOrEqual(40);
      expect(response.latency).toBeLessThan(500);
    });
  });

  describe('cost calculation', () => {
    it('should compute correct USD amount from token counts', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
      };

      const cost = provider.calculateCost('test-model', usage);

      // inputCost = 1000 * 3.00 / 1_000_000 = 0.003
      // outputCost = 500 * 15.00 / 1_000_000 = 0.0075
      // total = 0.0105
      expect(cost.amount).toBeCloseTo(0.0105, 6);
      expect(cost.currency).toBe('USD');
    });

    it('should include cached input cost when present', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        cachedInputTokens: 2000,
      };

      const cost = provider.calculateCost('test-model', usage);

      // inputCost = 1000 * 3.00 / 1_000_000 = 0.003
      // outputCost = 500 * 15.00 / 1_000_000 = 0.0075
      // cachedCost = 2000 * 0.30 / 1_000_000 = 0.0006
      // total = 0.0111
      expect(cost.amount).toBeCloseTo(0.0111, 6);
      expect(cost.currency).toBe('USD');
    });
  });

  describe('error normalization', () => {
    it('should map unknown errors to unknown_error', () => {
      const error = new Error('Something went wrong');
      const providerError = provider.mapError(error);

      expect(providerError).toBeInstanceOf(ProviderError);
      expect(providerError.type).toBe('unknown_error');
      expect(providerError.message).toBe('Something went wrong');
    });
  });

  describe('complete()', () => {
    it('should delegate to executeComplete and add cost and provider', async () => {
      jest.useRealTimers();

      const testProvider = new TestProvider({ timeoutMs: 10000 });
      testProvider.executeCompleteFn.mockResolvedValue({
        content: 'Hello',
        model: 'test-model',
        usage: { inputTokens: 100, outputTokens: 50 },
        cost: { amount: 0, currency: 'USD' },
        latency: 0,
        provider: 'anthropic',
        finishReason: 'end_turn',
      });

      const request: CompletionRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      };

      const response = await testProvider.complete(request, 'api-key');

      expect(response.content).toBe('Hello');
      expect(response.provider).toBe('anthropic');
      expect(response.cost.amount).toBeGreaterThan(0);
      expect(response.latency).toBeGreaterThanOrEqual(0);
    });
  });

  describe('healthCheck()', () => {
    it('should return unhealthy status on error', async () => {
      jest.useRealTimers();

      const testProvider = new TestProvider({ timeoutMs: 10000 });
      testProvider.executeHealthCheckFn.mockRejectedValue(
        new Error('Connection failed'),
      );

      const status = await testProvider.healthCheck('api-key');

      expect(status.healthy).toBe(false);
      expect(status.errorMessage).toBe('Connection failed');
      expect(status.providerId).toBe('anthropic');
    });
  });

  describe('input validation', () => {
    it('should throw on empty messages array', async () => {
      jest.useRealTimers();

      const testProvider = new TestProvider({ timeoutMs: 10000 });
      const request: CompletionRequest = {
        model: 'test-model',
        messages: [],
        maxTokens: 100,
      };

      await expect(testProvider.complete(request, 'key')).rejects.toMatchObject({
        type: 'invalid_request_error',
        message: expect.stringContaining('at least one message'),
      });
    });

    it('should throw on missing model', async () => {
      jest.useRealTimers();

      const testProvider = new TestProvider({ timeoutMs: 10000 });
      const request: CompletionRequest = {
        model: '',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 100,
      };

      await expect(testProvider.complete(request, 'key')).rejects.toMatchObject({
        type: 'invalid_request_error',
        message: expect.stringContaining('model'),
      });
    });

    it('should throw on invalid maxTokens', async () => {
      jest.useRealTimers();

      const testProvider = new TestProvider({ timeoutMs: 10000 });
      const request: CompletionRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 0,
      };

      await expect(testProvider.complete(request, 'key')).rejects.toMatchObject({
        type: 'invalid_request_error',
        message: expect.stringContaining('maxTokens'),
      });
    });
  });
});
