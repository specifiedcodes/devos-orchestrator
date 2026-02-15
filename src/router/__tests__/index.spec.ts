/**
 * Router Module Tests
 *
 * Story 13-3: Task-to-Model Router
 *
 * Tests for the barrel export and factory function.
 */
import {
  TaskModelRouter,
  RoutingError,
  DEFAULT_ROUTING_RULES,
  DEFAULT_ESTIMATED_INPUT_TOKENS,
  DEFAULT_ESTIMATED_OUTPUT_TOKENS,
  createTaskModelRouter,
} from '../index';
import { ProviderRegistry } from '../../providers/provider.registry';
import { ModelRegistryClient } from '../../model-registry/model-registry.client';

// Verify type exports compile (these are compile-time checks)
import type {
  RoutingDecision,
  RoutingAlternative,
  TaskRoutingRequest,
  WorkspaceRoutingConfig,
  RoutingRule,
  TaskModelRouterConfig,
} from '../index';

describe('Router Module', () => {
  describe('exports', () => {
    it('should export TaskModelRouter class', () => {
      expect(TaskModelRouter).toBeDefined();
      expect(typeof TaskModelRouter).toBe('function');
    });

    it('should export RoutingError class', () => {
      expect(RoutingError).toBeDefined();
      expect(typeof RoutingError).toBe('function');
    });

    it('should export DEFAULT_ROUTING_RULES', () => {
      expect(DEFAULT_ROUTING_RULES).toBeDefined();
      expect(typeof DEFAULT_ROUTING_RULES).toBe('object');
      expect(DEFAULT_ROUTING_RULES.coding).toBeDefined();
    });

    it('should export DEFAULT_ESTIMATED_INPUT_TOKENS', () => {
      expect(DEFAULT_ESTIMATED_INPUT_TOKENS).toBe(1000);
    });

    it('should export DEFAULT_ESTIMATED_OUTPUT_TOKENS', () => {
      expect(DEFAULT_ESTIMATED_OUTPUT_TOKENS).toBe(500);
    });

    it('should export createTaskModelRouter factory function', () => {
      expect(createTaskModelRouter).toBeDefined();
      expect(typeof createTaskModelRouter).toBe('function');
    });
  });

  describe('createTaskModelRouter', () => {
    let mockProviderRegistry: ProviderRegistry;
    let mockModelRegistryClient: ModelRegistryClient;

    beforeEach(() => {
      mockProviderRegistry = {
        isProviderEnabled: jest.fn().mockReturnValue(true),
        getProviderForModel: jest.fn(),
        getProvider: jest.fn(),
        getProviderOrThrow: jest.fn(),
        getAllProviders: jest.fn().mockReturnValue([]),
        getEnabledProviders: jest.fn().mockReturnValue([]),
        registerProvider: jest.fn(),
        enableProvider: jest.fn(),
        disableProvider: jest.fn(),
        healthCheckAll: jest.fn(),
      } as any;

      mockModelRegistryClient = {
        getByModelId: jest.fn(),
        getSuitableForTask: jest.fn(),
        getAll: jest.fn(),
        getModelPricing: jest.fn(),
        getByProvider: jest.fn(),
        setAuthToken: jest.fn(),
        clearCache: jest.fn(),
      } as any;
    });

    it('should create router with provider registry and model registry client', () => {
      const router = createTaskModelRouter(mockProviderRegistry, mockModelRegistryClient);

      expect(router).toBeInstanceOf(TaskModelRouter);
    });

    it('should use default routing rules when no custom rules provided', () => {
      const router = createTaskModelRouter(mockProviderRegistry, mockModelRegistryClient);

      const rules = router.getRoutingRules();
      expect(rules.coding.defaultModel).toBe('claude-sonnet-4-20250514');
      expect(rules.simple_chat.defaultModel).toBe('gemini-2.0-flash');
    });

    it('should apply custom routing rules when provided', () => {
      const customRules = {
        ...DEFAULT_ROUTING_RULES,
        coding: {
          defaultModel: 'gpt-4o',
          fallbackModels: ['claude-sonnet-4-20250514'],
          qualityTierPreference: 'standard' as const,
        },
      };

      const router = createTaskModelRouter(mockProviderRegistry, mockModelRegistryClient, {
        routingRules: customRules,
      });

      const rules = router.getRoutingRules();
      expect(rules.coding.defaultModel).toBe('gpt-4o');
    });
  });

  describe('RoutingError', () => {
    it('should be an instance of Error', () => {
      const error = new RoutingError(
        'Test error',
        'coding',
        { taskType: 'coding', workspaceId: 'ws-1' },
        ['model-1', 'model-2'],
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RoutingError);
    });

    it('should store taskType, request, and attemptedModels', () => {
      const request = { taskType: 'coding' as const, workspaceId: 'ws-1' };
      const error = new RoutingError(
        'Test error',
        'coding',
        request,
        ['model-1', 'model-2'],
      );

      expect(error.taskType).toBe('coding');
      expect(error.request).toBe(request);
      expect(error.attemptedModels).toEqual(['model-1', 'model-2']);
      expect(error.name).toBe('RoutingError');
    });
  });
});
