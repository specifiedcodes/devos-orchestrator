/**
 * OpenAIProvider Tests
 *
 * Tests for OpenAI GPT provider implementation.
 *
 * Story 13-1: Provider Abstraction Layer
 */

import { OpenAIProvider } from '../openai.provider';
import {
  CompletionRequest,
  ProviderConfig,
  ProviderError,
} from '../interfaces';

// Mock openai package
const mockChatCreate = jest.fn();
const mockEmbeddingsCreate = jest.fn();
const mockModelsList = jest.fn();

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockChatCreate,
      },
    },
    embeddings: {
      create: mockEmbeddingsCreate,
    },
    models: {
      list: mockModelsList,
    },
  }));
});

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  const config: ProviderConfig = {
    id: 'openai',
    name: 'OpenAI',
    enabled: true,
    maxRetries: 0,
    retryDelayMs: 100,
    timeoutMs: 30000,
  };

  beforeEach(() => {
    provider = new OpenAIProvider(config);
    jest.clearAllMocks();
  });

  describe('complete()', () => {
    const baseRequest: CompletionRequest = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      maxTokens: 1024,
    };

    it('should map CompletionRequest to OpenAI Chat API format', async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hi!' }, finish_reason: 'stop' }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      await provider.complete(baseRequest, 'test-key');

      expect(mockChatCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          max_tokens: 1024,
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Hello' },
          ],
        }),
      );
    });

    it('should map OpenAI response to CompletionResponse', async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hello from GPT!' }, finish_reason: 'stop' }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const response = await provider.complete(baseRequest, 'test-key');

      expect(response.content).toBe('Hello from GPT!');
      expect(response.model).toBe('gpt-4o');
      expect(response.usage.inputTokens).toBe(100);
      expect(response.usage.outputTokens).toBe(50);
      expect(response.provider).toBe('openai');
    });

    it('should map finish_reason correctly (stop -> end_turn, length -> max_tokens)', async () => {
      // Test stop -> end_turn
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
      let response = await provider.complete(baseRequest, 'test-key');
      expect(response.finishReason).toBe('end_turn');

      // Test length -> max_tokens
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' }, finish_reason: 'length' }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
      response = await provider.complete(baseRequest, 'test-key');
      expect(response.finishReason).toBe('max_tokens');

      // Test tool_calls -> tool_use
      mockChatCreate.mockResolvedValue({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 'call_1', function: { name: 'fn', arguments: '{}' } }],
          },
          finish_reason: 'tool_calls',
        }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
      response = await provider.complete(baseRequest, 'test-key');
      expect(response.finishReason).toBe('tool_use');
    });

    it('should calculate cost based on model pricing', async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        model: 'gpt-4o-mini',
        usage: { prompt_tokens: 10000, completion_tokens: 5000 },
      });

      const request = { ...baseRequest, model: 'gpt-4o-mini' };
      const response = await provider.complete(request, 'test-key');

      // GPT-4o-mini: input $0.15/1M, output $0.60/1M
      // inputCost = 10000 * 0.15 / 1M = 0.0015
      // outputCost = 5000 * 0.60 / 1M = 0.003
      // total = 0.0045
      expect(response.cost.amount).toBeCloseTo(0.0045, 6);
    });
  });

  describe('stream()', () => {
    it('should yield StreamChunk events from OpenAI stream', async () => {
      const mockStreamIterable = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Hello' } }] };
          yield { choices: [{ delta: { content: ' world' } }] };
        },
      };

      mockChatCreate.mockResolvedValue(mockStreamIterable);

      const request: CompletionRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 1024,
      };

      const chunks: any[] = [];
      for await (const chunk of provider.stream(request, 'test-key')) {
        chunks.push(chunk);
      }

      expect(chunks[0].type).toBe('message_start');
      expect(chunks[1].type).toBe('content_delta');
      expect(chunks[1].content).toBe('Hello');
      expect(chunks[2].type).toBe('content_delta');
      expect(chunks[2].content).toBe(' world');
    });
  });

  describe('embed()', () => {
    it('should return embedding vector from OpenAI API', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      const result = await provider.embed('test text', 'text-embedding-3-small', 'test-key');

      expect(result).toEqual(mockEmbedding);
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test text',
      });
    });

    it('should throw on non-embedding model', async () => {
      await expect(
        provider.embed('test text', 'gpt-4o', 'test-key'),
      ).rejects.toThrow(ProviderError);

      await expect(
        provider.embed('test text', 'gpt-4o', 'test-key'),
      ).rejects.toMatchObject({
        type: 'invalid_request_error',
      });
    });
  });

  describe('healthCheck()', () => {
    it('should validate API key via models.list', async () => {
      mockModelsList.mockResolvedValue({ data: [] });

      const status = await provider.healthCheck('valid-key');

      expect(status.healthy).toBe(true);
      expect(status.providerId).toBe('openai');
    });
  });

  describe('mapError()', () => {
    it('should map 401 to authentication_error', () => {
      const error = { status: 401, message: 'Unauthorized' };
      const result = provider.mapError(error);

      expect(result.type).toBe('authentication_error');
      expect(result.retryable).toBe(false);
    });

    it('should map 429 to rate_limit_error (retryable)', () => {
      const error = { status: 429, message: 'Rate limited' };
      const result = provider.mapError(error);

      expect(result.type).toBe('rate_limit_error');
      expect(result.retryable).toBe(true);
    });
  });

  describe('supportsModel()', () => {
    it('should return true for GPT-4o and text-embedding-3-small', () => {
      expect(provider.supportsModel('gpt-4o')).toBe(true);
      expect(provider.supportsModel('gpt-4o-mini')).toBe(true);
      expect(provider.supportsModel('text-embedding-3-small')).toBe(true);
      expect(provider.supportsModel('text-embedding-3-large')).toBe(true);
    });

    it('should return false for unsupported models', () => {
      expect(provider.supportsModel('claude-sonnet-4-20250514')).toBe(false);
      expect(provider.supportsModel('unknown')).toBe(false);
    });
  });

  describe('calculateCost()', () => {
    it('should return correct cost for GPT-4o-mini', () => {
      const cost = provider.calculateCost('gpt-4o-mini', {
        inputTokens: 1000000,
        outputTokens: 500000,
      });

      // input: 1M * $0.15/1M = $0.15
      // output: 500K * $0.60/1M = $0.30
      // total = $0.45
      expect(cost.amount).toBeCloseTo(0.45, 4);
    });
  });
});
