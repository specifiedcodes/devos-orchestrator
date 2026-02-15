/**
 * Router Defaults Tests
 *
 * Story 13-3: Task-to-Model Router
 *
 * Tests for DEFAULT_ROUTING_RULES and default constants.
 */
import { VALID_TASK_TYPES, TaskType } from '../../providers/interfaces/provider.interfaces';
import {
  DEFAULT_ROUTING_RULES,
  DEFAULT_ESTIMATED_INPUT_TOKENS,
  DEFAULT_ESTIMATED_OUTPUT_TOKENS,
} from '../router.defaults';

describe('Router Defaults', () => {
  describe('DEFAULT_ROUTING_RULES', () => {
    it('should have entries for all TaskType values', () => {
      for (const taskType of VALID_TASK_TYPES) {
        expect(DEFAULT_ROUTING_RULES[taskType]).toBeDefined();
      }
    });

    it('should have the correct number of task type entries', () => {
      const ruleKeys = Object.keys(DEFAULT_ROUTING_RULES);
      expect(ruleKeys.length).toBe(VALID_TASK_TYPES.length);
    });

    it('should have valid structure for each routing rule', () => {
      for (const taskType of VALID_TASK_TYPES) {
        const rule = DEFAULT_ROUTING_RULES[taskType];
        expect(typeof rule.defaultModel).toBe('string');
        expect(rule.defaultModel.length).toBeGreaterThan(0);
        expect(Array.isArray(rule.fallbackModels)).toBe(true);
        expect(rule.fallbackModels.length).toBeGreaterThan(0);
        expect(['economy', 'standard', 'premium']).toContain(rule.qualityTierPreference);
      }
    });

    it('should have no duplicate models in fallback lists', () => {
      for (const taskType of VALID_TASK_TYPES) {
        const rule = DEFAULT_ROUTING_RULES[taskType];
        const uniqueModels = new Set(rule.fallbackModels);
        expect(uniqueModels.size).toBe(rule.fallbackModels.length);
      }
    });

    it('should not include the default model in fallback lists', () => {
      for (const taskType of VALID_TASK_TYPES) {
        const rule = DEFAULT_ROUTING_RULES[taskType];
        expect(rule.fallbackModels).not.toContain(rule.defaultModel);
      }
    });

    it('should map simple_chat to economy tier with gemini-2.0-flash', () => {
      const rule = DEFAULT_ROUTING_RULES['simple_chat'];
      expect(rule.defaultModel).toBe('gemini-2.0-flash');
      expect(rule.qualityTierPreference).toBe('economy');
    });

    it('should map summarization to economy tier with gemini-2.0-flash', () => {
      const rule = DEFAULT_ROUTING_RULES['summarization'];
      expect(rule.defaultModel).toBe('gemini-2.0-flash');
      expect(rule.qualityTierPreference).toBe('economy');
    });

    it('should map coding to standard tier with claude-sonnet-4-20250514', () => {
      const rule = DEFAULT_ROUTING_RULES['coding'];
      expect(rule.defaultModel).toBe('claude-sonnet-4-20250514');
      expect(rule.qualityTierPreference).toBe('standard');
    });

    it('should map planning to standard tier with claude-sonnet-4-20250514', () => {
      const rule = DEFAULT_ROUTING_RULES['planning'];
      expect(rule.defaultModel).toBe('claude-sonnet-4-20250514');
      expect(rule.qualityTierPreference).toBe('standard');
    });

    it('should map review to standard tier with claude-sonnet-4-20250514', () => {
      const rule = DEFAULT_ROUTING_RULES['review'];
      expect(rule.defaultModel).toBe('claude-sonnet-4-20250514');
      expect(rule.qualityTierPreference).toBe('standard');
    });

    it('should map complex_reasoning to premium tier with claude-opus-4-20250514', () => {
      const rule = DEFAULT_ROUTING_RULES['complex_reasoning'];
      expect(rule.defaultModel).toBe('claude-opus-4-20250514');
      expect(rule.qualityTierPreference).toBe('premium');
    });

    it('should map embedding to economy tier with text-embedding-3-small', () => {
      const rule = DEFAULT_ROUTING_RULES['embedding'];
      expect(rule.defaultModel).toBe('text-embedding-3-small');
      expect(rule.qualityTierPreference).toBe('economy');
    });
  });

  describe('Default token estimates', () => {
    it('should define DEFAULT_ESTIMATED_INPUT_TOKENS as 1000', () => {
      expect(DEFAULT_ESTIMATED_INPUT_TOKENS).toBe(1000);
    });

    it('should define DEFAULT_ESTIMATED_OUTPUT_TOKENS as 500', () => {
      expect(DEFAULT_ESTIMATED_OUTPUT_TOKENS).toBe(500);
    });
  });
});
