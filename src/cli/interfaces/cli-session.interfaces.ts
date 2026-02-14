/**
 * CLI Session Interfaces
 *
 * Types and interfaces for the Claude Code CLI session management system.
 * Part of Story 8-1: Claude Code CLI Wrapper
 */

/**
 * Session status values
 */
export type SessionStatus = 'running' | 'idle' | 'terminated';

/**
 * Output event types
 */
export type OutputEventType = 'stdout' | 'stderr' | 'command' | 'exit';

/**
 * Error event types
 */
export type CliErrorType =
  | 'spawn_failed'
  | 'crash'
  | 'timeout'
  | 'memory_limit'
  | 'redis_error';

/**
 * CLI Session Metadata stored in Redis
 */
export interface CliSessionMetadata {
  sessionId: string;
  agentId: string;
  workspaceId: string;
  projectId: string;
  pid: number;
  status: SessionStatus;
  task: string;
  startedAt: string;       // ISO timestamp
  lastHeartbeat: string;   // ISO timestamp
  terminatedAt?: string;   // ISO timestamp (if terminated)
}

/**
 * CLI Output Event emitted during session execution
 */
export interface CliOutputEvent {
  sessionId: string;
  agentId: string;
  type: OutputEventType;
  content: string;
  timestamp: string;
  lineNumber: number;
}

/**
 * CLI Error Event emitted when errors occur
 */
export interface CliErrorEvent {
  sessionId: string;
  agentId: string;
  errorType: CliErrorType;
  message: string;
  timestamp: string;
  exitCode?: number;
  signal?: string;
}

/**
 * Options for spawning a CLI session
 */
export interface SpawnOptions {
  workingDirectory: string;
  environment?: Record<string, string>;
  timeout?: number;         // Process timeout in milliseconds
  maxOutputBuffer?: number; // Maximum lines to buffer
}

/**
 * Configuration for the Session Manager
 */
export interface SessionManagerConfig {
  maxConcurrentSessions: number;  // Per workspace limit, default 10
  heartbeatInterval: number;      // Milliseconds, default 30000
  staleThreshold: number;         // Milliseconds, default 300000 (5 min)
  healthCheckInterval: number;    // Milliseconds, default 60000
  sessionTtl: number;             // Seconds, default 86400 (24 hours)
  terminationTimeout: number;     // Milliseconds before SIGKILL, default 5000
}

/**
 * Health status for monitoring
 */
export interface SessionHealthStatus {
  totalSessions: number;
  activeSessions: number;
  staleSessions: number;
  terminatedSessions: number;
  memoryUsage: number;          // Bytes
  lastHealthCheck: string;      // ISO timestamp
}

/**
 * Exit information from terminated process
 */
export interface ProcessExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  terminated: boolean;
}

/**
 * Redis key patterns for session storage
 */
export const REDIS_KEY_PATTERNS = {
  SESSION: 'cli:session:',           // cli:session:{sessionId}
  AGENT_SESSION: 'cli:agent:',       // cli:agent:{agentId}
  WORKSPACE_SESSIONS: 'cli:workspace:', // cli:workspace:{workspaceId}:sessions
} as const;

/**
 * Default configuration values
 */
export const DEFAULT_SESSION_CONFIG: SessionManagerConfig = {
  maxConcurrentSessions: 10,
  heartbeatInterval: 30000,      // 30 seconds
  staleThreshold: 300000,        // 5 minutes
  healthCheckInterval: 60000,    // 60 seconds
  sessionTtl: 86400,             // 24 hours
  terminationTimeout: 5000,      // 5 seconds
};
