/**
 * Provider Module - Barrel Export
 *
 * Exports all interfaces, types, providers, registry, and factory function.
 *
 * Story 13-1: Provider Abstraction Layer
 */

// Interfaces and types
export {
  ProviderID,
  Message,
  ToolDefinition,
  CompletionRequest,
  CompletionResponse,
  TokenUsage,
  CostInfo,
  ToolCall,
  StreamChunk,
  RateLimitInfo,
  ProviderHealthStatus,
  ProviderConfig,
  ModelPricing,
  ProviderErrorType,
  ProviderError,
  AIProvider,
} from './interfaces';

// Base class
export { BaseProvider } from './base.provider';

// Provider implementations
export { AnthropicProvider } from './anthropic.provider';
export { OpenAIProvider } from './openai.provider';
export { GoogleAIProvider } from './google.provider';
export { DeepSeekProvider } from './deepseek.provider';

// Registry
export { ProviderRegistry } from './provider.registry';

// Defaults
export { DEFAULT_PROVIDER_CONFIGS, getProviderConfig } from './provider.defaults';

// Provider implementations
import { ProviderConfig, ProviderID } from './interfaces';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAIProvider } from './openai.provider';
import { GoogleAIProvider } from './google.provider';
import { DeepSeekProvider } from './deepseek.provider';
import { ProviderRegistry } from './provider.registry';
import { DEFAULT_PROVIDER_CONFIGS, getProviderConfig } from './provider.defaults';

/**
 * Configuration overrides for creating a provider registry
 */
export interface ProviderRegistryConfig {
  anthropic?: Partial<ProviderConfig>;
  openai?: Partial<ProviderConfig>;
  google?: Partial<ProviderConfig>;
  deepseek?: Partial<ProviderConfig>;
}

/**
 * Factory function to create a ProviderRegistry with all four providers.
 *
 * @param config Optional configuration overrides per provider
 * @returns A configured ProviderRegistry with all providers registered
 */
export function createProviderRegistry(
  config?: ProviderRegistryConfig,
): ProviderRegistry {
  const registry = new ProviderRegistry();

  // Create and register Anthropic provider
  const anthropicConfig = getProviderConfig('anthropic', config?.anthropic);
  registry.registerProvider(new AnthropicProvider(anthropicConfig));

  // Create and register OpenAI provider
  const openaiConfig = getProviderConfig('openai', config?.openai);
  registry.registerProvider(new OpenAIProvider(openaiConfig));

  // Create and register Google AI provider
  const googleConfig = getProviderConfig('google', config?.google);
  registry.registerProvider(new GoogleAIProvider(googleConfig));

  // Create and register DeepSeek provider
  const deepseekConfig = getProviderConfig('deepseek', config?.deepseek);
  registry.registerProvider(new DeepSeekProvider(deepseekConfig));

  return registry;
}
