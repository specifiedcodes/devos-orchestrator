/**
 * CliSessionRedisService
 *
 * Handles Redis storage operations for CLI session metadata.
 * Provides persistence, querying, and lifecycle management for sessions.
 *
 * Story 8-1: Claude Code CLI Wrapper
 */

import Redis from 'ioredis';
import {
  CliSessionMetadata,
  SessionStatus,
  REDIS_KEY_PATTERNS,
  DEFAULT_SESSION_CONFIG,
} from '../interfaces';

/**
 * Service for managing CLI session data in Redis
 */
export class CliSessionRedisService {
  private readonly redis: Redis;
  private readonly sessionTtl: number;

  constructor(redis: Redis, sessionTtl: number = DEFAULT_SESSION_CONFIG.sessionTtl) {
    this.redis = redis;
    this.sessionTtl = sessionTtl;
  }

  /**
   * Stores session metadata in Redis
   *
   * Creates:
   * - Session hash with all metadata
   * - Workspace-to-sessions set mapping
   * - Agent-to-session string mapping
   *
   * @param metadata - Session metadata to store
   */
  async storeSession(metadata: CliSessionMetadata): Promise<void> {
    const sessionKey = `${REDIS_KEY_PATTERNS.SESSION}${metadata.sessionId}`;
    const workspaceKey = `${REDIS_KEY_PATTERNS.WORKSPACE_SESSIONS}${metadata.workspaceId}:sessions`;
    const agentKey = `${REDIS_KEY_PATTERNS.AGENT_SESSION}${metadata.agentId}`;

    // Store session hash (convert all values to strings for Redis)
    await this.redis.hset(sessionKey, {
      sessionId: metadata.sessionId,
      agentId: metadata.agentId,
      workspaceId: metadata.workspaceId,
      projectId: metadata.projectId,
      pid: metadata.pid.toString(),
      status: metadata.status,
      task: metadata.task,
      startedAt: metadata.startedAt,
      lastHeartbeat: metadata.lastHeartbeat,
      ...(metadata.terminatedAt && { terminatedAt: metadata.terminatedAt }),
    });

    // Set TTL on session
    await this.redis.expire(sessionKey, this.sessionTtl);

    // Add session to workspace set
    await this.redis.sadd(workspaceKey, metadata.sessionId);

    // Create agent-to-session mapping
    await this.redis.set(agentKey, metadata.sessionId);
  }

  /**
   * Retrieves session metadata from Redis
   *
   * @param sessionId - Session ID to retrieve
   * @returns Session metadata or null if not found
   */
  async getSession(sessionId: string): Promise<CliSessionMetadata | null> {
    const sessionKey = `${REDIS_KEY_PATTERNS.SESSION}${sessionId}`;
    const data = await this.redis.hgetall(sessionKey);

    // Check if session exists (empty object means not found)
    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    // Convert Redis strings back to proper types
    return {
      sessionId: data.sessionId,
      agentId: data.agentId,
      workspaceId: data.workspaceId,
      projectId: data.projectId,
      pid: parseInt(data.pid, 10),
      status: data.status as SessionStatus,
      task: data.task,
      startedAt: data.startedAt,
      lastHeartbeat: data.lastHeartbeat,
      ...(data.terminatedAt && { terminatedAt: data.terminatedAt }),
    };
  }

  /**
   * Deletes a session and all related mappings from Redis
   *
   * @param sessionId - Session ID to delete
   */
  async deleteSession(sessionId: string): Promise<void> {
    // First get session data to know which mappings to remove
    const metadata = await this.getSession(sessionId);

    if (!metadata) {
      return;
    }

    const sessionKey = `${REDIS_KEY_PATTERNS.SESSION}${sessionId}`;
    const workspaceKey = `${REDIS_KEY_PATTERNS.WORKSPACE_SESSIONS}${metadata.workspaceId}:sessions`;
    const agentKey = `${REDIS_KEY_PATTERNS.AGENT_SESSION}${metadata.agentId}`;

    // Delete session hash
    await this.redis.del(sessionKey);

    // Remove from workspace set
    await this.redis.srem(workspaceKey, sessionId);

    // Delete agent mapping
    await this.redis.del(agentKey);
  }

  /**
   * Updates the heartbeat timestamp for a session
   *
   * @param sessionId - Session ID to update
   */
  async updateHeartbeat(sessionId: string): Promise<void> {
    const sessionKey = `${REDIS_KEY_PATTERNS.SESSION}${sessionId}`;
    const now = new Date().toISOString();

    await this.redis.hset(sessionKey, 'lastHeartbeat', now);

    // Refresh TTL on heartbeat
    await this.redis.expire(sessionKey, this.sessionTtl);
  }

