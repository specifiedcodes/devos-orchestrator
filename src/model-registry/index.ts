/**
 * Model Registry - Barrel Export
 *
 * Story 13-2: Model Registry
 */
export { ModelRegistryClient } from './model-registry.client';
export {
  ModelDefinition,
  ModelRegistryFilters,
  ModelPricing,
  TaskType,
} from './model-registry.types';

/**
 * Factory function to create a configured ModelRegistryClient
 */
export function createModelRegistryClient(config?: {
  baseUrl?: string;
  cacheTtlMs?: number;
}): import('./model-registry.client').ModelRegistryClient {
  const { ModelRegistryClient } = require('./model-registry.client');
  const baseUrl = config?.baseUrl || process.env.MODEL_REGISTRY_API_URL || 'http://localhost:3001';
  const cacheTtlMs = config?.cacheTtlMs;
  return new ModelRegistryClient(baseUrl, cacheTtlMs);
}
