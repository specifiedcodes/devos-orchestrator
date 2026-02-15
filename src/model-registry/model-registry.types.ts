/**
 * Model Registry Types
 *
 * Story 13-2: Model Registry
 *
 * TypeScript interfaces matching the devos-api model registry response format.
 */
import { TaskType } from '../providers/interfaces/provider.interfaces';

export { TaskType };

/**
 * Model definition as returned by the API
 */
export interface ModelDefinition {
  id: string;
  modelId: string;
  provider: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsEmbedding: boolean;
  inputPricePer1M: number;
  outputPricePer1M: number;
  cachedInputPricePer1M: number | null;
  avgLatencyMs: number;
  qualityTier: 'economy' | 'standard' | 'premium';
  suitableFor: TaskType[];
  available: boolean;
  deprecationDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Filter options for querying models
 */
export interface ModelRegistryFilters {
  provider?: string;
  qualityTier?: 'economy' | 'standard' | 'premium';
  taskType?: TaskType;
  available?: boolean;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsEmbedding?: boolean;
}

/**
 * Model pricing information compatible with provider.interfaces.ts ModelPricing
 */
export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
}
