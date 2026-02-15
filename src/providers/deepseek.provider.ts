/**
 * DeepSeek Provider Implementation
 *
 * Uses the openai npm package (OpenAI-compatible API) with DeepSeek's base URL.
 *
 * Story 13-1: Provider Abstraction Layer
 */

import { OpenAIProvider } from './openai.provider';
import {
  CompletionResponse,
  ProviderConfig,
  ModelPricing,
  ProviderError,
} from './interfaces';

/**
 * Model pricing for DeepSeek models (per 1M tokens)
 */
const DEEPSEEK_PRICING: Record<string, ModelPricing> = {
  'deepseek-chat': { inputPer1M: 0.27, outputPer1M: 1.10, cachedInputPer1M: 0.07 },
  'deepseek-reasoner': { inputPer1M: 0.55, outputPer1M: 2.19 },
};

const SUPPORTED_MODELS = Object.keys(DEEPSEEK_PRICING);

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/**
 * DeepSeek provider implementation.
 * Extends OpenAIProvider since DeepSeek uses an OpenAI-compatible API.
 */
export class DeepSeekProvider extends OpenAIProvider {
  constructor(config: ProviderConfig) {
    // Override base URL to point to DeepSeek
    super({
      ...config,
      baseUrl: config.baseUrl || DEEPSEEK_BASE_URL,
    });
  }

  /**
   * DeepSeek does not support embeddings
   */
  protected async executeEmbed(
    _text: string,
    _model: string,
    _apiKey: string,
  ): Promise<number[]> {
    throw new ProviderError(
      'DeepSeek does not support embeddings',
      'invalid_request_error',
      this.id,
    );
  }

  /**
   * Map DeepSeek errors to ProviderError (same as OpenAI but with DeepSeek provider ID)
   */
  mapError(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }

    // Use parent error mapping but replace provider ID
    const parentError = super.mapError(error);
    return new ProviderError(
      parentError.message,
      parentError.type,
      this.id,
      parentError.statusCode,
      parentError.retryable,
      parentError.retryAfterMs,
    );
  }

  /**
   * Get model pricing for DeepSeek models
   */
  getModelPricing(model: string): ModelPricing {
    const pricing = DEEPSEEK_PRICING[model];
    if (pricing) {
      return pricing;
    }
    // Default to deepseek-chat pricing
    return DEEPSEEK_PRICING['deepseek-chat'];
  }

  /**
   * Check if a model ID is supported by DeepSeek
   */
  supportsModel(modelId: string): boolean {
    return SUPPORTED_MODELS.includes(modelId);
  }
}
