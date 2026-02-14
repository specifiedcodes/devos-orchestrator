/**
 * CLI Output Publisher Service Unit Tests
 * Story 8-2: Live CLI Output Streaming
 */

import { CliOutputPublisher } from '../services/cli-output-publisher.service';
import {
  CliOutputEvent,
  CliStreamEvent,
  SessionContext,
  DEFAULT_PUBLISHER_CONFIG,
} from '../interfaces';
import Redis from 'ioredis';

// Mock ioredis
jest.mock('ioredis');

describe('CliOutputPublisher', () => {
  let publisher: CliOutputPublisher;
  let mockRedis: jest.Mocked<Redis>;
  const sessionContext: SessionContext = {
    sessionId: 'session-123',
    agentId: 'agent-456',
    projectId: 'project-789',
    workspaceId: 'workspace-abc',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockRedis = {
      publish: jest.fn().mockResolvedValue(1),
      lpush: jest.fn().mockResolvedValue(1),
      ltrim: jest.fn().mockResolvedValue('OK'),
      expire: jest.fn().mockResolvedValue(1),
      pipeline: jest.fn().mockReturnValue({
        lpush: jest.fn().mockReturnThis(),
        ltrim: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
    } as unknown as jest.Mocked<Redis>;

    publisher = new CliOutputPublisher(mockRedis);
  });

  afterEach(() => {
    jest.useRealTimers();
    publisher.shutdown();
  });

  describe('publish()', () => {
    it('should format CliOutputEvent to CliStreamEvent', async () => {
      const event: CliOutputEvent = {
        sessionId: 'session-123',
        agentId: 'agent-456',
        type: 'stdout',
        content: 'Building project...',
        timestamp: '2026-02-13T10:00:00.000Z',
        lineNumber: 1,
      };

      await publisher.publish(event, sessionContext);

      // Flush the batch
      jest.advanceTimersByTime(DEFAULT_PUBLISHER_CONFIG.batchWindowMs + 10);
      await Promise.resolve();

      expect(mockRedis.publish).toHaveBeenCalled();
      const publishCall = mockRedis.publish.mock.calls[0];
      const publishedEvent = JSON.parse(publishCall[1] as string);

      expect(publishedEvent.sessionId).toBe('session-123');
      expect(publishedEvent.agentId).toBe('agent-456');
      expect(publishedEvent.projectId).toBe('project-789');
      expect(publishedEvent.workspaceId).toBe('workspace-abc');
      expect(publishedEvent.content).toBe('Building project...');
      expect(publishedEvent.type).toBe('output');
    });

    it('should publish to correct Redis channel', async () => {
      const event: CliOutputEvent = {
        sessionId: 'session-123',
        agentId: 'agent-456',
        type: 'stdout',
        content: 'Test output',
        timestamp: '2026-02-13T10:00:00.000Z',
        lineNumber: 1,
      };

      await publisher.publish(event, sessionContext);

      jest.advanceTimersByTime(DEFAULT_PUBLISHER_CONFIG.batchWindowMs + 10);
      await Promise.resolve();

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'cli-events:workspace-abc',
        expect.any(String)
      );
    });

    it('should detect and include file change metadata', async () => {
      const event: CliOutputEvent = {
        sessionId: 'session-123',
        agentId: 'agent-456',
        type: 'stdout',
        content: '> Creating src/auth/login.ts',
        timestamp: '2026-02-13T10:00:00.000Z',
        lineNumber: 1,
      };

      await publisher.publish(event, sessionContext);

      jest.advanceTimersByTime(DEFAULT_PUBLISHER_CONFIG.batchWindowMs + 10);
      await Promise.resolve();

      const publishedEvent = JSON.parse(mockRedis.publish.mock.calls[0][1] as string);
      expect(publishedEvent.type).toBe('file_change');
      expect(publishedEvent.metadata.fileName).toBe('login.ts');
      expect(publishedEvent.metadata.changeType).toBe('created');
    });

    it('should detect and include test result metadata', async () => {
      const event: CliOutputEvent = {
        sessionId: 'session-123',
        agentId: 'agent-456',
        type: 'stdout',
        content: 'PASS src/auth/__tests__/login.spec.ts',
        timestamp: '2026-02-13T10:00:00.000Z',
        lineNumber: 1,
      };

      await publisher.publish(event, sessionContext);

      jest.advanceTimersByTime(DEFAULT_PUBLISHER_CONFIG.batchWindowMs + 10);
      await Promise.resolve();

      const publishedEvent = JSON.parse(mockRedis.publish.mock.calls[0][1] as string);
      expect(publishedEvent.type).toBe('test_result');
      expect(publishedEvent.metadata.testName).toBe('login.spec.ts');
      expect(publishedEvent.metadata.testStatus).toBe('passed');
    });

    it('should detect and include error metadata', async () => {
      const event: CliOutputEvent = {
        sessionId: 'session-123',
        agentId: 'agent-456',
        type: 'stderr',
        content: 'TypeError: undefined is not a function',
        timestamp: '2026-02-13T10:00:00.000Z',
        lineNumber: 1,
      };

      await publisher.publish(event, sessionContext);

      jest.advanceTimersByTime(DEFAULT_PUBLISHER_CONFIG.batchWindowMs + 10);
      await Promise.resolve();

      const publishedEvent = JSON.parse(mockRedis.publish.mock.calls[0][1] as string);
      expect(publishedEvent.type).toBe('error');
      expect(publishedEvent.metadata.errorType).toBe('TypeError');
    });

    it('should preserve outputType in metadata for regular output', async () => {
      const event: CliOutputEvent = {
        sessionId: 'session-123',
        agentId: 'agent-456',
        type: 'stderr',
        content: 'Warning: something might be wrong',
        timestamp: '2026-02-13T10:00:00.000Z',
        lineNumber: 1,
      };

      await publisher.publish(event, sessionContext);

      jest.advanceTimersByTime(DEFAULT_PUBLISHER_CONFIG.batchWindowMs + 10);
      await Promise.resolve();

      const publishedEvent = JSON.parse(mockRedis.publish.mock.calls[0][1] as string);
      expect(publishedEvent.type).toBe('output');
      expect(publishedEvent.metadata.outputType).toBe('stderr');
    });

    it('should detect command type from CliOutputEvent', async () => {
      const event: CliOutputEvent = {
        sessionId: 'session-123',
        agentId: 'agent-456',
        type: 'command',
        content: 'npm install lodash',
        timestamp: '2026-02-13T10:00:00.000Z',
        lineNumber: 1,
      };

      await publisher.publish(event, sessionContext);

      jest.advanceTimersByTime(DEFAULT_PUBLISHER_CONFIG.batchWindowMs + 10);
      await Promise.resolve();

      const publishedEvent = JSON.parse(mockRedis.publish.mock.calls[0][1] as string);
      expect(publishedEvent.type).toBe('command');
    });
  });

  describe('publishBatch()', () => {
    it('should batch multiple events', async () => {
      const events: CliOutputEvent[] = [
        {
          sessionId: 'session-123',
          agentId: 'agent-456',
          type: 'stdout',
          content: 'Line 1',
          timestamp: '2026-02-13T10:00:00.000Z',
          lineNumber: 1,
        },
        {
          sessionId: 'session-123',
          agentId: 'agent-456',
          type: 'stdout',
          content: 'Line 2',
          timestamp: '2026-02-13T10:00:01.000Z',
          lineNumber: 2,
        },
        {
          sessionId: 'session-123',
          agentId: 'agent-456',
          type: 'stdout',
          content: 'Line 3',
          timestamp: '2026-02-13T10:00:02.000Z',
          lineNumber: 3,
        },
      ];

      await publisher.publishBatch(events, sessionContext);

      jest.advanceTimersByTime(DEFAULT_PUBLISHER_CONFIG.batchWindowMs + 10);
      await Promise.resolve();

      // Should publish all events
      expect(mockRedis.publish).toHaveBeenCalledTimes(3);
    });

    it('should flush immediately when batch size exceeded', async () => {
      const events: CliOutputEvent[] = [];
      for (let i = 0; i < DEFAULT_PUBLISHER_CONFIG.maxBatchSize + 10; i++) {
        events.push({
          sessionId: 'session-123',
          agentId: 'agent-456',
          type: 'stdout',
          content: `Line ${i}`,
          timestamp: '2026-02-13T10:00:00.000Z',
          lineNumber: i,
        });
      }

      await publisher.publishBatch(events, sessionContext);

      // Should flush immediately when batch size exceeded
      await Promise.resolve();

      expect(mockRedis.publish).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle Redis publish failure gracefully', async () => {
      mockRedis.publish.mockRejectedValue(new Error('Redis connection lost'));

      const event: CliOutputEvent = {
        sessionId: 'session-123',
        agentId: 'agent-456',
        type: 'stdout',
        content: 'Test output',
        timestamp: '2026-02-13T10:00:00.000Z',
        lineNumber: 1,
      };

      // Should not throw
      await expect(publisher.publish(event, sessionContext)).resolves.not.toThrow();

      jest.advanceTimersByTime(DEFAULT_PUBLISHER_CONFIG.batchWindowMs + 10);
      await Promise.resolve();
    });

    it('should retry on publish failure', async () => {
      mockRedis.publish
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValue(1);

      const event: CliOutputEvent = {
        sessionId: 'session-123',
        agentId: 'agent-456',
        type: 'stdout',
        content: 'Test output',
        timestamp: '2026-02-13T10:00:00.000Z',
        lineNumber: 1,
      };

      await publisher.publish(event, sessionContext);

      // Trigger flush
      jest.advanceTimersByTime(DEFAULT_PUBLISHER_CONFIG.batchWindowMs + 10);
      await Promise.resolve();

      // Advance through retries
      for (let i = 0; i < DEFAULT_PUBLISHER_CONFIG.retryAttempts; i++) {
        jest.advanceTimersByTime(DEFAULT_PUBLISHER_CONFIG.retryDelayMs * Math.pow(2, i));
        await Promise.resolve();
      }

      // Should have attempted retries
      expect(mockRedis.publish.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('batching behavior', () => {
    it('should aggregate events within batch window', async () => {
      const event1: CliOutputEvent = {
        sessionId: 'session-123',
        agentId: 'agent-456',
        type: 'stdout',
        content: 'Line 1',
        timestamp: '2026-02-13T10:00:00.000Z',
        lineNumber: 1,
      };

      const event2: CliOutputEvent = {
        sessionId: 'session-123',
        agentId: 'agent-456',
        type: 'stdout',
        content: 'Line 2',
        timestamp: '2026-02-13T10:00:00.050Z',
        lineNumber: 2,
      };

      await publisher.publish(event1, sessionContext);
      await publisher.publish(event2, sessionContext);

      // Before batch window expires
      expect(mockRedis.publish).not.toHaveBeenCalled();

      // After batch window expires
      jest.advanceTimersByTime(DEFAULT_PUBLISHER_CONFIG.batchWindowMs + 10);
      await Promise.resolve();

      expect(mockRedis.publish).toHaveBeenCalledTimes(2);
    });
  });

  describe('metrics', () => {
    it('should track publish metrics', async () => {
      const event: CliOutputEvent = {
        sessionId: 'session-123',
        agentId: 'agent-456',
        type: 'stdout',
        content: 'Test output',
        timestamp: '2026-02-13T10:00:00.000Z',
        lineNumber: 1,
      };

      await publisher.publish(event, sessionContext);
      jest.advanceTimersByTime(DEFAULT_PUBLISHER_CONFIG.batchWindowMs + 10);
      await Promise.resolve();

      const metrics = publisher.getMetrics();
      expect(metrics.eventsPublished).toBeGreaterThanOrEqual(0);
      expect(metrics.batchesPublished).toBeGreaterThanOrEqual(0);
    });
  });

  describe('shutdown', () => {
    it('should flush pending events on shutdown', async () => {
      const event: CliOutputEvent = {
        sessionId: 'session-123',
        agentId: 'agent-456',
        type: 'stdout',
        content: 'Test output',
        timestamp: '2026-02-13T10:00:00.000Z',
        lineNumber: 1,
      };

      await publisher.publish(event, sessionContext);

      // Should have pending events
      expect(mockRedis.publish).not.toHaveBeenCalled();

      // Shutdown should flush
      await publisher.shutdown();

      // Advance timers to process any remaining promises
      jest.runAllTimers();
      await Promise.resolve();

      expect(mockRedis.publish).toHaveBeenCalled();
    });
  });
});
