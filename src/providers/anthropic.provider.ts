/**
 * Anthropic Provider Implementation
 *
 * Uses @anthropic-ai/sdk for Claude model completions.
 *
 * Story 13-1: Provider Abstraction Layer
 */

import Anthropic from '@anthropic-ai/sdk';
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
 * Model pricing for Anthropic models (per 1M tokens)
 */
const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-20250514': { inputPer1M: 15.00, outputPer1M: 75.00, cachedInputPer1M: 1.50 },
  'claude-sonnet-4-20250514': { inputPer1M: 3.00, outputPer1M: 15.00, cachedInputPer1M: 0.30 },
  'claude-haiku-3-5-20241022': { inputPer1M: 0.80, outputPer1M: 4.00, cachedInputPer1M: 0.08 },
};

const SUPPORTED_MODELS = Object.keys(ANTHROPIC_PRICING);

/**
 * Anthropic Claude provider implementation
 */
export class AnthropicProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super(config);
  }

  /**
   * Create an Anthropic client with the given API key
   */
  private createClient(apiKey: string): Anthropic {
    return new Anthropic({
      apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
    });
  }

  /**
   * Execute a completion request using the Anthropic API
   */
  protected async executeComplete(
    request: CompletionRequest,
    apiKey: string,
  ): Promise<CompletionResponse> {
    const client = this.createClient(apiKey);

    // Extract system message from messages array
    const systemMessage = request.messages.find(m => m.role === 'system');
    const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

    // Map to Anthropic API format
    const params: Anthropic.MessageCreateParams = {
      model: request.model,
      max_tokens: request.maxTokens,
      messages: nonSystemMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      ...(systemMessage ? { system: systemMessage.content } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { top_p: request.topP } : {}),
      ...(request.stopSequences ? { stop_sequences: request.stopSequences } : {}),
      ...(request.tools ? {
        tools: request.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        })),
      } : {}),
    };

    try {
      const response = await client.messages.create(params);

      // Extract text content
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      const content = textBlock?.text ?? '';

      // Extract tool calls
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );
      const toolCalls = toolUseBlocks.length > 0
        ? toolUseBlocks.map(block => ({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          }))
        : undefined;

      // Map finish reason
      const finishReason = this.mapFinishReason(response.stop_reason);

      return {
        content,
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cachedInputTokens: (response.usage as unknown as Record<string, number>).cache_read_input_tokens,
        },
        cost: { amount: 0, currency: 'USD' }, // Calculated by BaseProvider
        latency: 0, // Measured by BaseProvider
        provider: this.id,
        finishReason,
        toolCalls,
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Execute a streaming request using the Anthropic API
   */
  protected async executeStream(
    request: CompletionRequest,
    apiKey: string,
  ): Promise<AsyncIterable<StreamChunk>> {
    const client = this.createClient(apiKey);

    const systemMessage = request.messages.find(m => m.role === 'system');
    const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

    const params: Anthropic.MessageCreateParams = {
      model: request.model,
      max_tokens: request.maxTokens,
      messages: nonSystemMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      ...(systemMessage ? { system: systemMessage.content } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { top_p: request.topP } : {}),
      ...(request.stopSequences ? { stop_sequences: request.stopSequences } : {}),
      ...(request.tools ? {
        tools: request.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        })),
      } : {}),
    };

    async function* generateStream(): AsyncIterable<StreamChunk> {
      try {
        const stream = client.messages.stream(params);

        yield { type: 'message_start' };

        for await (const event of stream) {
          if (event.type === 'content_block_delta') {
            const delta = event.delta as unknown as Record<string, unknown>;
            if (delta.type === 'text_delta') {
              yield {
                type: 'content_delta',
                content: delta.text as string,
              };
            } else if (delta.type === 'input_json_delta') {
              yield {
                type: 'tool_use_delta',
                content: delta.partial_json as string,
              };
            }
          }
        }

        // Get final message for usage
        const finalMessage = await stream.finalMessage();
        yield {
          type: 'message_end',
          usage: {
            inputTokens: finalMessage.usage.input_tokens,
            outputTokens: finalMessage.usage.output_tokens,
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
   * Anthropic does not support embeddings
   */
  protected async executeEmbed(
    _text: string,
    _model: string,
    _apiKey: string,
  ): Promise<number[]> {
    throw new ProviderError(
      'Anthropic does not support embeddings',
      'invalid_request_error',
      this.id,
    );
  }

  /**
   * Health check by sending a minimal request to verify API key validity
   */
  protected async executeHealthCheck(apiKey: string): Promise<ProviderHealthStatus> {
    const client = this.createClient(apiKey);
    const start = Date.now();

    try {
      // Use a minimal messages.create call to verify the API key
      await client.messages.create({
        model: 'claude-haiku-3-5-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return {
        providerId: this.id,
        healthy: true,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
      };
    } catch (error) {
      // Auth errors mean unhealthy, but overloaded/rate limit means the key is valid
      const apiError = error as { status?: number };
      if (apiError.status === 529 || apiError.status === 429) {
        return {
          providerId: this.id,
          healthy: true,
          latencyMs: Date.now() - start,
          lastChecked: new Date(),
        };
      }
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
   * Map Anthropic SDK errors to ProviderError
   */
  mapError(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }

    // Anthropic SDK errors have a status property
    const apiError = error as { status?: number; message?: string; error?: { type?: string } };
    const status = apiError.status;
    const message = apiError.message || 'Unknown Anthropic error';
    const errorType = apiError.error?.type;

    if (status === 401 || errorType === 'authentication_error') {
      return new ProviderError(message, 'authentication_error', this.id, status);
    }

    if (status === 429 || errorType === 'rate_limit_error') {
      return new ProviderError(message, 'rate_limit_error', this.id, status, true);
    }

    if (status === 400 || errorType === 'invalid_request_error') {
      return new ProviderError(message, 'invalid_request_error', this.id, status);
    }

    if (status === 404 || errorType === 'not_found_error') {
      return new ProviderError(message, 'model_not_found_error', this.id, status);
    }

    if (status === 529 || errorType === 'overloaded_error') {
      return new ProviderError(message, 'server_error', this.id, status, true);
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
   * Get model pricing for Anthropic models
   */
  getModelPricing(model: string): ModelPricing {
    const pricing = ANTHROPIC_PRICING[model];
    if (pricing) {
      return pricing;
    }

    // Try prefix match for versioned model names
    for (const [key, value] of Object.entries(ANTHROPIC_PRICING)) {
      if (model.startsWith(key.split('-').slice(0, -1).join('-'))) {
        return value;
      }
    }

    // Default to Sonnet pricing if model is unknown
    return ANTHROPIC_PRICING['claude-sonnet-4-20250514'];
  }

  /**
   * Check if a model ID is supported by Anthropic
   */
  supportsModel(modelId: string): boolean {
    return SUPPORTED_MODELS.includes(modelId);
  }

  /**
   * Map Anthropic stop reason to unified finish reason
   */
  private mapFinishReason(
    stopReason: string | null,
  ): CompletionResponse['finishReason'] {
    switch (stopReason) {
      case 'end_turn':
        return 'end_turn';
      case 'max_tokens':
        return 'max_tokens';
      case 'stop_sequence':
        return 'stop_sequence';
      case 'tool_use':
        return 'tool_use';
      default:
        return 'end_turn';
    }
  }
}
