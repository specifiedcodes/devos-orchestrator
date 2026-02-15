/**
 * Provider Defaults Configuration
 *
 * Default configurations for all supported providers.
 * Environment variables can override base URLs and timeouts.
 *
 * Story 13-1: Provider Abstraction Layer
 */

import { ProviderConfig, ProviderID } from './interfaces';

/**
 * Default provider configurations
 */
export const DEFAULT_PROVIDER_CONFIGS: Record<ProviderID, ProviderConfig> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    enabled: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    timeoutMs: parseInt(process.env.PROVIDER_TIMEOUT_MS || '120000', 10),
    rateLimitRpm: 60,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    enabled: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    timeoutMs: parseInt(process.env.PROVIDER_TIMEOUT_MS || '120000', 10),
    rateLimitRpm: 60,
    baseUrl: process.env.OPENAI_BASE_URL,
  },
  google: {
    id: 'google',
    name: 'Google AI',
    enabled: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    timeoutMs: parseInt(process.env.PROVIDER_TIMEOUT_MS || '120000', 10),
    rateLimitRpm: 60,
    baseUrl: process.env.GOOGLE_AI_BASE_URL,
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    enabled: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    timeoutMs: parseInt(process.env.PROVIDER_TIMEOUT_MS || '120000', 10),
    rateLimitRpm: 30,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
  },
};

/**
 * Get provider config with optional overrides
 */
export function getProviderConfig(
  id: ProviderID,
  overrides?: Partial<ProviderConfig>,
): ProviderConfig {
  const defaults = DEFAULT_PROVIDER_CONFIGS[id];
  return {
    ...defaults,
    ...overrides,
    id, // Ensure ID cannot be overridden
  };
}
