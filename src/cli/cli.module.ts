/**
 * CLI Module
 *
 * Configures and exports the CLI session management system.
 * Provides initialization and cleanup for the orchestrator.
 *
 * Story 8-1: Claude Code CLI Wrapper
 * Story 8-2: Live CLI Output Streaming
 */

import Redis from 'ioredis';
import { ClaudeCodeSession } from './claude-code-session';
import { CliSessionRedisService } from './services/cli-session-redis.service';
import { SessionManager } from './services/session-manager.service';
import { HealthMonitor } from './services/health-monitor.service';
import { CliOutputPublisher } from './services/cli-output-publisher.service';
import { SessionHistoryService } from './services/session-history.service';
import {
  SessionManagerConfig,
  DEFAULT_SESSION_CONFIG,
  PublisherConfig,
  DEFAULT_PUBLISHER_CONFIG,
  HistoryConfig,
  DEFAULT_HISTORY_CONFIG,
} from './interfaces';

/**
 * Redis connection configuration
 */
export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

/**
 * CLI Module configuration
 */
export interface CliModuleConfig {
  redis: RedisConfig;
  session?: Partial<SessionManagerConfig>;
  publisher?: Partial<PublisherConfig>;
  history?: Partial<HistoryConfig>;
  enableStreaming?: boolean; // Default: true
}

/**
 * CLI Module instance containing all services
 */
export interface CliModuleInstance {
  redisClient: Redis;
  redisService: CliSessionRedisService;
  sessionManager: SessionManager;
  healthMonitor: HealthMonitor;
  // Story 8-2: Streaming services
  outputPublisher?: CliOutputPublisher;
  historyService?: SessionHistoryService;
}

/**
 * Creates and initializes the CLI module
 *
 * @param config - Module configuration
 * @returns Initialized module instance
 */
export function createCliModule(config: CliModuleConfig): CliModuleInstance {
  // Create Redis client
  const redisClient = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    db: config.redis.db || 0,
    lazyConnect: true,
  });

  // Create services
  const sessionConfig: SessionManagerConfig = {
    ...DEFAULT_SESSION_CONFIG,
    ...config.session,
  };

  const redisService = new CliSessionRedisService(redisClient, sessionConfig.sessionTtl);
  const sessionManager = new SessionManager(redisService, sessionConfig);
  const healthMonitor = new HealthMonitor(
    redisService,
    sessionManager,
    sessionConfig.staleThreshold,
    sessionConfig.healthCheckInterval
  );

  // Story 8-2: Create streaming services if enabled
  const enableStreaming = config.enableStreaming !== false;
  let outputPublisher: CliOutputPublisher | undefined;
  let historyService: SessionHistoryService | undefined;

  if (enableStreaming) {
    const publisherConfig: PublisherConfig = {
      ...DEFAULT_PUBLISHER_CONFIG,
      ...config.publisher,
    };
    outputPublisher = new CliOutputPublisher(redisClient, publisherConfig);

    const historyConfig: HistoryConfig = {
      ...DEFAULT_HISTORY_CONFIG,
      ...config.history,
    };
    historyService = new SessionHistoryService(redisClient, historyConfig);
  }

  return {
    redisClient,
    redisService,
    sessionManager,
    healthMonitor,
    outputPublisher,
    historyService,
  };
}

/**
 * Initializes the CLI module
 *
 * Connects to Redis and starts health monitoring.
 *
 * @param module - CLI module instance
 */
export async function initializeCliModule(module: CliModuleInstance): Promise<void> {
  // Connect to Redis
  await module.redisClient.connect();

  // Start health monitoring
  module.healthMonitor.start();

  console.log('CLI Module initialized successfully');
}

/**
 * Shuts down the CLI module
 *
 * Terminates all sessions and closes connections.
 *
 * @param module - CLI module instance
 */
export async function shutdownCliModule(module: CliModuleInstance): Promise<void> {
  console.log('Shutting down CLI Module...');

  // Stop health monitoring
  module.healthMonitor.stop();

  // Story 8-2: Shutdown output publisher
  if (module.outputPublisher) {
    await module.outputPublisher.shutdown();
  }

  // Terminate all sessions
  await module.sessionManager.terminateAllSessions();

  // Disconnect from Redis
  await module.redisClient.quit();

  console.log('CLI Module shutdown complete');
}

/**
 * CliModule class for object-oriented usage
 */
export class CliModule {
  private readonly config: CliModuleConfig;
  private instance: CliModuleInstance | null = null;

  constructor(config: CliModuleConfig) {
    this.config = config;
  }

  /**
   * Initializes the module
   */
  async initialize(): Promise<CliModuleInstance> {
    if (this.instance) {
      return this.instance;
    }

    this.instance = createCliModule(this.config);
    await initializeCliModule(this.instance);

    return this.instance;
  }

  /**
   * Gets the session manager
   */
  getSessionManager(): SessionManager {
    if (!this.instance) {
      throw new Error('CLI Module not initialized');
    }
    return this.instance.sessionManager;
  }

  /**
   * Gets the health monitor
   */
  getHealthMonitor(): HealthMonitor {
    if (!this.instance) {
      throw new Error('CLI Module not initialized');
    }
    return this.instance.healthMonitor;
  }

  /**
   * Gets the Redis service
   */
  getRedisService(): CliSessionRedisService {
    if (!this.instance) {
      throw new Error('CLI Module not initialized');
    }
    return this.instance.redisService;
  }

  /**
   * Gets the output publisher (Story 8-2)
   */
  getOutputPublisher(): CliOutputPublisher | undefined {
    if (!this.instance) {
      throw new Error('CLI Module not initialized');
    }
    return this.instance.outputPublisher;
  }

  /**
   * Gets the history service (Story 8-2)
   */
  getHistoryService(): SessionHistoryService | undefined {
    if (!this.instance) {
      throw new Error('CLI Module not initialized');
    }
    return this.instance.historyService;
  }

  /**
   * Shuts down the module
   */
  async shutdown(): Promise<void> {
    if (!this.instance) {
      return;
    }

    await shutdownCliModule(this.instance);
    this.instance = null;
  }

  /**
   * Creates a new session
   */
  async createSession(
    agentId: string,
    task: string,
    workspaceId: string,
    projectId: string,
    workingDirectory?: string
  ): Promise<ClaudeCodeSession> {
    if (!this.instance) {
      throw new Error('CLI Module not initialized');
    }

    return this.instance.sessionManager.createSession(
      agentId,
      task,
      workspaceId,
      projectId,
      workingDirectory
    );
  }

  /**
   * Gets a session by ID
   */
  getSession(sessionId: string): ClaudeCodeSession | null {
    if (!this.instance) {
      throw new Error('CLI Module not initialized');
    }

    return this.instance.sessionManager.getSession(sessionId);
  }

  /**
   * Terminates a session
   */
  async terminateSession(sessionId: string): Promise<void> {
    if (!this.instance) {
      throw new Error('CLI Module not initialized');
    }

    await this.instance.sessionManager.terminateSession(sessionId);
  }
}
