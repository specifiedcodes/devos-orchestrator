/**
 * CLI Session Interfaces - Public Exports
 */
export {
  SessionStatus,
  OutputEventType,
  CliErrorType,
  CliSessionMetadata,
  CliOutputEvent,
  CliErrorEvent,
  SpawnOptions,
  SessionManagerConfig,
  SessionHealthStatus,
  ProcessExitInfo,
  REDIS_KEY_PATTERNS,
  DEFAULT_SESSION_CONFIG,
} from './cli-session.interfaces';

/**
 * CLI Stream Interfaces - Story 8-2
 */
export {
  CliStreamEventType,
  OutputType,
  FileChangeType,
  TestStatus,
  CliStreamEventMetadata,
  TestSummary,
  CliStreamEvent,
  SessionContext,
  FileChangeInfo,
  TestResultInfo,
  ErrorInfo,
  CliHistoryEvent,
  PublisherConfig,
  DEFAULT_PUBLISHER_CONFIG,
  HistoryConfig,
  DEFAULT_HISTORY_CONFIG,
  CLI_STREAM_REDIS_PATTERNS,
  PublisherMetrics,
} from './cli-stream.interfaces';
