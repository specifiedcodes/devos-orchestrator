/**
 * Router Interfaces and Types
 *
 * Type definitions for the Task-to-Model routing system.
 *
 * Story 13-3: Task-to-Model Router
 */

import { ProviderID, TaskType } from '../providers/interfaces/provider.interfaces';

/**
 * The result of a routing decision, including selected model,
 * reasoning, estimated cost, and alternatives considered.
 */
export interface RoutingDecision {
  selectedModel: string;         // e.g. 'claude-sonnet-4-20250514'
  provider: ProviderID;          // e.g. 'anthropic'
  reason: string;                // Why this model was chosen
  estimatedCost: number;         // Estimated cost in USD for this task
  alternatives: RoutingAlternative[];
}

/**
 * An alternative model that was considered but not selected.
 */
export interface RoutingAlternative {
  model: string;
  provider: ProviderID | 'unknown';
  estimatedCost: number;
  reason: string;                // Why not selected (e.g. 'no API key', 'insufficient context window')
}

/**
 * Input request for routing a task to a model.
 */
export interface TaskRoutingRequest {
  taskType: TaskType;
  estimatedInputTokens?: number;     // Estimated input size
  estimatedOutputTokens?: number;    // Estimated output size
  requiresTools?: boolean;           // Does the task need tool/function calling?
  requiresVision?: boolean;          // Does the task need vision capabilities?
  requiresStreaming?: boolean;       // Does the task need streaming?
  contextSizeTokens?: number;        // Size of context to be sent (for context window check)
  workspaceId: string;               // For workspace-level config and key availability
  projectId?: string;                // Optional project-level override (future)
  forceModel?: string;               // Force a specific model (debugging)
  forceProvider?: ProviderID;        // Force a specific provider (debugging)
}

/**
 * Workspace-level routing configuration.
 * In this story, a simple in-memory/default structure is used.
 * Story 13.9 (User Model Preferences) will add database-backed workspace preferences.
 */
export interface WorkspaceRoutingConfig {
  workspaceId: string;
  enabledProviders: ProviderID[];    // Which providers have valid BYOK keys
  preset: 'auto' | 'economy' | 'quality' | 'balanced';
  taskOverrides?: Partial<Record<TaskType, {
    preferredModel?: string;
    fallbackModel?: string;
  }>>;
  monthlyBudgetUsd?: number;         // From Story 13.7 (future)
  currentSpendUsd?: number;          // From Story 13.7 (future)
}

/**
 * A routing rule defining default and fallback models for a task type.
 */
export interface RoutingRule {
  defaultModel: string;
  fallbackModels: string[];
  qualityTierPreference: 'economy' | 'standard' | 'premium';
}
