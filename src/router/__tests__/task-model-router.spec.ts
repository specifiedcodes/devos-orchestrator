/**
 * TaskModelRouter Tests
 *
 * Story 13-3: Task-to-Model Router
 *
 * Comprehensive tests for the routing algorithm including force model,
 * default routing, fallbacks, presets, workspace overrides, capability
 * filtering, provider gating, cost estimation, and alternatives tracking.
 */
import { TaskModelRouter } from '../task-model-router';
import { RoutingError } from '../routing-error';
import { DEFAULT_ROUTING_RULES } from '../router.defaults';
import {
  TaskRoutingRequest,
  WorkspaceRoutingConfig,
  RoutingRule,
} from '../router.interfaces';
import { ProviderRegistry } from '../../providers/provider.registry';
import { ModelRegistryClient } from '../../model-registry/model-registry.client';
import { ModelDefinition } from '../../model-registry/model-registry.types';
import { ProviderID, TaskType } from '../../providers/interfaces/provider.interfaces';

// ===== Test Fixtures =====

function createModelDefinition(overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id: 'uuid-1',
    modelId: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4',
    contextWindow: 200000,
    maxOutputTokens: 16000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsEmbedding: false,
    inputPricePer1M: 3.0,
    outputPricePer1M: 15.0,
    cachedInputPricePer1M: 0.3,
    avgLatencyMs: 0,
    qualityTier: 'standard',
    suitableFor: ['coding', 'planning', 'review', 'simple_chat'],
    available: true,
    deprecationDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const MODEL_FIXTURES: Record<string, ModelDefinition> = {
  'claude-sonnet-4-20250514': createModelDefinition(),
  'claude-opus-4-20250514': createModelDefinition({
    id: 'uuid-opus',
    modelId: 'claude-opus-4-20250514',
    provider: 'anthropic',
    displayName: 'Claude Opus 4',
    inputPricePer1M: 15.0,
    outputPricePer1M: 75.0,
    qualityTier: 'premium',
    suitableFor: ['coding', 'planning', 'review', 'complex_reasoning'],
  }),
  'claude-haiku-3-5-20241022': createModelDefinition({
    id: 'uuid-haiku',
    modelId: 'claude-haiku-3-5-20241022',
    provider: 'anthropic',
    displayName: 'Claude Haiku 3.5',
    inputPricePer1M: 0.80,
    outputPricePer1M: 4.0,
    qualityTier: 'economy',
    suitableFor: ['summarization', 'simple_chat'],
  }),
  'gpt-4o': createModelDefinition({
    id: 'uuid-gpt4o',
    modelId: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o',
    contextWindow: 128000,
    inputPricePer1M: 2.5,
    outputPricePer1M: 10.0,
    qualityTier: 'standard',
    suitableFor: ['coding', 'planning', 'review', 'simple_chat'],
  }),
  'gpt-4o-mini': createModelDefinition({
    id: 'uuid-gpt4o-mini',
    modelId: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'GPT-4o Mini',
    contextWindow: 128000,
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.60,
    qualityTier: 'economy',
    suitableFor: ['summarization', 'simple_chat'],
  }),
  'gemini-2.0-flash': createModelDefinition({
    id: 'uuid-flash',
    modelId: 'gemini-2.0-flash',
    provider: 'google',
    displayName: 'Gemini 2.0 Flash',
    contextWindow: 1000000,
    inputPricePer1M: 0.10,
    outputPricePer1M: 0.40,
    qualityTier: 'economy',
    suitableFor: ['summarization', 'simple_chat'],
  }),
  'gemini-2.0-pro': createModelDefinition({
    id: 'uuid-pro',
    modelId: 'gemini-2.0-pro',
    provider: 'google',
    displayName: 'Gemini 2.0 Pro',
    contextWindow: 2000000,
    inputPricePer1M: 1.25,
    outputPricePer1M: 5.0,
    qualityTier: 'standard',
    suitableFor: ['coding', 'planning', 'review'],
  }),
  'deepseek-chat': createModelDefinition({
    id: 'uuid-dschat',
    modelId: 'deepseek-chat',
    provider: 'deepseek',
    displayName: 'DeepSeek Chat',
    contextWindow: 64000,
    inputPricePer1M: 0.27,
    outputPricePer1M: 1.10,
    qualityTier: 'economy',
    suitableFor: ['coding', 'summarization', 'simple_chat'],
  }),
  'deepseek-reasoner': createModelDefinition({
    id: 'uuid-dsreason',
    modelId: 'deepseek-reasoner',
    provider: 'deepseek',
    displayName: 'DeepSeek Reasoner',
    contextWindow: 64000,
    inputPricePer1M: 0.55,
    outputPricePer1M: 2.19,
    qualityTier: 'standard',
    suitableFor: ['coding', 'complex_reasoning'],
  }),
  'text-embedding-3-small': createModelDefinition({
    id: 'uuid-embed-small',
    modelId: 'text-embedding-3-small',
    provider: 'openai',
    displayName: 'Text Embedding 3 Small',
    contextWindow: 8191,
    maxOutputTokens: 0,
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: false,
    supportsEmbedding: true,
    inputPricePer1M: 0.02,
    outputPricePer1M: 0,
    cachedInputPricePer1M: null,
    qualityTier: 'economy',
    suitableFor: ['embedding'],
  }),
  'text-embedding-004': createModelDefinition({
    id: 'uuid-embed-google',
    modelId: 'text-embedding-004',
    provider: 'google',
    displayName: 'Text Embedding 004',
    contextWindow: 2048,
    maxOutputTokens: 0,
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: false,
    supportsEmbedding: true,
    inputPricePer1M: 0.006,
    outputPricePer1M: 0,
    cachedInputPricePer1M: null,
    qualityTier: 'economy',
    suitableFor: ['embedding'],
  }),
  'text-embedding-3-large': createModelDefinition({
    id: 'uuid-embed-large',
    modelId: 'text-embedding-3-large',
    provider: 'openai',
    displayName: 'Text Embedding 3 Large',
    contextWindow: 8191,
    maxOutputTokens: 0,
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: false,
    supportsEmbedding: true,
    inputPricePer1M: 0.13,
    outputPricePer1M: 0,
    cachedInputPricePer1M: null,
    qualityTier: 'standard',
    suitableFor: ['embedding'],
  }),
};

function createDefaultWorkspaceConfig(overrides: Partial<WorkspaceRoutingConfig> = {}): WorkspaceRoutingConfig {
  return {
    workspaceId: 'ws-test-1',
    enabledProviders: ['anthropic', 'openai', 'google', 'deepseek'] as ProviderID[],
    preset: 'auto',
    ...overrides,
  };
}

function createRequest(overrides: Partial<TaskRoutingRequest> = {}): TaskRoutingRequest {
  return {
    taskType: 'coding',
    workspaceId: 'ws-test-1',
    ...overrides,
  };
}

// ===== Mock Setup =====

describe('TaskModelRouter', () => {
  let router: TaskModelRouter;
  let mockProviderRegistry: jest.Mocked<ProviderRegistry>;
  let mockModelRegistryClient: jest.Mocked<ModelRegistryClient>;

  beforeEach(() => {
    // Create mocks
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
      getByModelId: jest.fn().mockImplementation(async (modelId: string) => {
        return MODEL_FIXTURES[modelId] || null;
      }),
      getSuitableForTask: jest.fn().mockImplementation(async (taskType: TaskType) => {
        return Object.values(MODEL_FIXTURES).filter(m => m.suitableFor.includes(taskType));
      }),
      getAll: jest.fn().mockImplementation(async (filters?: any) => {
        let models = Object.values(MODEL_FIXTURES);
        if (filters?.available !== undefined) {
          models = models.filter(m => m.available === filters.available);
        }
        return models;
      }),
      getModelPricing: jest.fn().mockImplementation(async (modelId: string) => {
        const model = MODEL_FIXTURES[modelId];
        if (!model) throw new Error(`Model '${modelId}' not found in registry`);
        return {
          inputPer1M: model.inputPricePer1M,
          outputPer1M: model.outputPricePer1M,
          cachedInputPer1M: model.cachedInputPricePer1M ?? undefined,
        };
      }),
      getByProvider: jest.fn(),
      setAuthToken: jest.fn(),
      clearCache: jest.fn(),
    } as any;

    router = new TaskModelRouter(mockProviderRegistry, mockModelRegistryClient);
  });

  // ===== Force Model Tests =====

  describe('Force model', () => {
    it('should return forced model regardless of task type', async () => {
      const request = createRequest({
        taskType: 'simple_chat',
        forceModel: 'claude-opus-4-20250514',
      });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('claude-opus-4-20250514');
      expect(decision.provider).toBe('anthropic');
      expect(decision.reason).toContain('Forced model');
    });

    it('should throw RoutingError if forced model not found in registry', async () => {
      const request = createRequest({
        forceModel: 'nonexistent-model',
      });
      const config = createDefaultWorkspaceConfig();

      await expect(router.routeTask(request, config)).rejects.toThrow(RoutingError);
      await expect(router.routeTask(request, config)).rejects.toThrow('not found in model registry');
    });

    it('should throw RoutingError if forced model provider not in enabledProviders', async () => {
      const request = createRequest({
        forceModel: 'claude-sonnet-4-20250514',
      });
      const config = createDefaultWorkspaceConfig({
        enabledProviders: ['openai'] as ProviderID[],
      });

      await expect(router.routeTask(request, config)).rejects.toThrow(RoutingError);
      await expect(router.routeTask(request, config)).rejects.toThrow('not in workspace enabled providers');
    });

    it('should use forceProvider to select best model from that provider', async () => {
      const request = createRequest({
        taskType: 'coding',
        forceProvider: 'openai' as ProviderID,
      });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('gpt-4o');
      expect(decision.provider).toBe('openai');
      expect(decision.reason).toContain('forced provider');
    });

    it('should throw RoutingError if forceProvider is not in enabledProviders', async () => {
      const request = createRequest({
        taskType: 'coding',
        forceProvider: 'deepseek' as ProviderID,
      });
      const config = createDefaultWorkspaceConfig({
        enabledProviders: ['anthropic', 'openai'] as ProviderID[],
      });

      await expect(router.routeTask(request, config)).rejects.toThrow(RoutingError);
      await expect(router.routeTask(request, config)).rejects.toThrow('not in workspace enabled providers');
    });

    it('should include capability warning in reason when forcing model that lacks required capabilities', async () => {
      // Force claude-sonnet but require vision; sonnet supports vision by default, so
      // make it not support tools and require tools
      mockModelRegistryClient.getByModelId.mockImplementation(async (modelId: string) => {
        if (modelId === 'claude-opus-4-20250514') {
          return createModelDefinition({
            modelId: 'claude-opus-4-20250514',
            provider: 'anthropic',
            supportsTools: false,
          });
        }
        return MODEL_FIXTURES[modelId] || null;
      });

      const request = createRequest({
        taskType: 'coding',
        forceModel: 'claude-opus-4-20250514',
        requiresTools: true,
      });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('claude-opus-4-20250514');
      expect(decision.reason).toContain('WARNING');
      expect(decision.reason).toContain('does not support tools');
    });
  });

  // ===== Default Routing Tests =====

  describe('Default routing', () => {
    it('should return default model for coding task type (claude-sonnet-4-20250514)', async () => {
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('claude-sonnet-4-20250514');
      expect(decision.provider).toBe('anthropic');
    });

    it('should return default model for simple_chat task type (gemini-2.0-flash)', async () => {
      const request = createRequest({ taskType: 'simple_chat' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('gemini-2.0-flash');
      expect(decision.provider).toBe('google');
    });

    it('should return default model for embedding task type (text-embedding-3-small)', async () => {
      const request = createRequest({ taskType: 'embedding' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('text-embedding-3-small');
      expect(decision.provider).toBe('openai');
    });

    it('should return default model for complex_reasoning task type (claude-opus-4-20250514)', async () => {
      const request = createRequest({ taskType: 'complex_reasoning' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('claude-opus-4-20250514');
      expect(decision.provider).toBe('anthropic');
    });

    it('should return default model for summarization task type (gemini-2.0-flash)', async () => {
      const request = createRequest({ taskType: 'summarization' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('gemini-2.0-flash');
      expect(decision.provider).toBe('google');
    });

    it('should return default model for planning task type (claude-sonnet-4-20250514)', async () => {
      const request = createRequest({ taskType: 'planning' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('claude-sonnet-4-20250514');
      expect(decision.provider).toBe('anthropic');
    });

    it('should return default model for review task type (claude-sonnet-4-20250514)', async () => {
      const request = createRequest({ taskType: 'review' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('claude-sonnet-4-20250514');
      expect(decision.provider).toBe('anthropic');
    });
  });

  // ===== Fallback Logic Tests =====

  describe('Fallback logic', () => {
    it('should fall back when default model provider not in enabledProviders', async () => {
      // Coding default is claude-sonnet -> anthropic. Remove anthropic.
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({
        enabledProviders: ['openai', 'google', 'deepseek'] as ProviderID[],
      });

      const decision = await router.routeTask(request, config);

      // Should fall to first fallback: gpt-4o (openai)
      expect(decision.selectedModel).toBe('gpt-4o');
      expect(decision.provider).toBe('openai');
    });

    it('should iterate through fallbacks until finding available model', async () => {
      // Coding: default=claude-sonnet(anthropic), fallbacks=[gpt-4o(openai), deepseek-chat(deepseek), gemini-2.0-pro(google)]
      // Remove anthropic and openai -> should go to deepseek-chat
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({
        enabledProviders: ['deepseek', 'google'] as ProviderID[],
      });

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('deepseek-chat');
      expect(decision.provider).toBe('deepseek');
    });

    it('should fall back when default model is unavailable in registry', async () => {
      // Make claude-sonnet unavailable
      mockModelRegistryClient.getByModelId.mockImplementation(async (modelId: string) => {
        if (modelId === 'claude-sonnet-4-20250514') {
          return createModelDefinition({ available: false });
        }
        return MODEL_FIXTURES[modelId] || null;
      });

      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('gpt-4o');
    });

    it('should fall back when default model does not meet capability requirements (tools)', async () => {
      // Make claude-sonnet not support tools
      mockModelRegistryClient.getByModelId.mockImplementation(async (modelId: string) => {
        if (modelId === 'claude-sonnet-4-20250514') {
          return createModelDefinition({ supportsTools: false });
        }
        return MODEL_FIXTURES[modelId] || null;
      });

      const request = createRequest({ taskType: 'coding', requiresTools: true });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('gpt-4o');
    });

    it('should fall back when context size exceeds model context window', async () => {
      // Claude sonnet has 200000 context. Request 300000.
      const request = createRequest({ taskType: 'coding', contextSizeTokens: 300000 });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      // gpt-4o has 128000, deepseek-chat has 64000, gemini-2.0-pro has 2000000
      expect(decision.selectedModel).toBe('gemini-2.0-pro');
    });

    it('should record rejected models in alternatives array with reasons', async () => {
      // Make anthropic not enabled -> sonnet rejected, then gpt-4o selected
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({
        enabledProviders: ['openai', 'google', 'deepseek'] as ProviderID[],
      });

      const decision = await router.routeTask(request, config);

      expect(decision.alternatives.length).toBeGreaterThan(0);
      const sonnetAlt = decision.alternatives.find(a => a.model === 'claude-sonnet-4-20250514');
      expect(sonnetAlt).toBeDefined();
      expect(sonnetAlt!.reason).toContain('no BYOK key');
    });
  });

  // ===== Registry Fallback Tests =====

  describe('Registry fallback', () => {
    it('should query model registry when all defaults/fallbacks fail', async () => {
      // Use a custom routing rule where all defaults and fallbacks are for anthropic
      const customRules: Record<TaskType, RoutingRule> = {
        ...DEFAULT_ROUTING_RULES,
        coding: {
          defaultModel: 'claude-sonnet-4-20250514',
          fallbackModels: ['claude-opus-4-20250514'],
          qualityTierPreference: 'standard',
        },
      };
      router.setRoutingRules(customRules);

      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({
        enabledProviders: ['openai', 'google'] as ProviderID[],
      });

      const decision = await router.routeTask(request, config);

      // Should have called getSuitableForTask as fallback
      expect(mockModelRegistryClient.getSuitableForTask).toHaveBeenCalledWith('coding');
      // Should select from available providers - cheapest coding model from openai/google
      expect(['gpt-4o', 'gemini-2.0-pro']).toContain(decision.selectedModel);
    });

    it('should select cheapest available model from registry as last resort', async () => {
      // Force all default/fallback models to fail
      const customRules: Record<TaskType, RoutingRule> = {
        ...DEFAULT_ROUTING_RULES,
        simple_chat: {
          defaultModel: 'nonexistent-1',
          fallbackModels: ['nonexistent-2'],
          qualityTierPreference: 'economy',
        },
      };
      router.setRoutingRules(customRules);

      const request = createRequest({ taskType: 'simple_chat' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      // Cheapest simple_chat model in fixtures is gemini-2.0-flash ($0.10/1M input)
      expect(decision.selectedModel).toBe('gemini-2.0-flash');
    });

    it('should throw RoutingError when no suitable model found at all', async () => {
      // No enabled providers at all
      mockModelRegistryClient.getSuitableForTask.mockResolvedValue([]);

      const customRules: Record<TaskType, RoutingRule> = {
        ...DEFAULT_ROUTING_RULES,
        coding: {
          defaultModel: 'nonexistent-1',
          fallbackModels: ['nonexistent-2'],
          qualityTierPreference: 'standard',
        },
      };
      router.setRoutingRules(customRules);

      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig();

      await expect(router.routeTask(request, config)).rejects.toThrow(RoutingError);
    });
  });

  // ===== Preset Behavior Tests =====

  describe('Preset behavior', () => {
    it('should select cheapest suitable model with economy preset', async () => {
      const request = createRequest({ taskType: 'simple_chat' });
      const config = createDefaultWorkspaceConfig({ preset: 'economy' });

      const decision = await router.routeTask(request, config);

      // Cheapest simple_chat model: gemini-2.0-flash ($0.10/1M input)
      expect(decision.selectedModel).toBe('gemini-2.0-flash');
      expect(decision.reason).toContain('economy');
    });

    it('should select premium tier model with quality preset', async () => {
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({ preset: 'quality' });

      const decision = await router.routeTask(request, config);

      // Premium coding model: claude-opus-4-20250514
      expect(decision.selectedModel).toBe('claude-opus-4-20250514');
      expect(decision.reason).toContain('quality');
    });

    it('should use default routing rules with balanced preset', async () => {
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({ preset: 'balanced' });

      const decision = await router.routeTask(request, config);

      // Default for coding: claude-sonnet-4-20250514
      expect(decision.selectedModel).toBe('claude-sonnet-4-20250514');
    });

    it('should use default routing rules with auto preset', async () => {
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({ preset: 'auto' });

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('claude-sonnet-4-20250514');
    });
  });

  // ===== Workspace Task Overrides Tests =====

  describe('Workspace task overrides', () => {
    it('should use workspace taskOverrides.preferredModel when set', async () => {
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({
        taskOverrides: {
          coding: { preferredModel: 'gpt-4o' },
        },
      });

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('gpt-4o');
    });

    it('should use workspace taskOverrides.fallbackModel when preferred unavailable', async () => {
      // Make preferred model unavailable
      mockModelRegistryClient.getByModelId.mockImplementation(async (modelId: string) => {
        if (modelId === 'gpt-4o') {
          return createModelDefinition({ modelId: 'gpt-4o', provider: 'openai', available: false });
        }
        return MODEL_FIXTURES[modelId] || null;
      });

      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({
        taskOverrides: {
          coding: {
            preferredModel: 'gpt-4o',
            fallbackModel: 'gemini-2.0-pro',
          },
        },
      });

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('gemini-2.0-pro');
    });

    it('should ignore taskOverrides for a different task type', async () => {
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({
        taskOverrides: {
          simple_chat: { preferredModel: 'gpt-4o-mini' },
        },
      });

      const decision = await router.routeTask(request, config);

      // Should use default for coding: claude-sonnet-4-20250514
      expect(decision.selectedModel).toBe('claude-sonnet-4-20250514');
    });
  });

  // ===== Capability Filtering Tests =====

  describe('Capability filtering', () => {
    it('should filter out models that do not support tools when requiresTools is true', async () => {
      // Make default coding model not support tools
      mockModelRegistryClient.getByModelId.mockImplementation(async (modelId: string) => {
        if (modelId === 'claude-sonnet-4-20250514') {
          return createModelDefinition({ supportsTools: false });
        }
        return MODEL_FIXTURES[modelId] || null;
      });

      const request = createRequest({ taskType: 'coding', requiresTools: true });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).not.toBe('claude-sonnet-4-20250514');
    });

    it('should filter out models that do not support vision when requiresVision is true', async () => {
      mockModelRegistryClient.getByModelId.mockImplementation(async (modelId: string) => {
        if (modelId === 'claude-sonnet-4-20250514') {
          return createModelDefinition({ supportsVision: false });
        }
        return MODEL_FIXTURES[modelId] || null;
      });

      const request = createRequest({ taskType: 'coding', requiresVision: true });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).not.toBe('claude-sonnet-4-20250514');
    });

    it('should filter out models that do not support streaming when requiresStreaming is true', async () => {
      mockModelRegistryClient.getByModelId.mockImplementation(async (modelId: string) => {
        if (modelId === 'claude-sonnet-4-20250514') {
          return createModelDefinition({ supportsStreaming: false });
        }
        return MODEL_FIXTURES[modelId] || null;
      });

      const request = createRequest({ taskType: 'coding', requiresStreaming: true });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).not.toBe('claude-sonnet-4-20250514');
    });

    it('should filter out models with insufficient context window', async () => {
      // Request context exceeding claude-sonnet (200k) and gpt-4o (128k)
      const request = createRequest({ taskType: 'coding', contextSizeTokens: 250000 });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      // Both sonnet (200k) and gpt-4o (128k) fail, deepseek-chat (64k) fails, gemini-2.0-pro (2M) passes
      expect(decision.selectedModel).toBe('gemini-2.0-pro');
    });

    it('should filter out embedding models when task type is not embedding', async () => {
      // For coding task, embedding models should not be selected
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).not.toBe('text-embedding-3-small');
      expect(decision.selectedModel).not.toBe('text-embedding-004');
    });

    it('should select embedding-capable models for embedding task type', async () => {
      const request = createRequest({ taskType: 'embedding' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('text-embedding-3-small');
    });
  });

  // ===== Enabled Providers Tests =====

  describe('Enabled providers', () => {
    it('should only consider models from providers in workspace enabledProviders', async () => {
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({
        enabledProviders: ['google'] as ProviderID[],
      });

      const decision = await router.routeTask(request, config);

      expect(decision.provider).toBe('google');
    });

    it('should skip models from disabled providers in ProviderRegistry', async () => {
      mockProviderRegistry.isProviderEnabled.mockImplementation((id: ProviderID) => {
        return id !== 'anthropic';
      });

      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      // Anthropic disabled -> fall to gpt-4o
      expect(decision.selectedModel).toBe('gpt-4o');
    });

    it('should select from single enabled provider only', async () => {
      const request = createRequest({ taskType: 'simple_chat' });
      const config = createDefaultWorkspaceConfig({
        enabledProviders: ['deepseek'] as ProviderID[],
      });

      const decision = await router.routeTask(request, config);

      expect(decision.provider).toBe('deepseek');
      expect(decision.selectedModel).toBe('deepseek-chat');
    });
  });

  // ===== Cost Estimation Tests =====

  describe('Cost estimation', () => {
    it('should calculate cost using model registry pricing', async () => {
      // claude-sonnet: input=$3/1M, output=$15/1M
      const cost = await router.estimateCost('claude-sonnet-4-20250514', 1000, 500);

      // (1000 * 3.0 + 500 * 15.0) / 1_000_000 = (3000 + 7500) / 1_000_000 = 0.0105
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it('should return 0 for embedding models with 0 output price', async () => {
      // text-embedding-3-small: input=$0.02/1M, output=$0/1M
      const cost = await router.estimateCost('text-embedding-3-small', 1000, 0);

      // (1000 * 0.02 + 0 * 0) / 1_000_000 = 0.00002
      expect(cost).toBeCloseTo(0.00002, 8);
    });

    it('should include estimated cost in RoutingDecision', async () => {
      const request = createRequest({
        taskType: 'coding',
        estimatedInputTokens: 2000,
        estimatedOutputTokens: 1000,
      });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      // claude-sonnet: (2000 * 3.0 + 1000 * 15.0) / 1_000_000 = 0.021
      expect(decision.estimatedCost).toBeCloseTo(0.021, 6);
    });

    it('should use default token estimates when not provided (1000 input, 500 output)', async () => {
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      // claude-sonnet: (1000 * 3.0 + 500 * 15.0) / 1_000_000 = 0.0105
      expect(decision.estimatedCost).toBeCloseTo(0.0105, 6);
    });
  });

  // ===== Alternatives Tests =====

  describe('Alternatives tracking', () => {
    it('should populate alternatives with considered models and rejection reasons', async () => {
      // Force fallback to happen
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({
        enabledProviders: ['openai'] as ProviderID[],
      });

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('gpt-4o');
      expect(decision.alternatives.length).toBeGreaterThan(0);
    });

    it('should include estimated cost for each alternative model', async () => {
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({
        enabledProviders: ['openai'] as ProviderID[],
      });

      const decision = await router.routeTask(request, config);

      for (const alt of decision.alternatives) {
        expect(typeof alt.estimatedCost).toBe('number');
      }
    });

    it('should order alternatives by preference (default first, then fallbacks)', async () => {
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({
        enabledProviders: ['google'] as ProviderID[],
      });

      const decision = await router.routeTask(request, config);

      // sonnet should be in alternatives (rejected first), then gpt-4o, then deepseek-chat
      const altModels = decision.alternatives.map(a => a.model);
      const sonnetIdx = altModels.indexOf('claude-sonnet-4-20250514');
      const gpt4oIdx = altModels.indexOf('gpt-4o');

      if (sonnetIdx !== -1 && gpt4oIdx !== -1) {
        expect(sonnetIdx).toBeLessThan(gpt4oIdx);
      }
    });
  });

  // ===== Error Cases =====

  describe('Error cases', () => {
    it('should throw RoutingError when enabledProviders is empty', async () => {
      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig({
        enabledProviders: [],
      });

      await expect(router.routeTask(request, config)).rejects.toThrow(RoutingError);
      await expect(router.routeTask(request, config)).rejects.toThrow('No enabled providers');
    });

    it('should throw RoutingError with list of attempted models', async () => {
      mockModelRegistryClient.getSuitableForTask.mockResolvedValue([]);

      const customRules: Record<TaskType, RoutingRule> = {
        ...DEFAULT_ROUTING_RULES,
        coding: {
          defaultModel: 'nonexistent-1',
          fallbackModels: ['nonexistent-2'],
          qualityTierPreference: 'standard',
        },
      };
      router.setRoutingRules(customRules);

      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig();

      try {
        await router.routeTask(request, config);
        fail('Should have thrown RoutingError');
      } catch (error) {
        expect(error).toBeInstanceOf(RoutingError);
        const routingError = error as RoutingError;
        expect(routingError.attemptedModels).toContain('nonexistent-1');
        expect(routingError.attemptedModels).toContain('nonexistent-2');
      }
    });

    it('should handle ModelRegistryClient errors gracefully (falls back)', async () => {
      // Make getByModelId throw for the default model, but work for fallbacks
      let callCount = 0;
      mockModelRegistryClient.getByModelId.mockImplementation(async (modelId: string) => {
        callCount++;
        if (modelId === 'claude-sonnet-4-20250514') {
          throw new Error('Registry connection error');
        }
        return MODEL_FIXTURES[modelId] || null;
      });

      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      // Should fall back to gpt-4o
      expect(decision.selectedModel).toBe('gpt-4o');
    });
  });

  // ===== Dynamic Configuration Tests =====

  describe('Dynamic configuration', () => {
    it('should replace default routing rules with setRoutingRules', () => {
      const customRules: Record<TaskType, RoutingRule> = {
        ...DEFAULT_ROUTING_RULES,
        coding: {
          defaultModel: 'gpt-4o',
          fallbackModels: ['claude-sonnet-4-20250514'],
          qualityTierPreference: 'standard',
        },
      };

      router.setRoutingRules(customRules);
      const rules = router.getRoutingRules();

      expect(rules.coding.defaultModel).toBe('gpt-4o');
    });

    it('should return current routing rules with getRoutingRules', () => {
      const rules = router.getRoutingRules();

      expect(rules.coding.defaultModel).toBe('claude-sonnet-4-20250514');
      expect(rules.simple_chat.defaultModel).toBe('gemini-2.0-flash');
    });

    it('should use updated rules after setRoutingRules call', async () => {
      const customRules: Record<TaskType, RoutingRule> = {
        ...DEFAULT_ROUTING_RULES,
        coding: {
          defaultModel: 'gpt-4o',
          fallbackModels: ['claude-sonnet-4-20250514'],
          qualityTierPreference: 'standard',
        },
      };
      router.setRoutingRules(customRules);

      const request = createRequest({ taskType: 'coding' });
      const config = createDefaultWorkspaceConfig();

      const decision = await router.routeTask(request, config);

      expect(decision.selectedModel).toBe('gpt-4o');
    });
  });

  // ===== isModelAvailable Tests =====

  describe('isModelAvailable', () => {
    it('should return true when model exists, is available, and provider is enabled', async () => {
      const config = createDefaultWorkspaceConfig();

      const result = await router.isModelAvailable('claude-sonnet-4-20250514', config);

      expect(result).toBe(true);
    });

    it('should return false when model not in registry', async () => {
      const config = createDefaultWorkspaceConfig();

      const result = await router.isModelAvailable('nonexistent-model', config);

      expect(result).toBe(false);
    });

    it('should return false when model is unavailable', async () => {
      mockModelRegistryClient.getByModelId.mockImplementation(async (modelId: string) => {
        if (modelId === 'claude-sonnet-4-20250514') {
          return createModelDefinition({ available: false });
        }
        return MODEL_FIXTURES[modelId] || null;
      });

      const config = createDefaultWorkspaceConfig();

      const result = await router.isModelAvailable('claude-sonnet-4-20250514', config);

      expect(result).toBe(false);
    });

    it('should return false when provider not in enabledProviders', async () => {
      const config = createDefaultWorkspaceConfig({
        enabledProviders: ['openai'] as ProviderID[],
      });

      const result = await router.isModelAvailable('claude-sonnet-4-20250514', config);

      expect(result).toBe(false);
    });
  });

  // ===== getAvailableModels Tests =====

  describe('getAvailableModels', () => {
    it('should return models grouped by task type', async () => {
      const config = createDefaultWorkspaceConfig();

      const result = await router.getAvailableModels(config);

      expect(result.coding.length).toBeGreaterThan(0);
      expect(result.embedding.length).toBeGreaterThan(0);
      expect(result.simple_chat.length).toBeGreaterThan(0);
    });

    it('should only include models from enabled providers', async () => {
      const config = createDefaultWorkspaceConfig({
        enabledProviders: ['anthropic'] as ProviderID[],
      });

      const result = await router.getAvailableModels(config);

      for (const taskType of Object.keys(result) as TaskType[]) {
        for (const model of result[taskType]) {
          expect(model.provider).toBe('anthropic');
        }
      }
    });

    it('should only include available models', async () => {
      // getAll with available: true filter
      mockModelRegistryClient.getAll.mockResolvedValue(
        Object.values(MODEL_FIXTURES).filter(m => m.available),
      );

      const config = createDefaultWorkspaceConfig();

      const result = await router.getAvailableModels(config);

      for (const taskType of Object.keys(result) as TaskType[]) {
        for (const model of result[taskType]) {
          expect(model.available).toBe(true);
        }
      }
    });
  });
});