  /**
   * Gets all session IDs for a workspace
   *
   * @param workspaceId - Workspace ID to query
   * @returns Array of session IDs
   */
  async getWorkspaceSessions(workspaceId: string): Promise<string[]> {
    const workspaceKey = `${REDIS_KEY_PATTERNS.WORKSPACE_SESSIONS}${workspaceId}:sessions`;
    return await this.redis.smembers(workspaceKey);
  }

  /**
   * Gets session count for a workspace
   *
   * @param workspaceId - Workspace ID to query
   * @returns Number of active sessions
   */
  async getWorkspaceSessionCount(workspaceId: string): Promise<number> {
    const sessions = await this.getWorkspaceSessions(workspaceId);
    return sessions.length;
  }

  /**
   * Gets the session ID associated with an agent
   *
   * @param agentId - Agent ID to query
   * @returns Session ID or null if agent has no session
   */
  async getSessionByAgent(agentId: string): Promise<string | null> {
    const agentKey = `${REDIS_KEY_PATTERNS.AGENT_SESSION}${agentId}`;
    return await this.redis.get(agentKey);
  }

  /**
   * Updates session status
   *
   * @param sessionId - Session ID to update
   * @param status - New status value
   */
  async updateStatus(sessionId: string, status: SessionStatus): Promise<void> {
    const sessionKey = `${REDIS_KEY_PATTERNS.SESSION}${sessionId}`;

    await this.redis.hset(sessionKey, 'status', status);

    // Set terminatedAt if status is terminated
    if (status === 'terminated') {
      await this.redis.hset(sessionKey, 'terminatedAt', new Date().toISOString());
    }
  }

  /**
   * Adds a session to a workspace set
   *
   * @param workspaceId - Workspace ID
   * @param sessionId - Session ID to add
   */
  async addSessionToWorkspace(workspaceId: string, sessionId: string): Promise<void> {
    const workspaceKey = `${REDIS_KEY_PATTERNS.WORKSPACE_SESSIONS}${workspaceId}:sessions`;
    await this.redis.sadd(workspaceKey, sessionId);
  }

  /**
   * Removes a session from a workspace set
   *
   * @param workspaceId - Workspace ID
   * @param sessionId - Session ID to remove
   */
  async removeSessionFromWorkspace(workspaceId: string, sessionId: string): Promise<void> {
    const workspaceKey = `${REDIS_KEY_PATTERNS.WORKSPACE_SESSIONS}${workspaceId}:sessions`;
    await this.redis.srem(workspaceKey, sessionId);
  }

  /**
   * Creates agent-to-session mapping
   *
   * @param agentId - Agent ID
   * @param sessionId - Session ID
   */
  async mapAgentToSession(agentId: string, sessionId: string): Promise<void> {
    const agentKey = `${REDIS_KEY_PATTERNS.AGENT_SESSION}${agentId}`;
    await this.redis.set(agentKey, sessionId);
  }

  /**
   * Removes agent-to-session mapping
   *
   * @param agentId - Agent ID
   */
  async removeAgentMapping(agentId: string): Promise<void> {
    const agentKey = `${REDIS_KEY_PATTERNS.AGENT_SESSION}${agentId}`;
    await this.redis.del(agentKey);
  }

  /**
   * Maximum number of sessions to scan to prevent unbounded Redis operations
   */
  private static readonly MAX_SCAN_SESSIONS = 10000;

  /**
   * Gets all session IDs (scans Redis for session keys)
   *
   * @param maxResults - Maximum number of session IDs to return (default 10000)
   * @returns Array of all session IDs
   */
  async getAllSessionIds(maxResults: number = CliSessionRedisService.MAX_SCAN_SESSIONS): Promise<string[]> {
    const sessionIds: string[] = [];
    let cursor = '0';
    let iterations = 0;
    const maxIterations = Math.ceil(maxResults / 100); // Safety limit on iterations

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${REDIS_KEY_PATTERNS.SESSION}*`,
        'COUNT',
        100
      );

      cursor = nextCursor;
      iterations++;

      // Extract session IDs from keys
      for (const key of keys) {
        const sessionId = key.replace(REDIS_KEY_PATTERNS.SESSION, '');
        sessionIds.push(sessionId);

        // Stop if we've reached the limit
        if (sessionIds.length >= maxResults) {
          return sessionIds;
        }
      }
    } while (cursor !== '0' && iterations < maxIterations);

    return sessionIds;
  }

  /**
   * Checks if a session exists
   *
   * @param sessionId - Session ID to check
   * @returns true if session exists
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    const sessionKey = `${REDIS_KEY_PATTERNS.SESSION}${sessionId}`;
    const exists = await this.redis.exists(sessionKey);
    return exists === 1;
  }
}
