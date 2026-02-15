/**
 * AI Provider Interface
 *
 * Core interface that all provider implementations must satisfy.
 *
 * Story 13-1: Provider Abstraction Layer
 */

import {
  ProviderID,
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  TokenUsage,
  CostInfo,
  RateLimitInfo,
  ProviderHealthStatus,
} from './provider.interfaces';

/**
 * Unified AI provider interface
 */
export interface AIProvider {
  readonly id: ProviderID;
  readonly name: string;
  readonly config: ProviderConfig;

  /**
   * Send a completion request and get a full response
   */
  complete(request: CompletionRequest, apiKey: string): Promise<CompletionResponse>;

  /**
   * Send a completion request and get a streaming response
   */
  stream(request: CompletionRequest, apiKey: string): AsyncIterable<StreamChunk>;

  /**
   * Generate embeddings for text
   */
  embed(text: string, model: string, apiKey: string): Promise<number[]>;

  /**
   * Check if the provider is reachable and API key is valid
   */
  healthCheck(apiKey: string): Promise<ProviderHealthStatus>;

  /**
   * Get current rate limit status (from cached headers)
   */
  getRateLimitStatus(): RateLimitInfo | null;

  /**
   * Validate that a model ID is supported by this provider
   */
  supportsModel(modelId: string): boolean;

  /**
   * Calculate the cost of a request based on token usage
   */
  calculateCost(model: string, usage: TokenUsage): CostInfo;
}
