/**
 * DevOS Orchestrator - Main Entry Point
 *
 * AI agent orchestration engine for the DevOS platform.
 * Manages Claude Code CLI sessions and agent task execution.
 */

import dotenv from 'dotenv';
import { CliModule, CliModuleConfig } from './cli';
import { createProviderRegistry, ProviderRegistry } from './providers';
import { createModelRegistryClient, ModelRegistryClient } from './model-registry';
import { createTaskModelRouter, TaskModelRouter } from './router';

dotenv.config();

console.log('DevOS Orchestrator starting...');
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

// CLI Module instance (initialized on startup)
let cliModule: CliModule | null = null;

// Provider Registry instance (initialized on startup)
let providerRegistry: ProviderRegistry | null = null;

// Model Registry Client instance (initialized on startup)
let modelRegistryClient: ModelRegistryClient | null = null;

// Task Model Router instance (initialized on startup)
let taskModelRouter: TaskModelRouter | null = null;

/**
 * Initializes the orchestrator services
 */
async function initialize(): Promise<void> {
  // Configure CLI module with Redis connection
  const cliConfig: CliModuleConfig = {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
    },
    session: {
      maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS || '10', 10),
      heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10),
      staleThreshold: parseInt(process.env.STALE_THRESHOLD || '300000', 10),
      healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '60000', 10),
    },
  };

  // Initialize CLI module
  cliModule = new CliModule(cliConfig);

  try {
    await cliModule.initialize();
    console.log('CLI Module initialized');
  } catch (error) {
    console.error('Failed to initialize CLI Module:', error);
    // Continue without CLI module if Redis is not available
    // This allows the orchestrator to start in degraded mode
    cliModule = null;
  }

  // Initialize Provider Registry
  providerRegistry = createProviderRegistry();
  console.log('Provider Registry initialized with', providerRegistry.getAllProviders().length, 'providers');

  // Initialize Model Registry Client
  modelRegistryClient = createModelRegistryClient();
  console.log('Model Registry Client initialized');

  // Initialize Task Model Router
  taskModelRouter = createTaskModelRouter(providerRegistry, modelRegistryClient);
  console.log('Task Model Router initialized');
}

/**
 * Graceful shutdown handler
 */
async function shutdown(): Promise<void> {
  console.log('Shutting down DevOS Orchestrator...');

  if (cliModule) {
    await cliModule.shutdown();
  }

  console.log('DevOS Orchestrator shutdown complete');
  process.exit(0);
}

// Handle graceful shutdown signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// Initialize on startup
initialize().catch((error) => {
  console.error('Failed to initialize orchestrator:', error);
  process.exit(1);
});

// Export for external access
export { cliModule, providerRegistry, modelRegistryClient, taskModelRouter };
export { CliModule } from './cli';
export { ProviderRegistry, createProviderRegistry } from './providers';
export { ModelRegistryClient, createModelRegistryClient } from './model-registry';
export { TaskModelRouter, createTaskModelRouter } from './router';
