/**
 * BaseProvider Abstract Class
 *
 * Shared implementation for all AI provider implementations.
 * Provides retry logic, timeout handling, rate limiting, cost calculation,
 * latency measurement, and error normalization.
 *
 * Story 13-1: Provider Abstraction Layer
 */

import {
  AIProvider,
  ProviderID,
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  TokenUsage,
  CostInfo,
  RateLimitInfo,
  ProviderHealthStatus,
  ModelPricing,
  ProviderError,
} from './interfaces';

/**
 * Abstract base class for all AI provider implementations.
 *
 * Subclasses must implement the following abstract methods:
 * - executeComplete: Provider-specific completion call
 * - executeStream: Provider-specific streaming call
 * - executeEmbed: Provider-specific embedding call
 * - executeHealthCheck: Provider-specific health check
 * - mapError: Map provider-specific errors to ProviderError
 * - getModelPricing: Return pricing for a given model
 * - supportsModel: Check if a model is supported
 */
export abstract class BaseProvider implements AIProvider {
  public readonly id: ProviderID;
  public readonly name: string;
  public readonly config: ProviderConfig;

  private rateLimitInfo: RateLimitInfo | null = null;

  constructor(config: ProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
  }

  /**
   * Validate that a completion request has required fields.
   */
  private validateRequest(request: CompletionRequest): void {
    if (!request.messages || request.messages.length === 0) {
      throw new ProviderError(
        'CompletionRequest must contain at least one message',
        'invalid_request_error',
        this.id,
      );
    }
    if (!request.model) {
      throw new ProviderError(
        'CompletionRequest must specify a model',
        'invalid_request_error',
        this.id,
      );
    }
    if (!request.maxTokens || request.maxTokens <= 0) {
      throw new ProviderError(
        'CompletionRequest must specify a positive maxTokens value',
        'invalid_request_error',
        this.id,
      );
    }
  }

  /**
   * Send a completion request with retry, timeout, and latency measurement.
   */
  async complete(request: CompletionRequest, apiKey: string): Promise<CompletionResponse> {
    this.validateRequest(request);
    return this.withRetry(async () => {
      return this.withTimeout(async () => {
        const start = Date.now();
        const response = await this.executeComplete(request, apiKey);
        const latency = Date.now() - start;
        const cost = this.calculateCost(request.model, response.usage);
        return {
          ...response,
          latency,
          cost,
          provider: this.id,
        };
      });
    });
  }

  /**
   * Send a streaming request with timeout (no retry for streaming).
   */
  async *stream(request: CompletionRequest, apiKey: string): AsyncIterable<StreamChunk> {
    this.validateRequest(request);
    const generator = await this.withTimeout(async () => {
      return this.executeStream(request, apiKey);
    });
    yield* generator;
  }

  /**
   * Generate embeddings with retry and timeout.
   */
  async embed(text: string, model: string, apiKey: string): Promise<number[]> {
    return this.withRetry(async () => {
      return this.withTimeout(async () => {
        return this.executeEmbed(text, model, apiKey);
      });
    });
  }

  /**
   * Health check with timeout (no retry).
   */
  async healthCheck(apiKey: string): Promise<ProviderHealthStatus> {
    try {
      return await this.withTimeout(async () => {
        return this.executeHealthCheck(apiKey);
      });
    } catch (error) {
      return {
        providerId: this.id,
        healthy: false,
        latencyMs: null,
        lastChecked: new Date(),
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get current rate limit status from cached response headers.
   */
  getRateLimitStatus(): RateLimitInfo | null {
    return this.rateLimitInfo;
  }

  /**
   * Calculate the cost of a request based on token usage and model pricing.
   *
   * When cached input tokens are present and cached pricing exists:
   * - Non-cached input tokens are charged at the full input rate
   * - Cached input tokens are charged at the discounted cached rate
   * The cachedInputTokens count is separate from inputTokens (not included in inputTokens),
   * so we add the cached cost on top.
   *
   * Note: Anthropic reports cache_read_input_tokens separately from input_tokens,
   * so this additive calculation is correct for the Anthropic billing model.
   * If a provider includes cached tokens within inputTokens, the subclass should
   * override this method.
   */
  calculateCost(model: string, usage: TokenUsage): CostInfo {
    const pricing = this.getModelPricing(model);
    const inputCost = (usage.inputTokens * pricing.inputPer1M) / 1_000_000;
    const outputCost = (usage.outputTokens * pricing.outputPer1M) / 1_000_000;
    const cachedCost = usage.cachedInputTokens && pricing.cachedInputPer1M
      ? (usage.cachedInputTokens * pricing.cachedInputPer1M) / 1_000_000
      : 0;

    return {
      amount: inputCost + outputCost + cachedCost,
      currency: 'USD',
    };
  }

  /**
   * Update rate limit info from provider response headers.
   */
  protected updateRateLimits(info: RateLimitInfo): void {
    this.rateLimitInfo = info;
  }

  /**
   * Retry logic with exponential backoff.
   * Only retries if the error is retryable.
   * Respects retryAfterMs from rate limit errors.
   */
  protected async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: ProviderError | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const providerError = error instanceof ProviderError
          ? error
          : this.mapError(error);

        lastError = providerError;

        if (!providerError.retryable || attempt === this.config.maxRetries) {
          throw providerError;
        }

        // Calculate delay: use retryAfterMs if available, otherwise exponential backoff
        const delay = providerError.retryAfterMs
          ?? this.config.retryDelayMs * Math.pow(2, attempt);

        await this.sleep(delay);
      }
    }

    // Should not reach here, but TypeScript needs it
    throw lastError!;
  }

  /**
   * Timeout handling using Promise.race.
   * Clears the timer on success to prevent leaks.
   */
  protected async withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ProviderError(
          `Request timed out after ${this.config.timeoutMs}ms`,
          'timeout_error',
          this.id,
          undefined,
          true,
        ));
      }, this.config.timeoutMs);
    });

    try {
      const result = await Promise.race([fn(), timeoutPromise]);
      return result;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Sleep helper for retry delays.
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Abstract methods that subclasses must implement

  /**
   * Provider-specific completion call
   */
  protected abstract executeComplete(
    request: CompletionRequest,
    apiKey: string,
  ): Promise<CompletionResponse>;

  /**
   * Provider-specific streaming call
   */
  protected abstract executeStream(
    request: CompletionRequest,
    apiKey: string,
  ): Promise<AsyncIterable<StreamChunk>>;

  /**
   * Provider-specific embedding call
   */
  protected abstract executeEmbed(
    text: string,
    model: string,
    apiKey: string,
  ): Promise<number[]>;

  /**
   * Provider-specific health check
   */
  protected abstract executeHealthCheck(
    apiKey: string,
  ): Promise<ProviderHealthStatus>;

  /**
   * Map provider-specific errors to ProviderError
   */
  abstract mapError(error: unknown): ProviderError;

  /**
   * Return pricing for a given model (per 1M tokens)
   */
  abstract getModelPricing(model: string): ModelPricing;

  /**
   * Check if a model is supported by this provider
   */
  abstract supportsModel(modelId: string): boolean;
}
