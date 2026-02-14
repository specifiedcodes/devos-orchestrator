/**
 * CLI Module - Public Exports
 *
 * Story 8-1: Claude Code CLI Wrapper
 * Story 8-2: Live CLI Output Streaming
 */

// Main classes
export { ClaudeCodeSession } from './claude-code-session';
export { SessionManager } from './services/session-manager.service';
export { CliSessionRedisService } from './services/cli-session-redis.service';
export { HealthMonitor } from './services/health-monitor.service';

// Story 8-2: Streaming services
export { CliOutputPublisher } from './services/cli-output-publisher.service';
export { SessionHistoryService } from './services/session-history.service';

// Story 8-2: Output parsing utilities
export {
  parseFileChange,
  parseTestResult,
  parseError,
  parseOutputLine,
  ParsedOutputResult,
} from './utils/output-parser';

// Module configuration
export {
  CliModule,
  CliModuleConfig,
  CliModuleInstance,
  RedisConfig,
  createCliModule,
  initializeCliModule,
  shutdownCliModule,
} from './cli.module';

// Interfaces and types
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
  // Story 8-2 interfaces
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
} from './interfaces';
