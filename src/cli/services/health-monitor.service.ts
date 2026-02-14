/**
 * HealthMonitor Service
 *
 * Monitors CLI session health, detects stale sessions, and performs
 * automatic cleanup of dead sessions.
 *
 * Story 8-1: Claude Code CLI Wrapper
 */

import { EventEmitter } from 'events';
import { CliSessionRedisService } from './cli-session-redis.service';
import { SessionManager } from './session-manager.service';
import {
  SessionHealthStatus,
  CliSessionMetadata,
  DEFAULT_SESSION_CONFIG,
} from '../interfaces';
import { createLogger, transports, format, Logger } from 'winston';

// Create module logger
const logger: Logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  defaultMeta: { service: 'health-monitor' },
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      ),
    }),
  ],
});

/**
 * Health monitor events
 */
export interface HealthMonitorEvents {
  'cli:session_stale': { sessionId: string; agentId: string; lastHeartbeat: string };
  'health_check_complete': SessionHealthStatus;
}

/**
 * Type-safe event handler types for HealthMonitor
 */
export type StaleSessionHandler = (event: HealthMonitorEvents['cli:session_stale']) => void;
export type HealthCheckCompleteHandler = (status: SessionHealthStatus) => void;

/**
 * HealthMonitor performs periodic health checks on CLI sessions
 *
 * Features:
 * - Periodic health check interval
 * - Stale session detection
 * - Automatic cleanup of dead sessions
 * - Health status reporting
 *
 * Events:
 * - 'cli:session_stale': Emitted when a stale session is detected
 * - 'health_check_complete': Emitted after each health check with status
 */
export class HealthMonitor extends EventEmitter {
  private readonly redisService: CliSessionRedisService;
  private readonly sessionManager: SessionManager;
  private readonly staleThreshold: number;
  private readonly healthCheckInterval: number;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(
    redisService: CliSessionRedisService,
    sessionManager: SessionManager,
    staleThreshold: number = DEFAULT_SESSION_CONFIG.staleThreshold,
    healthCheckInterval: number = DEFAULT_SESSION_CONFIG.healthCheckInterval
  ) {
    super();
    this.redisService = redisService;
    this.sessionManager = sessionManager;
    this.staleThreshold = staleThreshold;
    this.healthCheckInterval = healthCheckInterval;
  }

  /**
   * Starts the health monitor
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Run initial health check
    this.performHealthCheck();

    // Schedule periodic health checks
    this.healthCheckTimer = setInterval(
      () => this.performHealthCheck(),
      this.healthCheckInterval
    );
  }

  /**
   * Stops the health monitor
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Checks if the health monitor is running
   */
  isMonitoring(): boolean {
    return this.isRunning;
  }

  /**
   * Performs a health check on all sessions
   */
  async performHealthCheck(): Promise<SessionHealthStatus> {
    const now = Date.now();
    let totalSessions = 0;
    let activeSessions = 0;
    let staleSessions = 0;
    let terminatedSessions = 0;

    try {
      // Get all session IDs from Redis
      const sessionIds = await this.redisService.getAllSessionIds();
      totalSessions = sessionIds.length;

      // Check each session
      for (const sessionId of sessionIds) {
        const metadata = await this.redisService.getSession(sessionId);

        if (!metadata) {
          continue;
        }

        if (metadata.status === 'terminated') {
          terminatedSessions++;
          continue;
        }

        // Check if session is stale
        const lastHeartbeat = new Date(metadata.lastHeartbeat).getTime();
        const isStale = (now - lastHeartbeat) > this.staleThreshold;

        if (isStale) {
          staleSessions++;
          await this.handleStaleSession(metadata);
        } else {
          activeSessions++;
        }
      }
    } catch (error) {
      logger.error('Health check failed', { error });
    }

    const status: SessionHealthStatus = {
      totalSessions,
      activeSessions,
      staleSessions,
      terminatedSessions,
      memoryUsage: process.memoryUsage().heapUsed,
      lastHealthCheck: new Date().toISOString(),
    };

    this.emit('health_check_complete', status);

    return status;
  }

  /**
   * Gets the current health status without a full check
   */
  async getHealthStatus(): Promise<SessionHealthStatus> {
    return this.performHealthCheck();
  }

  /**
   * Handles a stale session by terminating and cleaning up
   *
   * @param metadata - Session metadata
   */
  private async handleStaleSession(metadata: CliSessionMetadata): Promise<void> {
    logger.warn('Stale session detected', {
      sessionId: metadata.sessionId,
      agentId: metadata.agentId,
      lastHeartbeat: metadata.lastHeartbeat,
    });

    // Emit stale session event
    this.emit('cli:session_stale', {
      sessionId: metadata.sessionId,
      agentId: metadata.agentId,
      lastHeartbeat: metadata.lastHeartbeat,
    });

    try {
      // Terminate the session
      await this.sessionManager.terminateSession(metadata.sessionId);
    } catch (error) {
      logger.error('Failed to terminate stale session', {
        sessionId: metadata.sessionId,
        error,
      });

      // If termination fails, at least update Redis status
      try {
        await this.redisService.updateStatus(metadata.sessionId, 'terminated');
      } catch (redisError) {
        logger.error('Failed to update Redis status for stale session', {
          sessionId: metadata.sessionId,
          error: redisError,
        });
      }
    }
  }

  /**
   * Forces a health check immediately
   */
  async forceHealthCheck(): Promise<SessionHealthStatus> {
    return this.performHealthCheck();
  }

  /**
   * Gets configuration values
   */
  getConfig(): { staleThreshold: number; healthCheckInterval: number } {
    return {
      staleThreshold: this.staleThreshold,
      healthCheckInterval: this.healthCheckInterval,
    };
  }
}
