/**
 * Provider Registry
 *
 * Manages registered AI providers with lookup, enable/disable,
 * and health check capabilities.
 *
 * Story 13-1: Provider Abstraction Layer
 */

import {
  AIProvider,
  ProviderID,
  ProviderHealthStatus,
} from './interfaces';

/**
 * Registry for managing all AI provider instances.
 */
export class ProviderRegistry {
  private providers: Map<ProviderID, AIProvider> = new Map();
  private enabledProviders: Set<ProviderID> = new Set();

  /**
   * Register a provider in the registry
   */
  registerProvider(provider: AIProvider): void {
    this.providers.set(provider.id, provider);
    if (provider.config.enabled) {
      this.enabledProviders.add(provider.id);
    }
  }

  /**
   * Get a provider by ID, or undefined if not registered
   */
  getProvider(id: ProviderID): AIProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Get a provider by ID, or throw if not registered
   */
  getProviderOrThrow(id: ProviderID): AIProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Provider '${id}' is not registered`);
    }
    return provider;
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get only enabled providers
   */
  getEnabledProviders(): AIProvider[] {
    return Array.from(this.providers.values())
      .filter(p => this.enabledProviders.has(p.id));
  }

  /**
   * Enable a provider
   */
  enableProvider(id: ProviderID): void {
    if (this.providers.has(id)) {
      this.enabledProviders.add(id);
    }
  }

  /**
   * Disable a provider
   */
  disableProvider(id: ProviderID): void {
    this.enabledProviders.delete(id);
  }

  /**
   * Check if a provider is enabled
   */
  isProviderEnabled(id: ProviderID): boolean {
    return this.enabledProviders.has(id);
  }

  /**
   * Find the first enabled provider that supports a given model
   */
  getProviderForModel(modelId: string): AIProvider | undefined {
    for (const provider of this.getEnabledProviders()) {
      if (provider.supportsModel(modelId)) {
        return provider;
      }
    }
    return undefined;
  }

  /**
   * Run health checks on all enabled providers
   */
  async healthCheckAll(
    apiKeys: Partial<Record<ProviderID, string>>,
  ): Promise<ProviderHealthStatus[]> {
    const enabledProviders = this.getEnabledProviders();
    const results = await Promise.allSettled(
      enabledProviders.map(async (provider) => {
        const apiKey = apiKeys[provider.id];
        if (!apiKey) {
          return {
            providerId: provider.id,
            healthy: false,
            latencyMs: null,
            lastChecked: new Date(),
            errorMessage: 'No API key provided',
          } as ProviderHealthStatus;
        }
        return provider.healthCheck(apiKey);
      }),
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        providerId: enabledProviders[index].id,
        healthy: false,
        latencyMs: null,
        lastChecked: new Date(),
        errorMessage: result.reason instanceof Error
          ? result.reason.message
          : 'Health check failed',
      } as ProviderHealthStatus;
    });
  }
}
