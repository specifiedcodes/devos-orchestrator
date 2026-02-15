/**
 * Router Module - Barrel Export
 *
 * Exports TaskModelRouter, interfaces, defaults, error, and factory function.
 *
 * Story 13-3: Task-to-Model Router
 */

// Interfaces and types
export {
  RoutingDecision,
  RoutingAlternative,
  TaskRoutingRequest,
  WorkspaceRoutingConfig,
  RoutingRule,
} from './router.interfaces';

// Error
export { RoutingError } from './routing-error';

// Defaults
export {
  DEFAULT_ROUTING_RULES,
  DEFAULT_ESTIMATED_INPUT_TOKENS,
  DEFAULT_ESTIMATED_OUTPUT_TOKENS,
} from './router.defaults';

// Router
export { TaskModelRouter } from './task-model-router';

// Dependencies
import { ProviderRegistry } from '../providers/provider.registry';
import { ModelRegistryClient } from '../model-registry/model-registry.client';
import { TaskModelRouter } from './task-model-router';
import { RoutingRule } from './router.interfaces';
import { TaskType } from '../providers/interfaces/provider.interfaces';
import { DEFAULT_ROUTING_RULES } from './router.defaults';

/**
 * Configuration for creating a TaskModelRouter
 */
export interface TaskModelRouterConfig {
  routingRules?: Record<TaskType, RoutingRule>;
}

/**
 * Factory function to create a configured TaskModelRouter.
 *
 * @param providerRegistry The provider registry for checking provider availability
 * @param modelRegistryClient The model registry client for model lookups
 * @param config Optional configuration including custom routing rules
 * @returns A configured TaskModelRouter
 */
export function createTaskModelRouter(
  providerRegistry: ProviderRegistry,
  modelRegistryClient: ModelRegistryClient,
  config?: TaskModelRouterConfig,
): TaskModelRouter {
  const routingRules = config?.routingRules || DEFAULT_ROUTING_RULES;
  return new TaskModelRouter(providerRegistry, modelRegistryClient, routingRules);
}
