/**
 * OpenAI Provider Implementation
 *
 * Uses the openai npm package for GPT model completions and embeddings.
 *
 * Story 13-1: Provider Abstraction Layer
 */

import OpenAI from 'openai';
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
 * Model pricing for OpenAI models (per 1M tokens)
 */
const OPENAI_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00, cachedInputPer1M: 1.25 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60, cachedInputPer1M: 0.075 },
  'gpt-4-turbo': { inputPer1M: 10.00, outputPer1M: 30.00 },
  'text-embedding-3-small': { inputPer1M: 0.02, outputPer1M: 0 },
  'text-embedding-3-large': { inputPer1M: 0.13, outputPer1M: 0 },
};

const SUPPORTED_MODELS = Object.keys(OPENAI_PRICING);

/**
 * OpenAI GPT provider implementation
 */
export class OpenAIProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super(config);
  }

  /**
   * Create an OpenAI client with the given API key
   */
  protected createClient(apiKey: string): OpenAI {
    return new OpenAI({
      apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
    });
  }

  /**
   * Execute a completion request using the OpenAI Chat API
   */
  protected async executeComplete(
    request: CompletionRequest,
    apiKey: string,
  ): Promise<CompletionResponse> {
    const client = this.createClient(apiKey);

    // Map messages to OpenAI format (system/user/assistant roles are compatible)
    const messages: OpenAI.ChatCompletionMessageParam[] = request.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    // Build tool definitions for OpenAI
    const tools = request.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    try {
      const response = await client.chat.completions.create({
        model: request.model,
        messages,
        max_tokens: request.maxTokens,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.topP !== undefined ? { top_p: request.topP } : {}),
        ...(request.stopSequences ? { stop: request.stopSequences } : {}),
        ...(tools && tools.length > 0 ? { tools } : {}),
      });

      const choice = response.choices[0];
      const content = choice?.message?.content ?? '';

      // Extract tool calls
      const toolCalls = choice?.message?.tool_calls
        ?.filter((tc): tc is typeof tc & { type: 'function'; function: { name: string; arguments: string } } =>
          tc.type === 'function')
        .map(tc => ({
          id: tc.id,
          name: (tc as unknown as { function: { name: string; arguments: string } }).function.name,
          input: JSON.parse((tc as unknown as { function: { name: string; arguments: string } }).function.arguments || '{}') as Record<string, unknown>,
        }));

      // Map finish reason
      const finishReason = this.mapFinishReason(choice?.finish_reason);

      return {
        content,
        model: response.model,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
        cost: { amount: 0, currency: 'USD' }, // Calculated by BaseProvider
        latency: 0, // Measured by BaseProvider
        provider: this.id,
        finishReason,
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Execute a streaming request using the OpenAI Chat API
   */
  protected async executeStream(
    request: CompletionRequest,
    apiKey: string,
  ): Promise<AsyncIterable<StreamChunk>> {
    const client = this.createClient(apiKey);

    const messages: OpenAI.ChatCompletionMessageParam[] = request.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const tools = request.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    async function* generateStream(): AsyncIterable<StreamChunk> {
      try {
        const stream = await client.chat.completions.create({
          model: request.model,
          messages,
          max_tokens: request.maxTokens,
          stream: true,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.topP !== undefined ? { top_p: request.topP } : {}),
          ...(request.stopSequences ? { stop: request.stopSequences } : {}),
          ...(tools && tools.length > 0 ? { tools } : {}),
        });

        yield { type: 'message_start' };

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            yield {
              type: 'content_delta',
              content: delta.content,
            };
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              yield {
                type: 'tool_use_delta',
                toolCall: {
                  id: tc.id,
                  name: tc.function?.name,
                },
                // Stream partial arguments as raw content; callers accumulate and parse when complete
                content: tc.function?.arguments,
              };
            }
          }
        }

        yield { type: 'message_end' };
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
   * Generate embeddings using the OpenAI Embeddings API
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

    try {
      const response = await client.embeddings.create({
        model,
        input: text,
      });

      return response.data[0].embedding;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Health check using models.list
   */
  protected async executeHealthCheck(apiKey: string): Promise<ProviderHealthStatus> {
    const client = this.createClient(apiKey);
    const start = Date.now();

    try {
      await client.models.list();
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
   * Map OpenAI SDK errors to ProviderError
   */
  mapError(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }

    const apiError = error as { status?: number; message?: string; code?: string };
    const status = apiError.status;
    const message = apiError.message || 'Unknown OpenAI error';

    if (status === 401) {
      return new ProviderError(message, 'authentication_error', this.id, status);
    }

    if (status === 429) {
      return new ProviderError(message, 'rate_limit_error', this.id, status, true);
    }

    if (status === 400) {
      if (message.toLowerCase().includes('context length') || message.toLowerCase().includes('maximum context')) {
        return new ProviderError(message, 'context_length_error', this.id, status);
      }
      return new ProviderError(message, 'invalid_request_error', this.id, status);
    }

    if (status === 404) {
      return new ProviderError(message, 'model_not_found_error', this.id, status);
    }

    if (status && (status === 500 || status === 503)) {
      return new ProviderError(message, 'server_error', this.id, status, true);
    }

    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      return new ProviderError(message, 'network_error', this.id, undefined, true);
    }

    return new ProviderError(message, 'unknown_error', this.id, status);
  }

  /**
   * Get model pricing for OpenAI models
   */
  getModelPricing(model: string): ModelPricing {
    const pricing = OPENAI_PRICING[model];
    if (pricing) {
      return pricing;
    }
    // Default to GPT-4o pricing
    return OPENAI_PRICING['gpt-4o'];
  }

  /**
   * Check if a model ID is supported by OpenAI
   */
  supportsModel(modelId: string): boolean {
    return SUPPORTED_MODELS.includes(modelId);
  }

  /**
   * Map OpenAI finish reason to unified finish reason
   */
  protected mapFinishReason(
    finishReason: string | null | undefined,
  ): CompletionResponse['finishReason'] {
    switch (finishReason) {
      case 'stop':
        return 'end_turn';
      case 'length':
        return 'max_tokens';
      case 'tool_calls':
        return 'tool_use';
      case 'content_filter':
        return 'error';
      default:
        return 'end_turn';
    }
  }
}
