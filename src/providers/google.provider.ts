/**
 * Google AI Provider Implementation
 *
 * Uses @google/generative-ai for Gemini model completions and embeddings.
 *
 * Story 13-1: Provider Abstraction Layer
 */

import {
  GoogleGenerativeAI,
  GenerativeModel,
  Content,
  Part,
} from '@google/generative-ai';
import { BaseProvider } from './base.provider';
import {
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ProviderHealthStatus,
  ProviderConfig,
  ModelPricing,
  ProviderError,
} from './interfaces';

/**
 * Model pricing for Google AI models (per 1M tokens)
 */
const GOOGLE_PRICING: Record<string, ModelPricing> = {
  'gemini-2.0-flash': { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gemini-2.0-pro': { inputPer1M: 1.25, outputPer1M: 5.00 },
  'text-embedding-004': { inputPer1M: 0.006, outputPer1M: 0 },
};

const SUPPORTED_MODELS = Object.keys(GOOGLE_PRICING);

/**
 * Google Gemini provider implementation
 */
export class GoogleAIProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super(config);
  }

  /**
   * Create a Google Generative AI client
   */
  private createClient(apiKey: string): GoogleGenerativeAI {
    return new GoogleGenerativeAI(apiKey);
  }

  /**
   * Get a generative model from the client
   */
  private getModel(client: GoogleGenerativeAI, request: CompletionRequest): GenerativeModel {
    const systemMessage = request.messages.find(m => m.role === 'system');

    const modelConfig: Record<string, unknown> = {
      model: request.model,
      ...(systemMessage ? { systemInstruction: systemMessage.content } : {}),
    };

    // Map tools to Google format
    if (request.tools && request.tools.length > 0) {
      modelConfig.tools = [{
        functionDeclarations: request.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        })),
      }];
    }

    return client.getGenerativeModel(modelConfig as { model: string });
  }

  /**
   * Convert messages to Google Content format
   */
  private mapMessages(request: CompletionRequest): Content[] {
    return request.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }] as Part[],
      }));
  }

  /**
   * Execute a completion request using the Google Generative AI API
   */
  protected async executeComplete(
    request: CompletionRequest,
    apiKey: string,
  ): Promise<CompletionResponse> {
    const client = this.createClient(apiKey);
    const model = this.getModel(client, request);
    const contents = this.mapMessages(request);

    try {
      const result = await model.generateContent({
        contents,
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.topP !== undefined ? { topP: request.topP } : {}),
          ...(request.stopSequences ? { stopSequences: request.stopSequences } : {}),
        },
      });

      const response = result.response;
      const candidate = response.candidates?.[0];
      // response.text() throws if no text parts exist, so wrap in try/catch
      let content = '';
      try {
        content = response.text?.() ?? '';
      } catch {
        content = candidate?.content?.parts?.[0]?.text ?? '';
      }

      // Check for safety blocks
      if (candidate?.finishReason === 'SAFETY') {
        throw new ProviderError(
          'Content blocked by safety filter',
          'content_filter_error',
          this.id,
        );
      }

      // Extract tool calls
      const functionCalls = candidate?.content?.parts?.filter(
        (p: Part) => 'functionCall' in p
      );
      const toolCalls = functionCalls && functionCalls.length > 0
        ? functionCalls.map((p: Part, i: number) => {
            const fc = (p as unknown as Record<string, Record<string, unknown>>).functionCall;
            return {
              id: `call_${i}`,
              name: fc.name as string,
              input: (fc.args ?? {}) as Record<string, unknown>,
            };
          })
        : undefined;

      // Map finish reason
      const finishReason = this.mapFinishReason(candidate?.finishReason);

      // Extract usage
      const usageMetadata = response.usageMetadata;

      return {
        content,
        model: request.model,
        usage: {
          inputTokens: usageMetadata?.promptTokenCount ?? 0,
          outputTokens: usageMetadata?.candidatesTokenCount ?? 0,
        },
        cost: { amount: 0, currency: 'USD' }, // Calculated by BaseProvider
        latency: 0, // Measured by BaseProvider
        provider: this.id,
        finishReason,
        toolCalls,
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      throw this.mapError(error);
    }
  }

  /**
   * Execute a streaming request using Google Generative AI
   */
  protected async executeStream(
    request: CompletionRequest,
    apiKey: string,
  ): Promise<AsyncIterable<StreamChunk>> {
    const client = this.createClient(apiKey);
    const model = this.getModel(client, request);
    const contents = this.mapMessages(request);

    async function* generateStream(): AsyncIterable<StreamChunk> {
      try {
        const result = await model.generateContentStream({
          contents,
          generationConfig: {
            maxOutputTokens: request.maxTokens,
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.topP !== undefined ? { topP: request.topP } : {}),
            ...(request.stopSequences ? { stopSequences: request.stopSequences } : {}),
          },
        });

        yield { type: 'message_start' };

        for await (const chunk of result.stream) {
          const text = chunk.text?.();
          if (text) {
            yield {
              type: 'content_delta',
              content: text,
            };
          }
        }

        // Get final response for usage
        const finalResponse = await result.response;
        const usageMetadata = finalResponse.usageMetadata;

        yield {
          type: 'message_end',
          usage: {
            inputTokens: usageMetadata?.promptTokenCount ?? 0,
            outputTokens: usageMetadata?.candidatesTokenCount ?? 0,
          },
        };
      } catch (error) {
        yield {
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown streaming error',
        };
      }
    }

    return generateStream();
  }

  /**
   * Generate embeddings using Google AI
   */
  protected async executeEmbed(
    text: string,
    model: string,
    apiKey: string,
  ): Promise<number[]> {
    if (!model.includes('embedding')) {
      throw new ProviderError(
        `Model ${model} does not support embeddings`,
        'invalid_request_error',
        this.id,
      );
    }

    const client = this.createClient(apiKey);
    const embeddingModel = client.getGenerativeModel({ model });

    try {
      const result = await embeddingModel.embedContent(text);
      return result.embedding.values;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Health check by listing models
   */
  protected async executeHealthCheck(apiKey: string): Promise<ProviderHealthStatus> {
    const client = this.createClient(apiKey);
    const start = Date.now();

    try {
      // Use a simple model call to verify key validity
      const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });
      await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        generationConfig: { maxOutputTokens: 1 },
      });
      return {
        providerId: this.id,
        healthy: true,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        providerId: this.id,
        healthy: false,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        errorMessage: error instanceof Error ? error.message : 'Health check failed',
      };
    }
  }

  /**
   * Map Google AI errors to ProviderError
   */
  mapError(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }

    const apiError = error as { status?: number; message?: string; statusText?: string };
    const status = apiError.status;
    const message = apiError.message || 'Unknown Google AI error';

    if (status === 403 || message.includes('API key')) {
      return new ProviderError(message, 'authentication_error', this.id, status);
    }

    if (status === 429) {
      return new ProviderError(message, 'rate_limit_error', this.id, status, true);
    }

    if (status === 400) {
      return new ProviderError(message, 'invalid_request_error', this.id, status);
    }

    if (message.includes('SAFETY') || message.includes('safety')) {
      return new ProviderError(message, 'content_filter_error', this.id, status);
    }

    if (status === 404) {
      return new ProviderError(message, 'model_not_found_error', this.id, status);
    }

    if (status && status >= 500) {
      return new ProviderError(message, 'server_error', this.id, status, true);
    }

    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      return new ProviderError(message, 'network_error', this.id, undefined, true);
    }

    return new ProviderError(message, 'unknown_error', this.id, status);
  }

  /**
   * Get model pricing for Google AI models
   */
  getModelPricing(model: string): ModelPricing {
    const pricing = GOOGLE_PRICING[model];
    if (pricing) {
      return pricing;
    }
    // Default to Gemini Flash pricing
    return GOOGLE_PRICING['gemini-2.0-flash'];
  }

  /**
   * Check if a model ID is supported by Google AI
   */
  supportsModel(modelId: string): boolean {
    return SUPPORTED_MODELS.includes(modelId);
  }

  /**
   * Map Google finish reason to unified finish reason
   */
  private mapFinishReason(
    finishReason: string | undefined,
  ): CompletionResponse['finishReason'] {
    switch (finishReason) {
      case 'STOP':
        return 'end_turn';
      case 'MAX_TOKENS':
        return 'max_tokens';
      case 'SAFETY':
        return 'error';
      case 'FUNCTION_CALL':
        return 'tool_use';
      default:
        return 'end_turn';
    }
  }
}
