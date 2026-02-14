/**
 * CLI Output Publisher Service
 *
 * Transforms CLI output events and publishes them to Redis for WebSocket delivery.
 * Part of Story 8-2: Live CLI Output Streaming
 */

import Redis from 'ioredis';
import {
  CliOutputEvent,
  CliStreamEvent,
  CliStreamEventType,
  CliStreamEventMetadata,
  SessionContext,
  PublisherConfig,
  PublisherMetrics,
  DEFAULT_PUBLISHER_CONFIG,
  CLI_STREAM_REDIS_PATTERNS,
} from '../interfaces';
import { parseOutputLine } from '../utils/output-parser';
import { createLogger, transports, format, Logger } from 'winston';

// Create module logger
const logger: Logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  defaultMeta: { service: 'cli-output-publisher' },
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
 * Pending event with context
 */
interface PendingEvent {
  event: CliStreamEvent;
  channel: string;
}

/**
 * CliOutputPublisher handles transforming and publishing CLI events to Redis
 *
 * Features:
 * - Transforms CliOutputEvent to CliStreamEvent with enhanced metadata
 * - Batches events to reduce Redis operations
 * - Retries on publish failure
 * - Tracks performance metrics
 * - Thread-safe flush operations with mutex
 */
export class CliOutputPublisher {
  private readonly redis: Redis;
  private readonly config: PublisherConfig;
  private readonly pendingEvents: PendingEvent[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;
  private isFlushInProgress: boolean = false;
  private flushPromise: Promise<void> | null = null;

  // Metrics
  private metrics: PublisherMetrics = {
    eventsPublished: 0,
    batchesPublished: 0,
    averageBatchSize: 0,
    averageLatencyMs: 0,
    publishFailures: 0,
    lastPublishTime: null,
  };

  constructor(
    redis: Redis,
    config: Partial<PublisherConfig> = {}
  ) {
    this.redis = redis;
    this.config = { ...DEFAULT_PUBLISHER_CONFIG, ...config };
  }

  /**
   * Publishes a single CLI output event
   *
   * @param event - The CLI output event from ClaudeCodeSession
   * @param context - Session context with IDs
   */
  async publish(event: CliOutputEvent, context: SessionContext): Promise<void> {
    const streamEvent = this.transformEvent(event, context);
    const channel = `${CLI_STREAM_REDIS_PATTERNS.EVENTS_CHANNEL}${context.workspaceId}`;

    this.pendingEvents.push({ event: streamEvent, channel });

    // Check if we need to flush immediately due to batch size
    if (this.pendingEvents.length >= this.config.maxBatchSize) {
      await this.flush();
    } else {
      this.scheduleBatchFlush();
    }
  }

  /**
   * Publishes multiple CLI output events
   *
   * @param events - Array of CLI output events
   * @param context - Session context with IDs
   */
  async publishBatch(events: CliOutputEvent[], context: SessionContext): Promise<void> {
    for (const event of events) {
      await this.publish(event, context);
    }
  }

  /**
   * Transforms a CliOutputEvent to a CliStreamEvent with enhanced metadata
   */
  private transformEvent(event: CliOutputEvent, context: SessionContext): CliStreamEvent {
    // Parse the output line to detect enhanced event types
    const parsed = parseOutputLine(event.content);

    // Determine the event type and metadata
    let type: CliStreamEventType = 'output';
    const metadata: CliStreamEventMetadata = {};

    // If the original event is a command type, preserve that
    if (event.type === 'command') {
      type = 'command';
    } else if (parsed.type !== 'output') {
      // Use parsed type for enhanced events
      type = parsed.type;

      if (parsed.fileChange) {
        metadata.fileName = parsed.fileChange.fileName;
        metadata.changeType = parsed.fileChange.changeType;
        metadata.filePath = parsed.fileChange.filePath;
      }

      if (parsed.testResult) {
        metadata.testName = parsed.testResult.testName;
        metadata.testStatus = parsed.testResult.status;
        metadata.filePath = parsed.testResult.filePath;
        if (parsed.testResult.summary) {
          metadata.summary = parsed.testResult.summary;
        }
      }

      if (parsed.error) {
        metadata.errorType = parsed.error.errorType;
        metadata.errorCode = parsed.error.errorType;
      }
    }

    // Always include output type for stdout/stderr
    if (event.type === 'stdout' || event.type === 'stderr') {
      metadata.outputType = event.type;
    }

    return {
      sessionId: context.sessionId,
      agentId: context.agentId,
      projectId: context.projectId,
      workspaceId: context.workspaceId,
      type,
      content: event.content,
      timestamp: event.timestamp,
      lineNumber: event.lineNumber,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }

  /**
   * Schedules a batch flush after the batch window
   */
  private scheduleBatchFlush(): void {
    if (this.batchTimer || this.isShuttingDown) {
      return;
    }

    this.batchTimer = setTimeout(async () => {
      this.batchTimer = null;
      await this.flush();
    }, this.config.batchWindowMs);
  }

  /**
   * Flushes all pending events to Redis
   * Uses mutex pattern to prevent race conditions during concurrent flush calls
   */
  private async flush(): Promise<void> {
    // If a flush is already in progress, wait for it to complete
    if (this.isFlushInProgress && this.flushPromise) {
      await this.flushPromise;
      // After waiting, check if there are still events to flush
      if (this.pendingEvents.length === 0) {
        return;
      }
    }

    if (this.pendingEvents.length === 0) {
      return;
    }

    // Clear the batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Set flush lock
    this.isFlushInProgress = true;

    // Take all pending events atomically
    const eventsToPublish = [...this.pendingEvents];
    this.pendingEvents.length = 0;

    const startTime = Date.now();

    // Create the flush promise
    this.flushPromise = (async () => {
      // Publish each event
      const publishPromises = eventsToPublish.map(async ({ event, channel }) => {
        await this.publishWithRetry(channel, JSON.stringify(event));
      });

      try {
        await Promise.all(publishPromises);

        // Update metrics
        const latency = Date.now() - startTime;
        this.updateMetrics(eventsToPublish.length, latency);
      } catch (error) {
        logger.error('Failed to publish batch', { error, eventCount: eventsToPublish.length });
        this.metrics.publishFailures += eventsToPublish.length;
      } finally {
        // Release flush lock
        this.isFlushInProgress = false;
        this.flushPromise = null;

        // If new events were added during flush, schedule another flush
        if (this.pendingEvents.length > 0 && !this.isShuttingDown) {
          this.scheduleBatchFlush();
        }
      }
    })();

    await this.flushPromise;
  }

  /**
   * Publishes a message to Redis with retry logic
   */
  private async publishWithRetry(channel: string, message: string): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        await Promise.race([
          this.redis.publish(channel, message),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Publish timeout')), this.config.publishTimeoutMs)
          ),
        ]);
        return; // Success
      } catch (error) {
        lastError = error as Error;
        logger.warn('Redis publish failed, retrying', {
          attempt: attempt + 1,
          maxAttempts: this.config.retryAttempts,
          error: (error as Error).message,
        });

        // Exponential backoff
        if (attempt < this.config.retryAttempts - 1) {
          await this.delay(this.config.retryDelayMs * Math.pow(2, attempt));
        }
      }
    }

    // All retries failed
    this.metrics.publishFailures++;
    logger.error('Redis publish failed after all retries', {
      channel,
      error: lastError?.message,
    });
  }

  /**
   * Updates publisher metrics
   */
  private updateMetrics(eventCount: number, latencyMs: number): void {
    this.metrics.eventsPublished += eventCount;
    this.metrics.batchesPublished++;

    // Update running averages
    const totalBatches = this.metrics.batchesPublished;
    this.metrics.averageBatchSize =
      (this.metrics.averageBatchSize * (totalBatches - 1) + eventCount) / totalBatches;
    this.metrics.averageLatencyMs =
      (this.metrics.averageLatencyMs * (totalBatches - 1) + latencyMs) / totalBatches;
    this.metrics.lastPublishTime = new Date().toISOString();
  }

  /**
   * Returns current publisher metrics
   */
  getMetrics(): PublisherMetrics {
    return { ...this.metrics };
  }

  /**
   * Resets metrics (useful for testing)
   */
  resetMetrics(): void {
    this.metrics = {
      eventsPublished: 0,
      batchesPublished: 0,
      averageBatchSize: 0,
      averageLatencyMs: 0,
      publishFailures: 0,
      lastPublishTime: null,
    };
  }

  /**
   * Shuts down the publisher, flushing any pending events
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Flush any remaining events
    await this.flush();
  }

  /**
   * Delay helper for retry backoff
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
