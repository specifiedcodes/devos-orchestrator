/**
 * ModelRegistryClient Tests
 *
 * Story 13-2: Model Registry
 *
 * Unit tests for the HTTP client with caching and error handling.
 */
import { ModelRegistryClient } from '../model-registry.client';
import { ModelDefinition } from '../model-registry.types';

// Mock fetch globally
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('ModelRegistryClient', () => {
  let client: ModelRegistryClient;

  const mockModel: ModelDefinition = {
    id: 'uuid-1',
    modelId: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4',
    contextWindow: 200000,
    maxOutputTokens: 16000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsEmbedding: false,
    inputPricePer1M: 3.0,
    outputPricePer1M: 15.0,
    cachedInputPricePer1M: 0.3,
    avgLatencyMs: 0,
    qualityTier: 'standard',
    suitableFor: ['coding', 'planning', 'review', 'simple_chat'],
    available: true,
    deprecationDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const mockModel2: ModelDefinition = {
    id: 'uuid-2',
    modelId: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsEmbedding: false,
    inputPricePer1M: 2.5,
    outputPricePer1M: 10.0,
    cachedInputPricePer1M: 1.25,
    avgLatencyMs: 0,
    qualityTier: 'standard',
    suitableFor: ['coding', 'planning', 'review', 'simple_chat'],
    available: true,
    deprecationDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const createMockResponse = (data: any, ok = true, status = 200) => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Not Found',
    json: jest.fn().mockResolvedValue(data),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Short cache TTL for testing
    client = new ModelRegistryClient('http://localhost:3001', 100);
  });

  describe('getAll', () => {
    it('should fetch models from API and return parsed response', async () => {
      mockFetch.mockResolvedValue(createMockResponse([mockModel, mockModel2]));

      const result = await client.getAll();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/model-registry/models',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual([mockModel, mockModel2]);
    });

    it('should pass filter query params correctly', async () => {
      mockFetch.mockResolvedValue(createMockResponse([mockModel]));

      await client.getAll({
        provider: 'anthropic',
        qualityTier: 'standard',
        available: true,
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('provider=anthropic');
      expect(calledUrl).toContain('qualityTier=standard');
      expect(calledUrl).toContain('available=true');
    });

    it('should pass taskType filter', async () => {
      mockFetch.mockResolvedValue(createMockResponse([mockModel]));

      await client.getAll({ taskType: 'coding' });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('taskType=coding');
    });

    it('should not add query string when no filters provided', async () => {
      mockFetch.mockResolvedValue(createMockResponse([]));

      await client.getAll();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/model-registry/models',
        expect.any(Object),
      );
    });
  });

  describe('getByModelId', () => {
    it('should fetch single model from API', async () => {
      mockFetch.mockResolvedValue(createMockResponse(mockModel));

      const result = await client.getByModelId('claude-sonnet-4-20250514');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/model-registry/models/claude-sonnet-4-20250514',
        expect.any(Object),
      );
      expect(result).toEqual(mockModel);
    });

    it('should return null for 404 response', async () => {
      mockFetch.mockResolvedValue(createMockResponse(null, false, 404));

      const result = await client.getByModelId('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getByProvider', () => {
    it('should fetch models filtered by provider', async () => {
      mockFetch.mockResolvedValue(createMockResponse([mockModel]));

      const result = await client.getByProvider('anthropic');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/model-registry/models/provider/anthropic',
        expect.any(Object),
      );
      expect(result).toEqual([mockModel]);
    });
  });

  describe('getSuitableForTask', () => {
    it('should fetch models for task type', async () => {
      mockFetch.mockResolvedValue(createMockResponse([mockModel, mockModel2]));

      const result = await client.getSuitableForTask('coding');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/model-registry/models/task/coding',
        expect.any(Object),
      );
      expect(result).toEqual([mockModel, mockModel2]);
    });
  });

  describe('getModelPricing', () => {
    it('should return pricing in ModelPricing format', async () => {
      mockFetch.mockResolvedValue(createMockResponse(mockModel));

      const pricing = await client.getModelPricing('claude-sonnet-4-20250514');

      expect(pricing).toEqual({
        inputPer1M: 3.0,
        outputPer1M: 15.0,
        cachedInputPer1M: 0.3,
      });
    });

    it('should return pricing without cachedInputPer1M when null', async () => {
      const modelNoCachedPrice = { ...mockModel, cachedInputPricePer1M: null };
      mockFetch.mockResolvedValue(createMockResponse(modelNoCachedPrice));

      const pricing = await client.getModelPricing('claude-sonnet-4-20250514');

      expect(pricing).toEqual({
        inputPer1M: 3.0,
        outputPer1M: 15.0,
      });
      expect(pricing.cachedInputPer1M).toBeUndefined();
    });

    it('should throw for non-existent model', async () => {
      mockFetch.mockResolvedValue(createMockResponse(null, false, 404));

      await expect(client.getModelPricing('nonexistent')).rejects.toThrow(
        "Model 'nonexistent' not found in registry",
      );
    });
  });

  describe('caching', () => {
    it('should return cached response within TTL', async () => {
      mockFetch.mockResolvedValue(createMockResponse([mockModel]));

      // First call - hits API
      const result1 = await client.getAll();
      // Second call - should use cache
      const result2 = await client.getAll();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(result2);
    });

    it('should fetch fresh data after TTL expires', async () => {
      // Use a very short TTL
      const shortTtlClient = new ModelRegistryClient('http://localhost:3001', 10);
      mockFetch.mockResolvedValue(createMockResponse([mockModel]));

      await shortTtlClient.getAll();

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 20));

      mockFetch.mockResolvedValue(createMockResponse([mockModel, mockModel2]));
      const result = await shortTtlClient.getAll();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual([mockModel, mockModel2]);
    });

    it('should invalidate all cached entries on clearCache', async () => {
      mockFetch.mockResolvedValue(createMockResponse([mockModel]));

      await client.getAll();
      client.clearCache();

      mockFetch.mockResolvedValue(createMockResponse([mockModel, mockModel2]));
      const result = await client.getAll();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual([mockModel, mockModel2]);
    });
  });

  describe('error handling', () => {
    it('should wrap HTTP errors with descriptive messages', async () => {
      mockFetch.mockResolvedValue(createMockResponse(null, false, 500));

      await expect(client.getAll()).rejects.toThrow('Model Registry API error (500)');
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(client.getAll()).rejects.toThrow(
        'Model Registry API request failed: connect ECONNREFUSED',
      );
    });

    it('should handle fetch errors without message', async () => {
      mockFetch.mockRejectedValue({});

      await expect(client.getAll()).rejects.toThrow('Model Registry API request failed');
    });
  });

  describe('constructor', () => {
    it('should remove trailing slash from base URL', () => {
      const clientWithSlash = new ModelRegistryClient('http://localhost:3001/');
      mockFetch.mockResolvedValue(createMockResponse([]));

      clientWithSlash.getAll();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/model-registry/models',
        expect.any(Object),
      );
    });

    it('should use default base URL when not provided', () => {
      const defaultClient = new ModelRegistryClient();
      mockFetch.mockResolvedValue(createMockResponse([]));

      defaultClient.getAll();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/model-registry/models',
        expect.any(Object),
      );
    });
  });
});
