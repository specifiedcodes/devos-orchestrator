/**
 * Provider Interfaces and Types
 *
 * Unified type definitions for cross-provider AI abstraction.
 *
 * Story 13-1: Provider Abstraction Layer
 */

/**
 * Supported AI provider identifiers
 */
export type ProviderID = 'anthropic' | 'google' | 'deepseek' | 'openai';

/**
 * Unified message format across all providers
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Tool definition for function calling
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Unified completion request
 */
export interface CompletionRequest {
  model: string;
  messages: Message[];
  maxTokens: number;
  temperature?: number;        // Default: 0.7
  tools?: ToolDefinition[];
  stream?: boolean;            // Default: false
  stopSequences?: string[];
  topP?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Token usage information
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/**
 * Cost information
 */
export interface CostInfo {
  amount: number;
  currency: 'USD';
}

/**
 * Tool call from a completion response
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Unified completion response
 */
export interface CompletionResponse {
  content: string;
  model: string;
  usage: TokenUsage;
  cost: CostInfo;
  latency: number;             // ms
  provider: ProviderID;
  finishReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'error';
  toolCalls?: ToolCall[];
}

/**
 * Stream chunk for streaming responses
 */
export interface StreamChunk {
  type: 'content_delta' | 'tool_use_delta' | 'message_start' | 'message_end' | 'error';
  content?: string;
  toolCall?: Partial<ToolCall>;
  usage?: Partial<TokenUsage>;
  error?: string;
}

/**
 * Rate limit information
 */
export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: Date;
  retryAfter?: number;         // seconds
}

/**
 * Provider health status
 */
export interface ProviderHealthStatus {
  providerId: ProviderID;
  healthy: boolean;
  latencyMs: number | null;
  lastChecked: Date;
  errorMessage?: string;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: ProviderID;
  name: string;
  enabled: boolean;
  baseUrl?: string;            // Override for custom endpoints
  maxRetries: number;          // Default: 3
  retryDelayMs: number;        // Default: 1000
  timeoutMs: number;           // Default: 120000 (2 minutes)
  rateLimitRpm?: number;       // Requests per minute limit
}

/**
 * Model pricing information (per 1M tokens)
 */
export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
}

/**
 * Unified error types across providers
 */
export type ProviderErrorType =
  | 'authentication_error'     // Invalid API key
  | 'rate_limit_error'         // Rate limited
  | 'invalid_request_error'    // Bad request
  | 'model_not_found_error'    // Model doesn't exist
  | 'context_length_error'     // Input too long
  | 'content_filter_error'     // Safety/content filter triggered
  | 'server_error'             // Provider server error
  | 'timeout_error'            // Request timed out
  | 'network_error'            // Network connectivity issue
  | 'unknown_error';           // Unclassified error

/**
 * Normalized provider error
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly type: ProviderErrorType,
    public readonly provider: ProviderID,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
    // Restore prototype chain for instanceof checks when targeting ES5
    Object.setPrototypeOf(this, ProviderError.prototype);
  }
}
