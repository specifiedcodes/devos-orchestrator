/**
 * ModelRegistryClient
 *
 * Story 13-2: Model Registry
 *
 * Plain TypeScript HTTP client that queries the devos-api model registry endpoints.
 * Includes in-memory cache with configurable TTL (default: 5 minutes).
 */
import { ModelDefinition, ModelRegistryFilters, ModelPricing, TaskType } from './model-registry.types';

/**
 * Cache entry with data and expiration
 */
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/**
 * Default cache TTL: 5 minutes
 */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Maximum number of cache entries to prevent unbounded memory growth.
 * When exceeded, the oldest entries are evicted.
 */
const DEFAULT_MAX_CACHE_SIZE = 100;

export class ModelRegistryClient {
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private readonly maxCacheSize: number;
  private readonly cache: Map<string, CacheEntry<any>> = new Map();
  private authToken: string | null = null;

  constructor(
    baseUrl: string = 'http://localhost:3001',
    cacheTtlMs: number = DEFAULT_CACHE_TTL_MS,
    maxCacheSize: number = DEFAULT_MAX_CACHE_SIZE,
  ) {
    // Remove trailing slash
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.cacheTtlMs = cacheTtlMs;
    this.maxCacheSize = maxCacheSize;
  }

  /**
   * Set the JWT authorization token for authenticated requests.
   * Required since the model registry API is protected by JwtAuthGuard.
   */
  setAuthToken(token: string): void {
    this.authToken = token;
  }

  /**
   * Get all models with optional filters
   */
  async getAll(filters?: ModelRegistryFilters): Promise<ModelDefinition[]> {
    const params = new URLSearchParams();
    if (filters) {
      if (filters.provider !== undefined) params.set('provider', filters.provider);
      if (filters.qualityTier !== undefined) params.set('qualityTier', filters.qualityTier);
      if (filters.taskType !== undefined) params.set('taskType', filters.taskType);
      if (filters.available !== undefined) params.set('available', String(filters.available));
      if (filters.supportsTools !== undefined) params.set('supportsTools', String(filters.supportsTools));
      if (filters.supportsVision !== undefined) params.set('supportsVision', String(filters.supportsVision));
      if (filters.supportsEmbedding !== undefined) params.set('supportsEmbedding', String(filters.supportsEmbedding));
    }

    const queryString = params.toString();
    const url = `${this.baseUrl}/api/model-registry/models${queryString ? `?${queryString}` : ''}`;
    return this.cachedFetch<ModelDefinition[]>(url);
  }

  /**
   * Get a single model by model ID
   */
  async getByModelId(modelId: string): Promise<ModelDefinition | null> {
    const url = `${this.baseUrl}/api/model-registry/models/${encodeURIComponent(modelId)}`;
    try {
      return await this.cachedFetch<ModelDefinition>(url);
    } catch (error: any) {
      if (error.message && error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get models by provider
   */
  async getByProvider(provider: string): Promise<ModelDefinition[]> {
    const url = `${this.baseUrl}/api/model-registry/models/provider/${encodeURIComponent(provider)}`;
    return this.cachedFetch<ModelDefinition[]>(url);
  }

  /**
   * Get models suitable for a task type
   */
  async getSuitableForTask(taskType: TaskType): Promise<ModelDefinition[]> {
    const url = `${this.baseUrl}/api/model-registry/models/task/${encodeURIComponent(taskType)}`;
    return this.cachedFetch<ModelDefinition[]>(url);
  }

  /**
   * Get model pricing in ModelPricing format
   */
  async getModelPricing(modelId: string): Promise<ModelPricing> {
    const model = await this.getByModelId(modelId);
    if (!model) {
      throw new Error(`Model '${modelId}' not found in registry`);
    }

    const pricing: ModelPricing = {
      inputPer1M: Number(model.inputPricePer1M),
      outputPer1M: Number(model.outputPricePer1M),
    };

    if (model.cachedInputPricePer1M !== null && model.cachedInputPricePer1M !== undefined) {
      pricing.cachedInputPer1M = Number(model.cachedInputPricePer1M);
    }

    return pricing;
  }

  /**
   * Clear all cached entries
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Fetch with caching. Enforces max cache size by evicting oldest entries.
   */
  private async cachedFetch<T>(url: string): Promise<T> {
    // Check cache
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as T;
    }

    // Fetch from API
    const data = await this.fetchFromApi<T>(url);

    // Evict expired entries first, then oldest if still over limit
    if (this.cache.size >= this.maxCacheSize) {
      const now = Date.now();
      for (const [key, entry] of this.cache) {
        if (entry.expiresAt <= now) {
          this.cache.delete(key);
        }
      }
      // If still over limit, evict oldest entries (Map iteration order is insertion order)
      while (this.cache.size >= this.maxCacheSize) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey !== undefined) {
          this.cache.delete(oldestKey);
        } else {
          break;
        }
      }
    }

    // Store in cache
    this.cache.set(url, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return data;
  }

  /**
   * Make HTTP request to the API
   */
  private async fetchFromApi<T>(url: string): Promise<T> {
    let response: Response;

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }
      response = await fetch(url, {
        method: 'GET',
        headers,
      });
    } catch (error: any) {
      throw new Error(`Model Registry API request failed: ${error.message || 'Network error'}`);
    }

    if (!response.ok) {
      const statusText = response.statusText || 'Unknown error';
      throw new Error(
        `Model Registry API error (${response.status}): ${statusText}`,
      );
    }

    try {
      return await response.json() as T;
    } catch (error: any) {
      throw new Error(`Model Registry API response parse error: ${error.message}`);
    }
  }
}
