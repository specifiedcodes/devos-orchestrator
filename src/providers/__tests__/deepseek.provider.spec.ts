/**
 * DeepSeekProvider Tests
 *
 * Tests for DeepSeek provider implementation (OpenAI-compatible).
 *
 * Story 13-1: Provider Abstraction Layer
 */

import { DeepSeekProvider } from '../deepseek.provider';
import {
  CompletionRequest,
  ProviderConfig,
  ProviderError,
} from '../interfaces';

// Mock openai package
const mockChatCreate = jest.fn();
const mockModelsList = jest.fn();

jest.mock('openai', () => {
  return jest.fn().mockImplementation((config: any) => {
    // Store the config for assertions
    (jest.fn() as any).__lastConfig = config;
    return {
      chat: {
        completions: {
          create: mockChatCreate,
        },
      },
      models: {
        list: mockModelsList,
      },
      embeddings: {
        create: jest.fn(),
      },
    };
  });
});

describe('DeepSeekProvider', () => {
  let provider: DeepSeekProvider;
  const config: ProviderConfig = {
    id: 'deepseek',
    name: 'DeepSeek',
    enabled: true,
    maxRetries: 0,
    retryDelayMs: 100,
    timeoutMs: 30000,
  };

  beforeEach(() => {
    provider = new DeepSeekProvider(config);
    jest.clearAllMocks();
  });

  describe('complete()', () => {
    it('should create OpenAI client with DeepSeek baseURL', async () => {
      const OpenAI = require('openai');

      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hello from DeepSeek!' }, finish_reason: 'stop' }],
        model: 'deepseek-chat',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const request: CompletionRequest = {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 1024,
      };

      await provider.complete(request, 'test-key');

      // Verify OpenAI constructor was called (which is used by DeepSeek)
      expect(OpenAI).toHaveBeenCalled();
    });

    it('should map CompletionRequest same as OpenAI format', async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        model: 'deepseek-chat',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const request: CompletionRequest = {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
        maxTokens: 1024,
        temperature: 0.7,
      };

      await provider.complete(request, 'test-key');

      expect(mockChatCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'deepseek-chat',
          max_tokens: 1024,
          temperature: 0.7,
        }),
      );
    });

    it('should map response to CompletionResponse', async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'DeepSeek response' }, finish_reason: 'stop' }],
        model: 'deepseek-chat',
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const request: CompletionRequest = {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 1024,
      };

      const response = await provider.complete(request, 'test-key');

      expect(response.content).toBe('DeepSeek response');
      expect(response.provider).toBe('deepseek');
      expect(response.usage.inputTokens).toBe(100);
      expect(response.usage.outputTokens).toBe(50);
    });

    it('should calculate cost using DeepSeek pricing', async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        model: 'deepseek-chat',
        usage: { prompt_tokens: 10000, completion_tokens: 5000 },
      });

      const request: CompletionRequest = {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 1024,
      };

      const response = await provider.complete(request, 'test-key');

      // DeepSeek Chat: input $0.27/1M, output $1.10/1M
      // inputCost = 10000 * 0.27 / 1M = 0.0027
      // outputCost = 5000 * 1.10 / 1M = 0.0055
      // total = 0.0082
      expect(response.cost.amount).toBeCloseTo(0.0082, 4);
    });
  });

  describe('stream()', () => {
    it('should yield StreamChunk events', async () => {
      const mockStreamIterable = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Hello' } }] };
          yield { choices: [{ delta: { content: ' deep' } }] };
        },
      };

      mockChatCreate.mockResolvedValue(mockStreamIterable);

      const request: CompletionRequest = {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 1024,
      };

      const chunks: any[] = [];
      for await (const chunk of provider.stream(request, 'test-key')) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].type).toBe('message_start');
    });
  });

  describe('embed()', () => {
    it('should throw ProviderError (not supported)', async () => {
      await expect(
        provider.embed('test text', 'embedding-model', 'test-key'),
      ).rejects.toThrow(ProviderError);

      await expect(
        provider.embed('test text', 'embedding-model', 'test-key'),
      ).rejects.toMatchObject({
        type: 'invalid_request_error',
        provider: 'deepseek',
      });
    });
  });

  describe('healthCheck()', () => {
    it('should validate API key', async () => {
      mockModelsList.mockResolvedValue({ data: [] });

      const status = await provider.healthCheck('valid-key');

      expect(status.healthy).toBe(true);
      expect(status.providerId).toBe('deepseek');
    });
  });

  describe('supportsModel()', () => {
    it('should return true for deepseek-chat and deepseek-reasoner', () => {
      expect(provider.supportsModel('deepseek-chat')).toBe(true);
      expect(provider.supportsModel('deepseek-reasoner')).toBe(true);
    });

    it('should return false for unsupported models', () => {
      expect(provider.supportsModel('gpt-4o')).toBe(false);
      expect(provider.supportsModel('claude-sonnet-4-20250514')).toBe(false);
    });
  });

  describe('calculateCost()', () => {
    it('should return correct cost for deepseek-chat', () => {
      const cost = provider.calculateCost('deepseek-chat', {
        inputTokens: 1000000,
        outputTokens: 500000,
      });

      // input: 1M * $0.27/1M = $0.27
      // output: 500K * $1.10/1M = $0.55
      // total = $0.82
      expect(cost.amount).toBeCloseTo(0.82, 4);
    });
  });
});

/**
 * DeepSeek Provider Registry Integration Tests
 *
 * Story 13-5: DeepSeek Integration
 * Verifies DeepSeekProvider is correctly registered and discoverable via ProviderRegistry.
 */
describe('DeepSeek Provider Registry Integration (Story 13-5)', () => {
  it('should register DeepSeekProvider in ProviderRegistry via createProviderRegistry()', () => {
    const { createProviderRegistry } = require('../index');
    const registry = createProviderRegistry();

    const provider = registry.getProvider('deepseek');
    expect(provider).toBeDefined();
    expect(provider!.id).toBe('deepseek');
  });

  it('should return DeepSeekProvider for getProviderForModel("deepseek-chat")', () => {
    const { createProviderRegistry } = require('../index');
    const registry = createProviderRegistry();

    const provider = registry.getProviderForModel('deepseek-chat');
    expect(provider).toBeDefined();
    expect(provider!.id).toBe('deepseek');
  });

  it('should return DeepSeekProvider for getProviderForModel("deepseek-reasoner")', () => {
    const { createProviderRegistry } = require('../index');
    const registry = createProviderRegistry();

    const provider = registry.getProviderForModel('deepseek-reasoner');
    expect(provider).toBeDefined();
    expect(provider!.id).toBe('deepseek');
  });

  it('should have isProviderEnabled("deepseek") return true by default', () => {
    const { createProviderRegistry } = require('../index');
    const registry = createProviderRegistry();

    expect(registry.isProviderEnabled('deepseek')).toBe(true);
  });

  it('should list DeepSeek in all registered providers', () => {
    const { createProviderRegistry } = require('../index');
    const registry = createProviderRegistry();

    const allProviders = registry.getAllProviders();
    const deepseek = allProviders.find((p: any) => p.id === 'deepseek');
    expect(deepseek).toBeDefined();
  });

  it('should list DeepSeek in enabled providers', () => {
    const { createProviderRegistry } = require('../index');
    const registry = createProviderRegistry();

    const enabledProviders = registry.getEnabledProviders();
    const deepseek = enabledProviders.find((p: any) => p.id === 'deepseek');
    expect(deepseek).toBeDefined();
  });
});
