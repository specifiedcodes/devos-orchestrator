/**
 * AnthropicProvider Tests
 *
 * Tests for Anthropic Claude provider implementation.
 *
 * Story 13-1: Provider Abstraction Layer
 */

import { AnthropicProvider } from '../anthropic.provider';
import {
  CompletionRequest,
  ProviderConfig,
  ProviderError,
} from '../interfaces';

// Mock @anthropic-ai/sdk
const mockCreate = jest.fn();
const mockStream = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
      stream: mockStream,
    },
  }));
});

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  const config: ProviderConfig = {
    id: 'anthropic',
    name: 'Anthropic',
    enabled: true,
    maxRetries: 0, // Disable retries for unit tests
    retryDelayMs: 100,
    timeoutMs: 30000,
  };

  beforeEach(() => {
    provider = new AnthropicProvider(config);
    jest.clearAllMocks();
  });

  describe('complete()', () => {
    const baseRequest: CompletionRequest = {
      model: 'claude-sonnet-4-20250514',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ],
      maxTokens: 1024,
    };

    it('should map CompletionRequest to Anthropic API format correctly', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Hi there!' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await provider.complete(baseRequest, 'test-key');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: 'You are a helpful assistant.',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      );
    });

    it('should extract system message from messages array', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await provider.complete(baseRequest, 'test-key');

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toBe('You are a helpful assistant.');
      expect(callArgs.messages).not.toContainEqual(
        expect.objectContaining({ role: 'system' }),
      );
    });

    it('should map Anthropic response to CompletionResponse', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello from Claude!' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const response = await provider.complete(baseRequest, 'test-key');

      expect(response.content).toBe('Hello from Claude!');
      expect(response.model).toBe('claude-sonnet-4-20250514');
      expect(response.finishReason).toBe('end_turn');
      expect(response.provider).toBe('anthropic');
      expect(response.usage.inputTokens).toBe(100);
      expect(response.usage.outputTokens).toBe(50);
    });

    it('should calculate cost based on token usage and model pricing', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 1000, output_tokens: 500 },
      });

      const response = await provider.complete(baseRequest, 'test-key');

      // Sonnet: input $3.00/1M, output $15.00/1M
      // inputCost = 1000 * 3.00 / 1_000_000 = 0.003
      // outputCost = 500 * 15.00 / 1_000_000 = 0.0075
      // total = 0.0105
      expect(response.cost.amount).toBeCloseTo(0.0105, 6);
      expect(response.cost.currency).toBe('USD');
    });

    it('should measure and report latency', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const response = await provider.complete(baseRequest, 'test-key');

      expect(response.latency).toBeGreaterThanOrEqual(0);
      expect(typeof response.latency).toBe('number');
    });

    it('should map tool definitions correctly', async () => {
      const requestWithTools: CompletionRequest = {
        ...baseRequest,
        tools: [{
          name: 'get_weather',
          description: 'Get the weather',
          inputSchema: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        }],
      };

      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await provider.complete(requestWithTools, 'test-key');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [{
            name: 'get_weather',
            description: 'Get the weather',
            input_schema: {
              type: 'object',
              properties: { city: { type: 'string' } },
            },
          }],
        }),
      );
    });

    it('should handle tool_use finish reason', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'Let me check' },
          { type: 'tool_use', id: 'tool_1', name: 'get_weather', input: { city: 'NYC' } },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const response = await provider.complete(baseRequest, 'test-key');

      expect(response.finishReason).toBe('tool_use');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0]).toEqual({
        id: 'tool_1',
        name: 'get_weather',
        input: { city: 'NYC' },
      });
    });
  });

  describe('stream()', () => {
    it('should yield StreamChunk events from Anthropic stream', async () => {
      const mockStreamIterable = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } };
        },
        finalMessage: jest.fn().mockResolvedValue({
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };

      mockStream.mockReturnValue(mockStreamIterable);

      const request: CompletionRequest = {
        model: 'claude-sonnet-4-20250514',
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

    it('should yield message_end with usage info', async () => {
      const mockStreamIterable = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } };
        },
        finalMessage: jest.fn().mockResolvedValue({
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      };

      mockStream.mockReturnValue(mockStreamIterable);

      const request: CompletionRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 1024,
      };

      const chunks: any[] = [];
      for await (const chunk of provider.stream(request, 'test-key')) {
        chunks.push(chunk);
      }

      const endChunk = chunks.find(c => c.type === 'message_end');
      expect(endChunk).toBeDefined();
      expect(endChunk.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
      });
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
        provider: 'anthropic',
      });
    });
  });

  describe('healthCheck()', () => {
    it('should return healthy status when API key is valid', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'hi' }],
        model: 'claude-haiku-3-5-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      });

      const status = await provider.healthCheck('valid-key');

      expect(status.healthy).toBe(true);
      expect(status.providerId).toBe('anthropic');
      expect(status.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should return unhealthy status when API key is invalid', async () => {
      const error = new Error('Invalid API key');
      (error as any).status = 401;
      mockCreate.mockRejectedValue(error);

      const status = await provider.healthCheck('invalid-key');

      expect(status.healthy).toBe(false);
      expect(status.providerId).toBe('anthropic');
      expect(status.errorMessage).toContain('Invalid API key');
    });
  });

  describe('mapError()', () => {
    it('should map authentication_error correctly', () => {
      const error = { status: 401, message: 'Invalid API key', error: { type: 'authentication_error' } };
      const result = provider.mapError(error);

      expect(result.type).toBe('authentication_error');
      expect(result.statusCode).toBe(401);
      expect(result.retryable).toBe(false);
    });

    it('should map rate_limit_error as retryable', () => {
      const error = { status: 429, message: 'Rate limited', error: { type: 'rate_limit_error' } };
      const result = provider.mapError(error);

      expect(result.type).toBe('rate_limit_error');
      expect(result.retryable).toBe(true);
    });

    it('should map overloaded_error as retryable server_error', () => {
      const error = { status: 529, message: 'Overloaded', error: { type: 'overloaded_error' } };
      const result = provider.mapError(error);

      expect(result.type).toBe('server_error');
      expect(result.retryable).toBe(true);
    });
  });

  describe('supportsModel()', () => {
    it('should return true for supported Claude models', () => {
      expect(provider.supportsModel('claude-opus-4-20250514')).toBe(true);
      expect(provider.supportsModel('claude-sonnet-4-20250514')).toBe(true);
      expect(provider.supportsModel('claude-haiku-3-5-20241022')).toBe(true);
    });

    it('should return false for unsupported models', () => {
      expect(provider.supportsModel('gpt-4o')).toBe(false);
      expect(provider.supportsModel('gemini-2.0-flash')).toBe(false);
      expect(provider.supportsModel('unknown-model')).toBe(false);
    });
  });

  describe('calculateCost()', () => {
    it('should return correct cost for Sonnet model', () => {
      const cost = provider.calculateCost('claude-sonnet-4-20250514', {
        inputTokens: 10000,
        outputTokens: 5000,
      });

      // input: 10000 * 3.00 / 1M = 0.03
      // output: 5000 * 15.00 / 1M = 0.075
      // total = 0.105
      expect(cost.amount).toBeCloseTo(0.105, 6);
      expect(cost.currency).toBe('USD');
    });
  });
});
