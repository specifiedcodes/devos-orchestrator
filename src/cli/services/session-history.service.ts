/**
 * Session History Service
 *
 * Manages CLI output history buffer for late-join clients.
 * Stores the last N output events per session in Redis.
 * Part of Story 8-2: Live CLI Output Streaming
 */

import Redis from 'ioredis';
import {
  CliStreamEvent,
  HistoryConfig,
  DEFAULT_HISTORY_CONFIG,
  CLI_STREAM_REDIS_PATTERNS,
} from '../interfaces';
import { createLogger, transports, format, Logger } from 'winston';

// Create module logger
const logger: Logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  defaultMeta: { service: 'session-history' },
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
 * SessionHistoryService manages CLI output history in Redis
 *
 * Features:
 * - Stores last N output events per session in a Redis List
 * - Supports late-join clients retrieving history
 * - Automatic TTL management matching session lifetime
 * - Efficient circular buffer implementation using LPUSH + LTRIM
 */
export class SessionHistoryService {
  private readonly redis: Redis;
  private readonly config: HistoryConfig;

  constructor(
    redis: Redis,
    config: Partial<HistoryConfig> = {}
  ) {
    this.redis = redis;
    this.config = { ...DEFAULT_HISTORY_CONFIG, ...config };
  }

  /**
   * Gets the Redis key for a session's history
   */
  private getHistoryKey(sessionId: string): string {
    return `${CLI_STREAM_REDIS_PATTERNS.HISTORY}${sessionId}`;
  }

  /**
   * Adds a single event to the session history
   *
   * @param sessionId - Session ID
   * @param event - CLI stream event to store
   */
  async addEvent(sessionId: string, event: CliStreamEvent): Promise<void> {
    const key = this.getHistoryKey(sessionId);
    const serialized = JSON.stringify(event);

    try {
      const pipeline = this.redis.pipeline();

      // Push to front of list (newest first)
      pipeline.lpush(key, serialized);

      // Trim to max size (circular buffer)
      pipeline.ltrim(key, 0, this.config.maxLines - 1);

      // Set/refresh TTL
      pipeline.expire(key, this.config.ttlSeconds);

      await pipeline.exec();
    } catch (error) {
      logger.error('Failed to add event to history', {
        sessionId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Adds multiple events to the session history
   *
   * @param sessionId - Session ID
   * @param events - Array of CLI stream events to store
   */
  async addEvents(sessionId: string, events: CliStreamEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const key = this.getHistoryKey(sessionId);

    try {
      const pipeline = this.redis.pipeline();

      // Push events in reverse order so newest ends up at front
      for (let i = events.length - 1; i >= 0; i--) {
        pipeline.lpush(key, JSON.stringify(events[i]));
      }

      // Trim to max size
      pipeline.ltrim(key, 0, this.config.maxLines - 1);

      // Set/refresh TTL
      pipeline.expire(key, this.config.ttlSeconds);

      await pipeline.exec();
    } catch (error) {
      logger.error('Failed to add events to history', {
        sessionId,
        eventCount: events.length,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Result type for getHistory to distinguish empty results from errors
   */


  /**
   * Retrieves history for a session
   *
   * @param sessionId - Session ID
   * @param lineCount - Number of lines to retrieve (default: config.maxLines)
   * @returns Array of CLI stream events in chronological order
   * @throws Error if Redis operation fails (allows caller to handle errors appropriately)
   */
  async getHistory(sessionId: string, lineCount?: number): Promise<CliStreamEvent[]> {
    const key = this.getHistoryKey(sessionId);
    const count = lineCount ?? this.config.maxLines;

    try {
      // Get events from Redis (newest first)
      const serializedEvents = await this.redis.lrange(key, 0, count - 1);

      if (!serializedEvents || serializedEvents.length === 0) {
        return [];
      }

      // Parse and filter out any malformed entries
      const events: CliStreamEvent[] = [];
      for (const serialized of serializedEvents) {
        try {
          const event = JSON.parse(serialized) as CliStreamEvent;
          events.push(event);
        } catch (parseError) {
          logger.warn('Skipping malformed history entry', {
            sessionId,
            error: (parseError as Error).message,
          });
        }
      }

      // Reverse to chronological order (oldest first)
      return events.reverse();
    } catch (error) {
      logger.error('Failed to get history', {
        sessionId,
        error: (error as Error).message,
      });
      // Re-throw to allow caller to handle Redis failures appropriately
      throw error;
    }
  }

  /**
   * Safe version of getHistory that returns empty array on error
   * Use this when you want to gracefully handle Redis failures
   *
   * @param sessionId - Session ID
   * @param lineCount - Number of lines to retrieve (default: config.maxLines)
   * @returns Array of CLI stream events, or empty array on error
   */
  async getHistorySafe(sessionId: string, lineCount?: number): Promise<CliStreamEvent[]> {
    try {
      return await this.getHistory(sessionId, lineCount);
    } catch {
      return [];
    }
  }

  /**
   * Clears history for a session
   *
   * @param sessionId - Session ID
   */
  async clearHistory(sessionId: string): Promise<void> {
    const key = this.getHistoryKey(sessionId);

    try {
      await this.redis.del(key);
    } catch (error) {
      logger.error('Failed to clear history', {
        sessionId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Gets the current history length for a session
   *
   * @param sessionId - Session ID
   * @returns Number of events in history
   */
  async getHistoryLength(sessionId: string): Promise<number> {
    const key = this.getHistoryKey(sessionId);

    try {
      return await this.redis.llen(key);
    } catch (error) {
      logger.error('Failed to get history length', {
        sessionId,
        error: (error as Error).message,
      });
      return 0;
    }
  }

  /**
   * Gets the current configuration
   */
  getConfig(): HistoryConfig {
    return { ...this.config };
  }
}
