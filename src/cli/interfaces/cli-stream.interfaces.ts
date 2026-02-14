/**
 * CLI Stream Interfaces
 *
 * Types and interfaces for the CLI output streaming system.
 * Part of Story 8-2: Live CLI Output Streaming
 */

/**
 * CLI stream event types
 */
export type CliStreamEventType =
  | 'output'
  | 'command'
  | 'file_change'
  | 'test_result'
  | 'error';

/**
 * Output type for stdout/stderr differentiation
 */
export type OutputType = 'stdout' | 'stderr';

/**
 * File change types
 */
export type FileChangeType = 'created' | 'edited' | 'deleted';

/**
 * Test status types
 */
export type TestStatus = 'passed' | 'failed' | 'skipped';

/**
 * Metadata for CLI stream events
 */
export interface CliStreamEventMetadata {
  outputType?: OutputType;           // For 'output' type
  fileName?: string;                 // For 'file_change' type
  changeType?: FileChangeType;       // For 'file_change'
  testName?: string;                 // For 'test_result' type
  testStatus?: TestStatus;           // For 'test_result'
  filePath?: string;                 // For 'file_change' and 'test_result'
  errorCode?: string;                // For 'error' type
  errorType?: string;                // For 'error' type
  stackTrace?: string;               // For 'error' type
  summary?: TestSummary;             // For 'test_result' summary
}

/**
 * Test result summary
 */
export interface TestSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

/**
 * CLI Stream Event - the main event structure sent via WebSocket
 */
export interface CliStreamEvent {
  sessionId: string;
  agentId: string;
  projectId: string;
  workspaceId: string;
  type: CliStreamEventType;
  content: string;
  timestamp: string;
  lineNumber: number;
  metadata?: CliStreamEventMetadata;
}

/**
 * Session context for publishing events
 */
export interface SessionContext {
  sessionId: string;
  agentId: string;
  projectId: string;
  workspaceId: string;
}

/**
 * File change info parsed from CLI output
 */
export interface FileChangeInfo {
  fileName: string;
  changeType: FileChangeType;
  filePath: string;
}

/**
 * Test result info parsed from CLI output
 */
export interface TestResultInfo {
  testName: string;
  status: TestStatus;
  filePath?: string;
  summary?: TestSummary;
}

/**
 * Error info parsed from CLI output
 */
export interface ErrorInfo {
  errorType: string;
  message: string;
  stackTrace?: string;
}

/**
 * CLI history event for late-join clients
 */
export interface CliHistoryEvent {
  sessionId: string;
  lines: CliStreamEvent[];
  isHistorical: boolean;
}

/**
 * Publisher configuration
 */
export interface PublisherConfig {
  maxBatchSize: number;          // Max events to batch (default: 50)
  batchWindowMs: number;         // Max time to wait before flush (default: 100ms)
  publishTimeoutMs: number;      // Redis publish timeout (default: 500ms)
  retryAttempts: number;         // Number of retry attempts (default: 3)
  retryDelayMs: number;          // Base delay between retries (default: 100ms)
}

/**
 * Default publisher configuration
 */
export const DEFAULT_PUBLISHER_CONFIG: PublisherConfig = {
  maxBatchSize: 50,
  batchWindowMs: 100,
  publishTimeoutMs: 500,
  retryAttempts: 3,
  retryDelayMs: 100,
};

/**
 * Session history configuration
 */
export interface HistoryConfig {
  maxLines: number;              // Max lines to store (default: 1000)
  ttlSeconds: number;            // TTL for history data (default: 86400 - 24h)
}

/**
 * Default history configuration
 */
export const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  maxLines: 1000,
  ttlSeconds: 86400,
};

/**
 * Redis key patterns for CLI streaming
 */
export const CLI_STREAM_REDIS_PATTERNS = {
  EVENTS_CHANNEL: 'cli-events:',        // cli-events:{workspaceId}
  HISTORY: 'cli:history:',              // cli:history:{sessionId}
} as const;

/**
 * Performance metrics interface
 */
export interface PublisherMetrics {
  eventsPublished: number;
  batchesPublished: number;
  averageBatchSize: number;
  averageLatencyMs: number;
  publishFailures: number;
  lastPublishTime: string | null;
}
