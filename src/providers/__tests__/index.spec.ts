/**
 * Provider Module Factory Tests
 *
 * Tests for createProviderRegistry factory function.
 *
 * Story 13-1: Provider Abstraction Layer
 */

// Mock the SDK modules before importing the factory
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: jest.fn(), stream: jest.fn() },
  }));
});

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
    embeddings: { create: jest.fn() },
    models: { list: jest.fn() },
  }));
});

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn(),
      generateContentStream: jest.fn(),
      embedContent: jest.fn(),
    }),
  })),
  HarmCategory: {},
  HarmBlockThreshold: {},
  FunctionDeclarationSchemaType: {},
}));

import { createProviderRegistry } from '../index';

describe('createProviderRegistry', () => {
  it('should create registry with all four providers', () => {
    const registry = createProviderRegistry();
    const providers = registry.getAllProviders();

    expect(providers).toHaveLength(4);
    const ids = providers.map(p => p.id);
    expect(ids).toContain('anthropic');
    expect(ids).toContain('openai');
    expect(ids).toContain('google');
    expect(ids).toContain('deepseek');
  });

  it('should apply custom config overrides', () => {
    const registry = createProviderRegistry({
      anthropic: { maxRetries: 5, timeoutMs: 60000 },
      openai: { enabled: false },
    });

    const anthropic = registry.getProvider('anthropic');
    expect(anthropic?.config.maxRetries).toBe(5);
    expect(anthropic?.config.timeoutMs).toBe(60000);

    // OpenAI should be disabled
    expect(registry.isProviderEnabled('openai')).toBe(false);
  });

  it('should have all providers enabled by default', () => {
    const registry = createProviderRegistry();

    expect(registry.isProviderEnabled('anthropic')).toBe(true);
    expect(registry.isProviderEnabled('openai')).toBe(true);
    expect(registry.isProviderEnabled('google')).toBe(true);
    expect(registry.isProviderEnabled('deepseek')).toBe(true);
  });
});
