/**
 * Router Defaults
 *
 * Default routing rules mapping task types to preferred and fallback models.
 *
 * Story 13-3: Task-to-Model Router
 */

import { TaskType } from '../providers/interfaces/provider.interfaces';
import { RoutingRule } from './router.interfaces';

/**
 * Default estimated input tokens when not provided in the routing request.
 */
export const DEFAULT_ESTIMATED_INPUT_TOKENS = 1000;

/**
 * Default estimated output tokens when not provided in the routing request.
 */
export const DEFAULT_ESTIMATED_OUTPUT_TOKENS = 500;

/**
 * Default routing rules mapping task types to preferred and fallback models.
 *
 * Selection rationale:
 * - simple_chat/summarization: Use cheapest models (Gemini Flash, DeepSeek)
 * - coding/planning/review: Use mid-tier models (Claude Sonnet, GPT-4o)
 * - complex_reasoning: Use premium models (Claude Opus)
 * - embedding: Use dedicated embedding models (OpenAI, Google)
 */
export const DEFAULT_ROUTING_RULES: Record<TaskType, RoutingRule> = {
  simple_chat: {
    defaultModel: 'gemini-2.0-flash',
    fallbackModels: ['deepseek-chat', 'claude-haiku-3-5-20241022', 'gpt-4o-mini'],
    qualityTierPreference: 'economy',
  },
  summarization: {
    defaultModel: 'gemini-2.0-flash',
    fallbackModels: ['deepseek-chat', 'gpt-4o-mini', 'claude-haiku-3-5-20241022'],
    qualityTierPreference: 'economy',
  },
  coding: {
    defaultModel: 'claude-sonnet-4-20250514',
    fallbackModels: ['gpt-4o', 'deepseek-chat', 'gemini-2.0-pro'],
    qualityTierPreference: 'standard',
  },
  planning: {
    defaultModel: 'claude-sonnet-4-20250514',
    fallbackModels: ['gpt-4o', 'gemini-2.0-pro'],
    qualityTierPreference: 'standard',
  },
  review: {
    defaultModel: 'claude-sonnet-4-20250514',
    fallbackModels: ['gpt-4o', 'gemini-2.0-pro'],
    qualityTierPreference: 'standard',
  },
  complex_reasoning: {
    defaultModel: 'claude-opus-4-20250514',
    fallbackModels: ['claude-sonnet-4-20250514', 'gpt-4o', 'deepseek-reasoner'],
    qualityTierPreference: 'premium',
  },
  embedding: {
    defaultModel: 'text-embedding-3-small',
    fallbackModels: ['text-embedding-004', 'text-embedding-3-large'],
    qualityTierPreference: 'economy',
  },
};
