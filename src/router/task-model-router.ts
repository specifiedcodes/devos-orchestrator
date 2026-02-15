/**
 * TaskModelRouter
 *
 * Routes AI tasks to the most appropriate and cost-effective model.
 *
 * Selection algorithm (in order):
 * 1. If forceModel is set, use that model (debugging)
 * 2. Check workspace task overrides (user preferences from Story 13.9)
 * 3. Apply routing preset (economy/quality/balanced/auto)
 * 4. Get default model for task type from routing rules
 * 5. Verify model availability:
 *    a. Model exists in Model Registry and is available
 *    b. Model's provider has a BYOK key in the workspace (enabledProviders)
 *    c. Model's provider is enabled in ProviderRegistry
 *    d. Model meets capability requirements (tools, vision, streaming, context window)
 * 6. If default model fails checks, iterate fallback models in order
 * 7. If all fallbacks fail, try any model suitable for the task type from registry
 * 8. If no suitable model found, throw RoutingError
 *
 * Story 13-3: Task-to-Model Router
 */

import { ProviderID, TaskType } from '../providers/interfaces/provider.interfaces';
import { ProviderRegistry } from '../providers/provider.registry';
import { ModelRegistryClient } from '../model-registry/model-registry.client';
import { ModelDefinition } from '../model-registry/model-registry.types';
import {
  RoutingDecision,
  RoutingAlternative,
  TaskRoutingRequest,
  WorkspaceRoutingConfig,
  RoutingRule,
} from './router.interfaces';
import { RoutingError } from './routing-error';
import {
  DEFAULT_ROUTING_RULES,
  DEFAULT_ESTIMATED_INPUT_TOKENS,
  DEFAULT_ESTIMATED_OUTPUT_TOKENS,
} from './router.defaults';

/**
 * Result of validating whether a model can handle a specific request.
 */
interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export class TaskModelRouter {
  private routingRules: Record<TaskType, RoutingRule>;

  constructor(
    private readonly providerRegistry: ProviderRegistry,
    private readonly modelRegistryClient: ModelRegistryClient,
    routingRules: Record<TaskType, RoutingRule> = DEFAULT_ROUTING_RULES,
  ) {
    this.routingRules = { ...routingRules };
  }

  /**
   * Route a task to the best available model.
   */
  async routeTask(
    request: TaskRoutingRequest,
    workspaceConfig: WorkspaceRoutingConfig,
  ): Promise<RoutingDecision> {
    const alternatives: RoutingAlternative[] = [];
    const attemptedModels: string[] = [];

    // Validate enabledProviders is not empty
    if (workspaceConfig.enabledProviders.length === 0) {
      throw new RoutingError(
        `No enabled providers in workspace '${workspaceConfig.workspaceId}'. At least one provider must have a valid BYOK key.`,
        request.taskType,
        request,
        [],
      );
    }

    // 1. Force model path
    if (request.forceModel) {
      return this.handleForceModel(request, workspaceConfig, alternatives, attemptedModels);
    }

    // 2. Force provider path
    if (request.forceProvider) {
      return this.handleForceProvider(request, workspaceConfig, alternatives, attemptedModels);
    }

    // 3. Workspace task overrides
    const overrideResult = await this.tryWorkspaceOverrides(
      request, workspaceConfig, alternatives, attemptedModels,
    );
    if (overrideResult) return overrideResult;

    // 4. Preset-based routing (economy/quality override default behavior)
    if (workspaceConfig.preset === 'economy' || workspaceConfig.preset === 'quality') {
      const presetResult = await this.handlePresetRouting(
        request, workspaceConfig, alternatives, attemptedModels,
      );
      if (presetResult) return presetResult;
    }

    // 5. Default routing rules with fallback chain
    const defaultResult = await this.tryDefaultRouting(
      request, workspaceConfig, alternatives, attemptedModels,
    );
    if (defaultResult) return defaultResult;

    // 6. Registry fallback - try any suitable model
    const registryResult = await this.tryRegistryFallback(
      request, workspaceConfig, alternatives, attemptedModels,
    );
    if (registryResult) return registryResult;

    // 7. No suitable model found
    throw new RoutingError(
      `No suitable model found for task type '${request.taskType}' in workspace '${workspaceConfig.workspaceId}'. Attempted ${attemptedModels.length} models.`,
      request.taskType,
      request,
      attemptedModels,
    );
  }

  /**
   * Estimate cost for a given model and token counts.
   * Returns -1 if pricing data is unavailable (distinguishes from actual zero cost).
   */
  async estimateCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<number> {
    try {
      const pricing = await this.modelRegistryClient.getModelPricing(modelId);
      return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
    } catch {
      return -1;
    }
  }

  /**
   * Check if a specific model is available for use in a workspace.
   * Validates: model exists, available, provider enabled, BYOK key present.
   */
  async isModelAvailable(
    modelId: string,
    workspaceConfig: WorkspaceRoutingConfig,
  ): Promise<boolean> {
    try {
      const model = await this.modelRegistryClient.getByModelId(modelId);
      if (!model) return false;
      if (!model.available) return false;

      const provider = model.provider as ProviderID;
      if (!workspaceConfig.enabledProviders.includes(provider)) return false;
      if (!this.providerRegistry.isProviderEnabled(provider)) return false;

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all available models for a workspace, grouped by task type.
   */
  async getAvailableModels(
    workspaceConfig: WorkspaceRoutingConfig,
  ): Promise<Record<TaskType, ModelDefinition[]>> {
    const result: Record<TaskType, ModelDefinition[]> = {
      coding: [],
      planning: [],
      review: [],
      summarization: [],
      embedding: [],
      simple_chat: [],
      complex_reasoning: [],
    };

    try {
      const allModels = await this.modelRegistryClient.getAll({ available: true });

      for (const model of allModels) {
        const provider = model.provider as ProviderID;
        if (!workspaceConfig.enabledProviders.includes(provider)) continue;
        if (!this.providerRegistry.isProviderEnabled(provider)) continue;

        for (const taskType of model.suitableFor) {
          if (result[taskType]) {
            result[taskType].push(model);
          }
        }
      }
    } catch {
      // Return empty groups on error
    }

    return result;
  }

  /**
   * Override default routing rules at runtime (for A/B testing or dynamic config).
   */
  setRoutingRules(rules: Record<TaskType, RoutingRule>): void {
    this.routingRules = { ...rules };
  }

  /**
   * Get current routing rules.
   */
  getRoutingRules(): Record<TaskType, RoutingRule> {
    return { ...this.routingRules };
  }

  // ===== Private methods =====

  /**
   * Handle forceModel request - validate and return forced model.
   */
  private async handleForceModel(
    request: TaskRoutingRequest,
    workspaceConfig: WorkspaceRoutingConfig,
    alternatives: RoutingAlternative[],
    attemptedModels: string[],
  ): Promise<RoutingDecision> {
    const modelId = request.forceModel!;
    attemptedModels.push(modelId);

    const model = await this.modelRegistryClient.getByModelId(modelId);
    if (!model) {
      throw new RoutingError(
        `Forced model '${modelId}' not found in model registry.`,
        request.taskType,
        request,
        attemptedModels,
      );
    }

    const provider = model.provider as ProviderID;
    if (!workspaceConfig.enabledProviders.includes(provider)) {
      throw new RoutingError(
        `Forced model '${modelId}' provider '${provider}' is not in workspace enabled providers.`,
        request.taskType,
        request,
        attemptedModels,
      );
    }

    // Validate capabilities and warn if forced model does not meet requirements
    const capabilityCheck = this.validateCapabilities(model, request);
    const cost = await this.calculateCostForRequest(modelId, request);
    const reason = capabilityCheck.valid
      ? `Forced model selection: '${modelId}'`
      : `Forced model selection: '${modelId}' (WARNING: ${capabilityCheck.reason})`;

    return {
      selectedModel: modelId,
      provider,
      reason,
      estimatedCost: cost,
      alternatives,
    };
  }

  /**
   * Handle forceProvider request - find best model from that provider.
   */
  private async handleForceProvider(
    request: TaskRoutingRequest,
    workspaceConfig: WorkspaceRoutingConfig,
    alternatives: RoutingAlternative[],
    attemptedModels: string[],
  ): Promise<RoutingDecision> {
    const providerId = request.forceProvider!;

    // Verify forced provider is in workspace enabled providers (has BYOK key)
    if (!workspaceConfig.enabledProviders.includes(providerId)) {
      throw new RoutingError(
        `Forced provider '${providerId}' is not in workspace enabled providers (no BYOK key).`,
        request.taskType,
        request,
        attemptedModels,
      );
    }

    // Get models suitable for the task type
    let models: ModelDefinition[];
    try {
      models = await this.modelRegistryClient.getSuitableForTask(request.taskType);
    } catch {
      models = [];
    }

    // Filter to models from the forced provider that are available
    const providerModels = models
      .filter(m => m.provider === providerId && m.available)
      .sort((a, b) => a.inputPricePer1M - b.inputPricePer1M);

    for (const model of providerModels) {
      attemptedModels.push(model.modelId);
      const validation = this.validateCapabilities(model, request);
      if (validation.valid) {
        const cost = await this.calculateCostForRequest(model.modelId, request);

        // Record remaining models as alternatives
        for (const alt of providerModels.filter(m => m.modelId !== model.modelId)) {
          const altCost = await this.calculateCostForRequest(alt.modelId, request);
          alternatives.push({
            model: alt.modelId,
            provider: alt.provider as ProviderID,
            estimatedCost: altCost,
            reason: 'Not selected (alternative from forced provider)',
          });
        }

        return {
          selectedModel: model.modelId,
          provider: providerId,
          reason: `Best available model from forced provider '${providerId}' for task '${request.taskType}'`,
          estimatedCost: cost,
          alternatives,
        };
      } else {
        const altCost = await this.calculateCostForRequest(model.modelId, request);
        alternatives.push({
          model: model.modelId,
          provider: model.provider as ProviderID,
          estimatedCost: altCost,
          reason: validation.reason || 'Capability requirement not met',
        });
      }
    }

    throw new RoutingError(
      `No suitable model found from forced provider '${providerId}' for task type '${request.taskType}'.`,
      request.taskType,
      request,
      attemptedModels,
    );
  }

  /**
   * Try workspace-level task overrides.
   */
  private async tryWorkspaceOverrides(
    request: TaskRoutingRequest,
    workspaceConfig: WorkspaceRoutingConfig,
    alternatives: RoutingAlternative[],
    attemptedModels: string[],
  ): Promise<RoutingDecision | null> {
    const overrides = workspaceConfig.taskOverrides?.[request.taskType];
    if (!overrides) return null;

    // Try preferred model
    if (overrides.preferredModel) {
      const result = await this.tryModel(
        overrides.preferredModel, request, workspaceConfig, alternatives, attemptedModels,
      );
      if (result) return result;
    }

    // Try fallback model from overrides
    if (overrides.fallbackModel) {
      const result = await this.tryModel(
        overrides.fallbackModel, request, workspaceConfig, alternatives, attemptedModels,
      );
      if (result) return result;
    }

    return null;
  }

  /**
   * Handle preset-based routing (economy selects cheapest, quality selects premium).
   */
  private async handlePresetRouting(
    request: TaskRoutingRequest,
    workspaceConfig: WorkspaceRoutingConfig,
    alternatives: RoutingAlternative[],
    attemptedModels: string[],
  ): Promise<RoutingDecision | null> {
    let models: ModelDefinition[];
    try {
      models = await this.modelRegistryClient.getSuitableForTask(request.taskType);
    } catch {
      return null;
    }

    // Filter to available models from enabled providers
    const availableModels = models.filter(m => {
      const provider = m.provider as ProviderID;
      return m.available
        && workspaceConfig.enabledProviders.includes(provider)
        && this.providerRegistry.isProviderEnabled(provider);
    });

    if (availableModels.length === 0) return null;

    let sortedModels: ModelDefinition[];

    if (workspaceConfig.preset === 'economy') {
      // Sort by price ascending (cheapest first)
      sortedModels = [...availableModels].sort((a, b) => a.inputPricePer1M - b.inputPricePer1M);
    } else {
      // quality preset: sort by quality tier descending
      const tierOrder: Record<string, number> = { premium: 3, standard: 2, economy: 1 };
      sortedModels = [...availableModels].sort(
        (a, b) => (tierOrder[b.qualityTier] || 0) - (tierOrder[a.qualityTier] || 0),
      );
    }

    for (const model of sortedModels) {
      attemptedModels.push(model.modelId);
      const validation = this.validateCapabilities(model, request);
      if (validation.valid) {
        const cost = await this.calculateCostForRequest(model.modelId, request);

        // Record remaining as alternatives
        for (const alt of sortedModels.filter(m => m.modelId !== model.modelId)) {
          const altCost = await this.calculateCostForRequest(alt.modelId, request);
          alternatives.push({
            model: alt.modelId,
            provider: alt.provider as ProviderID,
            estimatedCost: altCost,
            reason: `Not selected (${workspaceConfig.preset} preset)`,
          });
        }

        return {
          selectedModel: model.modelId,
          provider: model.provider as ProviderID,
          reason: `Selected by '${workspaceConfig.preset}' preset for task '${request.taskType}'`,
          estimatedCost: cost,
          alternatives,
        };
      } else {
        const altCost = await this.calculateCostForRequest(model.modelId, request);
        alternatives.push({
          model: model.modelId,
          provider: model.provider as ProviderID,
          estimatedCost: altCost,
          reason: validation.reason || 'Capability requirement not met',
        });
      }
    }

    return null;
  }

  /**
   * Try default routing rules with fallback chain.
   */
  private async tryDefaultRouting(
    request: TaskRoutingRequest,
    workspaceConfig: WorkspaceRoutingConfig,
    alternatives: RoutingAlternative[],
    attemptedModels: string[],
  ): Promise<RoutingDecision | null> {
    const rule = this.routingRules[request.taskType];
    if (!rule) return null;

    // Try default model
    const defaultResult = await this.tryModel(
      rule.defaultModel, request, workspaceConfig, alternatives, attemptedModels,
    );
    if (defaultResult) return defaultResult;

    // Try fallback models in order
    for (const fallbackModel of rule.fallbackModels) {
      const result = await this.tryModel(
        fallbackModel, request, workspaceConfig, alternatives, attemptedModels,
      );
      if (result) return result;
    }

    return null;
  }

  /**
   * Try models from the registry as a last resort.
   */
  private async tryRegistryFallback(
    request: TaskRoutingRequest,
    workspaceConfig: WorkspaceRoutingConfig,
    alternatives: RoutingAlternative[],
    attemptedModels: string[],
  ): Promise<RoutingDecision | null> {
    let models: ModelDefinition[];
    try {
      models = await this.modelRegistryClient.getSuitableForTask(request.taskType);
    } catch {
      return null;
    }

    // Filter to available models from enabled providers, excluding already attempted
    const candidateModels = models
      .filter(m => {
        const provider = m.provider as ProviderID;
        return m.available
          && workspaceConfig.enabledProviders.includes(provider)
          && this.providerRegistry.isProviderEnabled(provider)
          && !attemptedModels.includes(m.modelId);
      })
      .sort((a, b) => a.inputPricePer1M - b.inputPricePer1M);

    for (const model of candidateModels) {
      attemptedModels.push(model.modelId);
      const validation = this.validateCapabilities(model, request);
      if (validation.valid) {
        const cost = await this.calculateCostForRequest(model.modelId, request);

        // Record remaining as alternatives (selected model already excluded by filter)
        for (const alt of candidateModels.filter(m => m.modelId !== model.modelId)) {
          const altCost = await this.calculateCostForRequest(alt.modelId, request);
          alternatives.push({
            model: alt.modelId,
            provider: alt.provider as ProviderID,
            estimatedCost: altCost,
            reason: 'Not selected (registry fallback alternative)',
          });
        }

        return {
          selectedModel: model.modelId,
          provider: model.provider as ProviderID,
          reason: `Registry fallback: cheapest available model for task '${request.taskType}'`,
          estimatedCost: cost,
          alternatives,
        };
      } else {
        const altCost = await this.calculateCostForRequest(model.modelId, request);
        alternatives.push({
          model: model.modelId,
          provider: model.provider as ProviderID,
          estimatedCost: altCost,
          reason: validation.reason || 'Capability requirement not met',
        });
      }
    }

    return null;
  }

  /**
   * Try a specific model - validate it and return a RoutingDecision if valid.
   */
  private async tryModel(
    modelId: string,
    request: TaskRoutingRequest,
    workspaceConfig: WorkspaceRoutingConfig,
    alternatives: RoutingAlternative[],
    attemptedModels: string[],
  ): Promise<RoutingDecision | null> {
    attemptedModels.push(modelId);

    try {
      // Fetch the model once and reuse for both validation and decision
      const model = await this.modelRegistryClient.getByModelId(modelId);
      const validation = await this.validateModelForRequest(modelId, request, workspaceConfig);
      if (validation.valid) {
        const cost = await this.calculateCostForRequest(modelId, request);
        return {
          selectedModel: modelId,
          provider: model!.provider as ProviderID,
          reason: `Default routing for task '${request.taskType}'`,
          estimatedCost: cost,
          alternatives,
        };
      }

      // Record as alternative with rejection reason
      const cost = await this.calculateCostForRequest(modelId, request);
      alternatives.push({
        model: modelId,
        provider: (model?.provider as ProviderID) || 'unknown',
        estimatedCost: cost,
        reason: validation.reason || 'Validation failed',
      });

      return null;
    } catch {
      // On error (e.g., registry connection failure), record and skip this model
      alternatives.push({
        model: modelId,
        provider: 'unknown',
        estimatedCost: 0,
        reason: `Failed to validate model '${modelId}' (registry error)`,
      });
      return null;
    }
  }

  /**
   * Validate whether a model can handle a specific request.
   * Checks model existence, availability, provider gating, then delegates
   * capability checks to validateCapabilities to avoid duplication.
   */
  private async validateModelForRequest(
    modelId: string,
    request: TaskRoutingRequest,
    workspaceConfig: WorkspaceRoutingConfig,
  ): Promise<ValidationResult> {
    let model: ModelDefinition | null;
    try {
      model = await this.modelRegistryClient.getByModelId(modelId);
    } catch {
      return { valid: false, reason: `Failed to fetch model '${modelId}' from registry` };
    }

    // Check 1: Model exists
    if (!model) {
      return { valid: false, reason: `Model '${modelId}' not found in registry` };
    }

    // Check 2: Model is available
    if (!model.available) {
      return { valid: false, reason: `Model '${modelId}' is not available` };
    }

    // Check 3: Provider has BYOK key (in enabledProviders)
    const provider = model.provider as ProviderID;
    if (!workspaceConfig.enabledProviders.includes(provider)) {
      return { valid: false, reason: `Provider '${provider}' not in workspace enabled providers (no BYOK key)` };
    }

    // Check 4: Provider is enabled in ProviderRegistry
    if (!this.providerRegistry.isProviderEnabled(provider)) {
      return { valid: false, reason: `Provider '${provider}' is disabled in provider registry` };
    }

    // Check 5-10: Capability checks (delegated to avoid duplication)
    return this.validateCapabilities(model, request);
  }

  /**
   * Validate model capabilities (used when model is already fetched).
   */
  private validateCapabilities(
    model: ModelDefinition,
    request: TaskRoutingRequest,
  ): ValidationResult {
    if (request.requiresTools && !model.supportsTools) {
      return { valid: false, reason: `Model '${model.modelId}' does not support tools` };
    }
    if (request.requiresVision && !model.supportsVision) {
      return { valid: false, reason: `Model '${model.modelId}' does not support vision` };
    }
    if (request.requiresStreaming && !model.supportsStreaming) {
      return { valid: false, reason: `Model '${model.modelId}' does not support streaming` };
    }
    if (request.contextSizeTokens && model.contextWindow < request.contextSizeTokens) {
      return {
        valid: false,
        reason: `Model '${model.modelId}' context window (${model.contextWindow}) insufficient for request (${request.contextSizeTokens})`,
      };
    }
    if (request.taskType !== 'embedding' && model.supportsEmbedding && model.suitableFor.length === 1 && model.suitableFor[0] === 'embedding') {
      return { valid: false, reason: `Model '${model.modelId}' is an embedding-only model` };
    }
    if (request.taskType === 'embedding' && !model.supportsEmbedding) {
      return { valid: false, reason: `Model '${model.modelId}' does not support embedding` };
    }
    return { valid: true };
  }

  /**
   * Calculate estimated cost for a request using model pricing.
   */
  private async calculateCostForRequest(
    modelId: string,
    request: TaskRoutingRequest,
  ): Promise<number> {
    const inputTokens = request.estimatedInputTokens ?? DEFAULT_ESTIMATED_INPUT_TOKENS;
    const outputTokens = request.estimatedOutputTokens ?? DEFAULT_ESTIMATED_OUTPUT_TOKENS;
    return this.estimateCost(modelId, inputTokens, outputTokens);
  }
}
