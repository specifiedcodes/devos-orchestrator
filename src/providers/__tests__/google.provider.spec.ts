/**
 * GoogleAIProvider Tests
 *
 * Tests for Google Gemini provider implementation.
 *
 * Story 13-1: Provider Abstraction Layer
 * Story 13-4: Google Gemini Integration (safety settings, registry verification)
 */

import { GoogleAIProvider } from '../google.provider';
import {
  CompletionRequest,
  ProviderConfig,
  ProviderError,
} from '../interfaces';

// Mock @google/generative-ai
const mockGenerateContent = jest.fn();
const mockGenerateContentStream = jest.fn();
const mockEmbedContent = jest.fn();

jest.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue({
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
        embedContent: mockEmbedContent,
      }),
    })),
    HarmCategory: {
      HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
      HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
      HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
    },
    HarmBlockThreshold: {
      BLOCK_NONE: 'BLOCK_NONE',
      BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH',
      BLOCK_MEDIUM_AND_ABOVE: 'BLOCK_MEDIUM_AND_ABOVE',
      BLOCK_LOW_AND_ABOVE: 'BLOCK_LOW_AND_ABOVE',
    },
    FunctionDeclarationSchemaType: {},
  };
});

describe('GoogleAIProvider', () => {
  let provider: GoogleAIProvider;
  const config: ProviderConfig = {
    id: 'google',
    name: 'Google AI',
    enabled: true,
    maxRetries: 0,
    retryDelayMs: 100,
    timeoutMs: 30000,
  };

  beforeEach(() => {
    provider = new GoogleAIProvider(config);
    jest.clearAllMocks();
  });

  describe('complete()', () => {
    const baseRequest: CompletionRequest = {
      model: 'gemini-2.0-flash',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      maxTokens: 1024,
    };

    it('should map CompletionRequest to Google AI format', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Hello from Gemini!',
          candidates: [{
            content: { parts: [{ text: 'Hello from Gemini!' }] },
            finishReason: 'STOP',
          }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        },
      });

      await provider.complete(baseRequest, 'test-key');

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          generationConfig: expect.objectContaining({
            maxOutputTokens: 1024,
          }),
        }),
      );
    });

    it('should set systemInstruction from system message', async () => {
      // The system message is set via getGenerativeModel config
      // We verify the messages passed to generateContent don't contain system
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Response',
          candidates: [{
            content: { parts: [{ text: 'Response' }] },
            finishReason: 'STOP',
          }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        },
      });

      await provider.complete(baseRequest, 'test-key');

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.contents).not.toContainEqual(
        expect.objectContaining({ role: 'system' }),
      );
    });

    it('should map Google response to CompletionResponse', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Hello from Gemini!',
          candidates: [{
            content: { parts: [{ text: 'Hello from Gemini!' }] },
            finishReason: 'STOP',
          }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        },
      });

      const response = await provider.complete(baseRequest, 'test-key');

      expect(response.content).toBe('Hello from Gemini!');
      expect(response.model).toBe('gemini-2.0-flash');
      expect(response.finishReason).toBe('end_turn');
      expect(response.provider).toBe('google');
      expect(response.usage.inputTokens).toBe(100);
      expect(response.usage.outputTokens).toBe(50);
    });

    it('should handle SAFETY finish reason as content_filter_error', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => '',
          candidates: [{
            content: { parts: [{ text: '' }] },
            finishReason: 'SAFETY',
          }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
        },
      });

      await expect(
        provider.complete(baseRequest, 'test-key'),
      ).rejects.toMatchObject({
        type: 'content_filter_error',
      });
    });

    it('should calculate cost based on model pricing', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Response',
          candidates: [{
            content: { parts: [{ text: 'Response' }] },
            finishReason: 'STOP',
          }],
          usageMetadata: { promptTokenCount: 10000, candidatesTokenCount: 5000 },
        },
      });

      const response = await provider.complete(baseRequest, 'test-key');

      // Gemini Flash: input $0.10/1M, output $0.40/1M
      // inputCost = 10000 * 0.10 / 1M = 0.001
      // outputCost = 5000 * 0.40 / 1M = 0.002
      // total = 0.003
      expect(response.cost.amount).toBeCloseTo(0.003, 6);
    });
  });

  describe('stream()', () => {
    it('should yield StreamChunk events from Google stream', async () => {
      const mockStreamResponse = {
        stream: {
          [Symbol.asyncIterator]: async function* () {
            yield { text: () => 'Hello' };
            yield { text: () => ' world' };
          },
        },
        response: Promise.resolve({
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
      };

      mockGenerateContentStream.mockResolvedValue(mockStreamResponse);

      const request: CompletionRequest = {
        model: 'gemini-2.0-flash',
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
    it('should return embedding vector from Google API', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      mockEmbedContent.mockResolvedValue({
        embedding: { values: mockEmbedding },
      });

      const result = await provider.embed('test text', 'text-embedding-004', 'test-key');

      expect(result).toEqual(mockEmbedding);
    });

    it('should throw on non-embedding model', async () => {
      await expect(
        provider.embed('test text', 'gemini-2.0-flash', 'test-key'),
      ).rejects.toThrow(ProviderError);
    });
  });

  describe('healthCheck()', () => {
    it('should validate API key via model generation', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'ok',
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        },
      });

      const status = await provider.healthCheck('valid-key');

      expect(status.healthy).toBe(true);
      expect(status.providerId).toBe('google');
    });
  });

  describe('mapError()', () => {
    it('should map 403 to authentication_error', () => {
      const error = { status: 403, message: 'Forbidden' };
      const result = provider.mapError(error);

      expect(result.type).toBe('authentication_error');
    });

    it('should map safety block to content_filter_error', () => {
      const error = { message: 'Content blocked by SAFETY filter' };
      const result = provider.mapError(error);

      expect(result.type).toBe('content_filter_error');
    });
  });

  describe('supportsModel()', () => {
    it('should return true for Gemini models', () => {
      expect(provider.supportsModel('gemini-2.0-flash')).toBe(true);
      expect(provider.supportsModel('gemini-2.0-pro')).toBe(true);
      expect(provider.supportsModel('text-embedding-004')).toBe(true);
    });

    it('should return false for unsupported models', () => {
      expect(provider.supportsModel('gpt-4o')).toBe(false);
      expect(provider.supportsModel('claude-sonnet-4-20250514')).toBe(false);
    });
  });

  describe('calculateCost()', () => {
    it('should return correct cost for Gemini Flash', () => {
      const cost = provider.calculateCost('gemini-2.0-flash', {
        inputTokens: 1000000,
        outputTokens: 500000,
      });

      // input: 1M * $0.10/1M = $0.10
      // output: 500K * $0.40/1M = $0.20
      // total = $0.30
      expect(cost.amount).toBeCloseTo(0.30, 4);
    });
  });

  // ===== Story 13-4: Safety Settings Tests =====

  describe('Safety settings', () => {
    const baseRequest: CompletionRequest = {
      model: 'gemini-2.0-flash',
      messages: [
        { role: 'user', content: 'Hello' },
      ],
      maxTokens: 1024,
    };

    const successResponse = {
      response: {
        text: () => 'Response',
        candidates: [{
          content: { parts: [{ text: 'Response' }] },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      },
    };

    it('should apply default safety settings (BLOCK_ONLY_HIGH) to complete() calls', async () => {
      mockGenerateContent.mockResolvedValue(successResponse);

      await provider.complete(baseRequest, 'test-key');

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.safetySettings).toBeDefined();
      expect(callArgs.safetySettings).toHaveLength(4);
      // All categories should use BLOCK_ONLY_HIGH threshold by default
      for (const setting of callArgs.safetySettings) {
        expect(setting.threshold).toBe('BLOCK_ONLY_HIGH');
      }
    });

    it('should use BLOCK_ONLY_HIGH as default harmBlockThreshold', async () => {
      mockGenerateContent.mockResolvedValue(successResponse);

      await provider.complete(baseRequest, 'test-key');

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.safetySettings[0].threshold).toBe('BLOCK_ONLY_HIGH');
    });

    it('should apply custom safety settings from request.metadata.safetySettings in complete()', async () => {
      mockGenerateContent.mockResolvedValue(successResponse);

      const requestWithCustomSafety: CompletionRequest = {
        ...baseRequest,
        metadata: {
          safetySettings: {
            harmBlockThreshold: 'BLOCK_NONE',
          },
        },
      };

      await provider.complete(requestWithCustomSafety, 'test-key');

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.safetySettings).toBeDefined();
      for (const setting of callArgs.safetySettings) {
        expect(setting.threshold).toBe('BLOCK_NONE');
      }
    });

    it('should apply default safety settings to stream() calls', async () => {
      const mockStreamResponse = {
        stream: {
          [Symbol.asyncIterator]: async function* () {
            yield { text: () => 'Hello' };
          },
        },
        response: Promise.resolve({
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
      };
      mockGenerateContentStream.mockResolvedValue(mockStreamResponse);

      const chunks: any[] = [];
      for await (const chunk of provider.stream(baseRequest, 'test-key')) {
        chunks.push(chunk);
      }

      const callArgs = mockGenerateContentStream.mock.calls[0][0];
      expect(callArgs.safetySettings).toBeDefined();
      expect(callArgs.safetySettings).toHaveLength(4);
      for (const setting of callArgs.safetySettings) {
        expect(setting.threshold).toBe('BLOCK_ONLY_HIGH');
      }
    });

    it('should apply custom safety settings from request.metadata.safetySettings in stream()', async () => {
      const mockStreamResponse = {
        stream: {
          [Symbol.asyncIterator]: async function* () {
            yield { text: () => 'Hello' };
          },
        },
        response: Promise.resolve({
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
      };
      mockGenerateContentStream.mockResolvedValue(mockStreamResponse);

      const requestWithCustomSafety: CompletionRequest = {
        ...baseRequest,
        metadata: {
          safetySettings: {
            harmBlockThreshold: 'BLOCK_MEDIUM_AND_ABOVE',
          },
        },
      };

      const chunks: any[] = [];
      for await (const chunk of provider.stream(requestWithCustomSafety, 'test-key')) {
        chunks.push(chunk);
      }

      const callArgs = mockGenerateContentStream.mock.calls[0][0];
      expect(callArgs.safetySettings).toBeDefined();
      for (const setting of callArgs.safetySettings) {
        expect(setting.threshold).toBe('BLOCK_MEDIUM_AND_ABOVE');
      }
    });

    it('should throw content_filter_error with descriptive message when safety block returned', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => '',
          candidates: [{
            content: { parts: [{ text: '' }] },
            finishReason: 'SAFETY',
            safetyRatings: [
              { category: 'HARM_CATEGORY_HARASSMENT', probability: 'HIGH' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'NEGLIGIBLE' },
            ],
          }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
        },
      });

      await expect(
        provider.complete(baseRequest, 'test-key'),
      ).rejects.toMatchObject({
        type: 'content_filter_error',
        message: expect.stringContaining('HARM_CATEGORY_HARASSMENT'),
      });
    });

    it('should not affect embedding requests (no safetySettings on embed)', async () => {
      const mockEmbeddingResult = [0.1, 0.2, 0.3];
      mockEmbedContent.mockResolvedValue({
        embedding: { values: mockEmbeddingResult },
      });

      const result = await provider.embed('test text', 'text-embedding-004', 'test-key');

      expect(result).toEqual(mockEmbeddingResult);
      // embedContent should not have safetySettings
      const callArgs = mockEmbedContent.mock.calls[0];
      // embed calls embedContent directly with text only, no safetySettings
      expect(callArgs[0]).toBe('test text');
    });

    it('should include all 4 safety categories in settings', async () => {
      mockGenerateContent.mockResolvedValue(successResponse);

      await provider.complete(baseRequest, 'test-key');

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const categories = callArgs.safetySettings.map((s: any) => s.category);
      expect(categories).toContain('HARM_CATEGORY_HARASSMENT');
      expect(categories).toContain('HARM_CATEGORY_HATE_SPEECH');
      expect(categories).toContain('HARM_CATEGORY_SEXUALLY_EXPLICIT');
      expect(categories).toContain('HARM_CATEGORY_DANGEROUS_CONTENT');
    });
  });

  // ===== Story 13-4: Provider Registry Integration Verification =====

  describe('Provider Registry Integration', () => {
    it('should be instantiable as GoogleAIProvider', () => {
      expect(provider).toBeInstanceOf(GoogleAIProvider);
    });

    it('should have id "google"', () => {
      expect(provider.id).toBe('google');
    });

    it('should support gemini-2.0-flash model', () => {
      expect(provider.supportsModel('gemini-2.0-flash')).toBe(true);
    });

    it('should support gemini-2.0-pro model', () => {
      expect(provider.supportsModel('gemini-2.0-pro')).toBe(true);
    });

    it('should support text-embedding-004 model', () => {
      expect(provider.supportsModel('text-embedding-004')).toBe(true);
    });

    it('should report config.enabled as true', () => {
      expect(provider.config.enabled).toBe(true);
    });
  });
});
