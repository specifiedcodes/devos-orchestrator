/**
 * SessionManager Service
 *
 * Manages the lifecycle of Claude Code CLI sessions including creation,
 * tracking, heartbeat management, and termination.
 *
 * Story 8-1: Claude Code CLI Wrapper
 */

import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import { ClaudeCodeSession } from '../claude-code-session';
import { CliSessionRedisService } from './cli-session-redis.service';
import {
  CliSessionMetadata,
  SessionManagerConfig,
  DEFAULT_SESSION_CONFIG,
  ProcessExitInfo,
} from '../interfaces';
import { createLogger, transports, format, Logger } from 'winston';

// Create module logger
const logger: Logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  defaultMeta: { service: 'session-manager' },
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
 * SessionManager handles the lifecycle of multiple ClaudeCodeSession instances
 *
 * Responsibilities:
 * - Create and track sessions
 * - Enforce workspace session limits
 * - Manage heartbeat intervals
 * - Handle session cleanup on termination
 */
export class SessionManager {
  private readonly sessions: Map<string, ClaudeCodeSession> = new Map();
  private readonly agentToSession: Map<string, string> = new Map();
  private readonly redisService: CliSessionRedisService;
  private readonly config: SessionManagerConfig;

  constructor(
    redisService: CliSessionRedisService,
    config: Partial<SessionManagerConfig> = {}
  ) {
    this.redisService = redisService;
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config };
  }

  /**
   * Validates input parameters for session creation
   */
  private validateSessionParams(
    agentId: string,
    task: string,
    workspaceId: string,
    projectId: string
  ): void {
    if (!agentId || typeof agentId !== 'string' || agentId.trim() === '') {
      throw new Error('Invalid agentId: must be a non-empty string');
    }
    if (!workspaceId || typeof workspaceId !== 'string' || workspaceId.trim() === '') {
      throw new Error('Invalid workspaceId: must be a non-empty string');
    }
    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
      throw new Error('Invalid projectId: must be a non-empty string');
    }
    if (!task || typeof task !== 'string' || task.trim() === '') {
      throw new Error('Invalid task: must be a non-empty string');
    }
    // Validate UUID format for IDs if they look like full UUIDs (36 chars with dashes)
    // Allow shorter IDs like "agent-1" for testing purposes
    const isLikelyUUID = (id: string) => id.length === 36 && (id.match(/-/g) || []).length === 4;
    if (isLikelyUUID(agentId) && !uuidValidate(agentId)) {
      throw new Error('Invalid agentId: malformed UUID format');
    }
    if (isLikelyUUID(workspaceId) && !uuidValidate(workspaceId)) {
      throw new Error('Invalid workspaceId: malformed UUID format');
    }
    if (isLikelyUUID(projectId) && !uuidValidate(projectId)) {
      throw new Error('Invalid projectId: malformed UUID format');
    }
  }

  /**
   * Creates a new CLI session for an agent
   *
   * @param agentId - The agent ID requesting the session
   * @param task - The task description to execute
   * @param workspaceId - The workspace ID for session isolation
   * @param projectId - The project ID for context
   * @param workingDirectory - Optional working directory (defaults to process.cwd())
   * @returns The created ClaudeCodeSession
   * @throws Error if max concurrent sessions reached for workspace
   */
  async createSession(
    agentId: string,
    task: string,
    workspaceId: string,
    projectId: string,
    workingDirectory?: string
  ): Promise<ClaudeCodeSession> {
    // Validate input parameters
    this.validateSessionParams(agentId, task, workspaceId, projectId);

    // Check workspace session limit
    const currentCount = await this.redisService.getWorkspaceSessionCount(workspaceId);
    if (currentCount >= this.config.maxConcurrentSessions) {
      throw new Error(
        `Maximum concurrent sessions (${this.config.maxConcurrentSessions}) reached for workspace`
      );
    }

    // Generate unique session ID
    const sessionId = uuidv4();

    // Create session instance
    const session = new ClaudeCodeSession(
      sessionId,
      agentId,
      this.config.terminationTimeout
    );

    // Spawn the process
    session.spawn(task, {
      workingDirectory: workingDirectory || process.cwd(),
    });

    // Create session metadata
    const now = new Date().toISOString();
    const metadata: CliSessionMetadata = {
      sessionId,
      agentId,
      workspaceId,
      projectId,
      pid: session.getPid() || 0,
      status: 'running',
      task,
      startedAt: now,
      lastHeartbeat: now,
    };

    // Store in Redis
    await this.redisService.storeSession(metadata);

    // Track in memory
    this.sessions.set(sessionId, session);
    this.agentToSession.set(agentId, sessionId);

    // Start heartbeat
    session.startHeartbeat(
      () => this.handleHeartbeat(sessionId),
      this.config.heartbeatInterval
    );

    // Setup termination handler
    session.on('terminated', (exitInfo: ProcessExitInfo) => {
      this.handleSessionTerminated(sessionId, exitInfo);
    });

    return session;
  }

  /**
   * Gets a session by session ID
   *
   * @param sessionId - Session ID to look up
   * @returns The session or null if not found
   */
  getSession(sessionId: string): ClaudeCodeSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Gets a session by agent ID
   *
   * @param agentId - Agent ID to look up
   * @returns The session or null if agent has no session
   */
  getSessionByAgent(agentId: string): ClaudeCodeSession | null {
    const sessionId = this.agentToSession.get(agentId);
    if (!sessionId) {
      return null;
    }
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Gets all active sessions
   *
   * @returns Array of all active sessions
   */
  getAllSessions(): ClaudeCodeSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Terminates a session by ID
   *
   * @param sessionId - Session ID to terminate
   */
  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return;
    }

    // Remove terminated event listener to prevent race condition with cleanup
    session.removeAllListeners('terminated');

    // Terminate the process
    await session.terminate();

    // Perform cleanup directly (event listener removed, so no double cleanup)
    await this.cleanupSession(sessionId, session.getAgentId());
  }

  /**
   * Terminates all active sessions
   */
  async terminateAllSessions(): Promise<void> {
    const terminatePromises: Promise<void>[] = [];

    for (const [sessionId, session] of this.sessions) {
      terminatePromises.push(
        session.terminate().then(() => {
          this.cleanupSession(sessionId, session.getAgentId());
        })
      );
    }

    await Promise.all(terminatePromises);

    // Clear all maps
    this.sessions.clear();
    this.agentToSession.clear();
  }

  /**
   * Gets the current configuration
   */
  getConfig(): SessionManagerConfig {
    return { ...this.config };
  }

  /**
   * Handles heartbeat update for a session
   *
   * @param sessionId - Session ID to update heartbeat for
   */
  private async handleHeartbeat(sessionId: string): Promise<void> {
    try {
      await this.redisService.updateHeartbeat(sessionId);
    } catch (error) {
      logger.error('Failed to update heartbeat for session', { sessionId, error });
    }
  }

  /**
   * Handles session termination event
   *
   * @param sessionId - ID of terminated session
   * @param exitInfo - Exit information
   */
  private async handleSessionTerminated(
    sessionId: string,
    exitInfo: ProcessExitInfo
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    await this.cleanupSession(sessionId, session.getAgentId());
  }

  /**
   * Cleans up a session from memory and Redis
   *
   * @param sessionId - Session ID to clean up
   * @param agentId - Agent ID to clean up
   */
  private async cleanupSession(sessionId: string, agentId: string): Promise<void> {
    // Remove from memory
    this.sessions.delete(sessionId);
    this.agentToSession.delete(agentId);

    // Remove from Redis
    try {
      await this.redisService.deleteSession(sessionId);
    } catch (error) {
      logger.error('Failed to delete session from Redis', { sessionId, error });
    }
  }
}
