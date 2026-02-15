/**
 * ProviderRegistry Tests
 *
 * Tests for provider registration, lookup, enable/disable,
 * model search, and health checks.
 *
 * Story 13-1: Provider Abstraction Layer
 */

import { ProviderRegistry } from '../provider.registry';
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
} from '../interfaces';

/**
 * Create a mock provider for testing
 */
function createMockProvider(
  id: ProviderID,
  enabled: boolean = true,
  supportedModels: string[] = [],
): AIProvider {
  return {
    id,
    name: `${id} Provider`,
    config: {
      id,
      name: `${id} Provider`,
      enabled,
      maxRetries: 3,
      retryDelayMs: 1000,
      timeoutMs: 120000,
    },
    complete: jest.fn(),
    stream: jest.fn(),
    embed: jest.fn(),
    healthCheck: jest.fn().mockResolvedValue({
      providerId: id,
      healthy: true,
      latencyMs: 100,
      lastChecked: new Date(),
    }),
    getRateLimitStatus: jest.fn().mockReturnValue(null),
    supportsModel: jest.fn().mockImplementation((model: string) =>
      supportedModels.includes(model),
    ),
    calculateCost: jest.fn().mockReturnValue({ amount: 0.01, currency: 'USD' }),
  };
}

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  describe('registerProvider()', () => {
    it('should add provider to registry', () => {
      const provider = createMockProvider('anthropic');
      registry.registerProvider(provider);

      expect(registry.getProvider('anthropic')).toBe(provider);
    });
  });

  describe('getProvider()', () => {
    it('should return registered provider by ID', () => {
      const provider = createMockProvider('openai');
      registry.registerProvider(provider);

      expect(registry.getProvider('openai')).toBe(provider);
    });

    it('should return undefined for unregistered provider', () => {
      expect(registry.getProvider('anthropic')).toBeUndefined();
    });
  });

  describe('getProviderOrThrow()', () => {
    it('should return registered provider', () => {
      const provider = createMockProvider('anthropic');
      registry.registerProvider(provider);

      expect(registry.getProviderOrThrow('anthropic')).toBe(provider);
    });

    it('should throw for unregistered provider', () => {
      expect(() => registry.getProviderOrThrow('anthropic')).toThrow(
        "Provider 'anthropic' is not registered",
      );
    });
  });

  describe('getAllProviders()', () => {
    it('should return all registered providers', () => {
      registry.registerProvider(createMockProvider('anthropic'));
      registry.registerProvider(createMockProvider('openai'));
      registry.registerProvider(createMockProvider('google'));

      const providers = registry.getAllProviders();
      expect(providers).toHaveLength(3);
    });
  });

  describe('getEnabledProviders()', () => {
    it('should return only enabled providers', () => {
      registry.registerProvider(createMockProvider('anthropic', true));
      registry.registerProvider(createMockProvider('openai', false));
      registry.registerProvider(createMockProvider('google', true));

      const enabled = registry.getEnabledProviders();
      expect(enabled).toHaveLength(2);
      expect(enabled.map(p => p.id)).toContain('anthropic');
      expect(enabled.map(p => p.id)).toContain('google');
    });
  });

  describe('enableProvider()', () => {
    it('should enable a disabled provider', () => {
      registry.registerProvider(createMockProvider('openai', false));

      expect(registry.isProviderEnabled('openai')).toBe(false);
      registry.enableProvider('openai');
      expect(registry.isProviderEnabled('openai')).toBe(true);
    });
  });

  describe('disableProvider()', () => {
    it('should disable an enabled provider', () => {
      registry.registerProvider(createMockProvider('anthropic', true));

      expect(registry.isProviderEnabled('anthropic')).toBe(true);
      registry.disableProvider('anthropic');
      expect(registry.isProviderEnabled('anthropic')).toBe(false);
    });
  });

  describe('isProviderEnabled()', () => {
    it('should return correct boolean', () => {
      registry.registerProvider(createMockProvider('anthropic', true));
      registry.registerProvider(createMockProvider('openai', false));

      expect(registry.isProviderEnabled('anthropic')).toBe(true);
      expect(registry.isProviderEnabled('openai')).toBe(false);
    });
  });

  describe('getProviderForModel()', () => {
    it('should return provider that supports the model', () => {
      registry.registerProvider(
        createMockProvider('anthropic', true, ['claude-sonnet-4-20250514']),
      );
      registry.registerProvider(
        createMockProvider('openai', true, ['gpt-4o']),
      );

      const provider = registry.getProviderForModel('claude-sonnet-4-20250514');
      expect(provider?.id).toBe('anthropic');

      const openaiProvider = registry.getProviderForModel('gpt-4o');
      expect(openaiProvider?.id).toBe('openai');
    });

    it('should return undefined for unsupported model', () => {
      registry.registerProvider(
        createMockProvider('anthropic', true, ['claude-sonnet-4-20250514']),
      );

      expect(registry.getProviderForModel('unknown-model')).toBeUndefined();
    });

    it('should only search enabled providers', () => {
      registry.registerProvider(
        createMockProvider('anthropic', false, ['claude-sonnet-4-20250514']),
      );

      expect(registry.getProviderForModel('claude-sonnet-4-20250514')).toBeUndefined();
    });
  });

  describe('healthCheckAll()', () => {
    it('should call healthCheck on all enabled providers', async () => {
      const anthropic = createMockProvider('anthropic', true);
      const openai = createMockProvider('openai', true);
      const google = createMockProvider('google', false);

      registry.registerProvider(anthropic);
      registry.registerProvider(openai);
      registry.registerProvider(google);

      await registry.healthCheckAll({
        anthropic: 'key-1',
        openai: 'key-2',
        google: 'key-3',
      });

      expect(anthropic.healthCheck).toHaveBeenCalledWith('key-1');
      expect(openai.healthCheck).toHaveBeenCalledWith('key-2');
      // Google is disabled, should not be checked
      expect(google.healthCheck).not.toHaveBeenCalled();
    });

    it('should return status for each provider', async () => {
      const anthropic = createMockProvider('anthropic', true);
      const openai = createMockProvider('openai', true);

      registry.registerProvider(anthropic);
      registry.registerProvider(openai);

      const results = await registry.healthCheckAll({
        anthropic: 'key-1',
        openai: 'key-2',
      });

      expect(results).toHaveLength(2);
      expect(results[0].providerId).toBe('anthropic');
      expect(results[0].healthy).toBe(true);
      expect(results[1].providerId).toBe('openai');
      expect(results[1].healthy).toBe(true);
    });

    it('should handle provider health check failure gracefully', async () => {
      const anthropic = createMockProvider('anthropic', true);
      (anthropic.healthCheck as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );
      const openai = createMockProvider('openai', true);

      registry.registerProvider(anthropic);
      registry.registerProvider(openai);

      const results = await registry.healthCheckAll({
        anthropic: 'key-1',
        openai: 'key-2',
      });

      expect(results).toHaveLength(2);
      expect(results[0].healthy).toBe(false);
      expect(results[0].errorMessage).toBe('Network error');
      expect(results[1].healthy).toBe(true);
    });

    it('should return unhealthy when no API key provided', async () => {
      const anthropic = createMockProvider('anthropic', true);
      registry.registerProvider(anthropic);

      const results = await registry.healthCheckAll({});

      expect(results).toHaveLength(1);
      expect(results[0].healthy).toBe(false);
      expect(results[0].errorMessage).toBe('No API key provided');
    });
  });
});
