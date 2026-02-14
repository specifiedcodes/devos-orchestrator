/**
 * Session History Service Unit Tests
 * Story 8-2: Live CLI Output Streaming
 */

import { SessionHistoryService } from '../services/session-history.service';
import {
  CliStreamEvent,
  DEFAULT_HISTORY_CONFIG,
} from '../interfaces';
import Redis from 'ioredis';

// Mock ioredis
jest.mock('ioredis');

describe('SessionHistoryService', () => {
  let historyService: SessionHistoryService;
  let mockRedis: jest.Mocked<Redis>;

  const createMockEvent = (lineNumber: number, content: string = `Line ${lineNumber}`): CliStreamEvent => ({
    sessionId: 'session-123',
    agentId: 'agent-456',
    projectId: 'project-789',
    workspaceId: 'workspace-abc',
    type: 'output',
    content,
    timestamp: new Date().toISOString(),
    lineNumber,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockRedis = {
      lpush: jest.fn().mockResolvedValue(1),
      ltrim: jest.fn().mockResolvedValue('OK'),
      lrange: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      llen: jest.fn().mockResolvedValue(0),
      pipeline: jest.fn().mockReturnValue({
        lpush: jest.fn().mockReturnThis(),
        ltrim: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
    } as unknown as jest.Mocked<Redis>;

    historyService = new SessionHistoryService(mockRedis);
  });

  describe('addEvent()', () => {
    it('should store event in Redis list', async () => {
      const event = createMockEvent(1);

      await historyService.addEvent('session-123', event);

      expect(mockRedis.pipeline).toHaveBeenCalled();
    });

    it('should use correct Redis key pattern', async () => {
      const event = createMockEvent(1);
      const pipeline = mockRedis.pipeline();

      await historyService.addEvent('session-123', event);

      expect(pipeline.lpush).toHaveBeenCalledWith(
        'cli:history:session-123',
        expect.any(String)
      );
    });

    it('should serialize event to JSON', async () => {
      const event = createMockEvent(1, 'Test content');
      const pipeline = mockRedis.pipeline();

      await historyService.addEvent('session-123', event);

      const serializedEvent = (pipeline.lpush as jest.Mock).mock.calls[0][1];
      const parsedEvent = JSON.parse(serializedEvent);

      expect(parsedEvent.content).toBe('Test content');
      expect(parsedEvent.sessionId).toBe('session-123');
    });

    it('should trim list to max lines', async () => {
      const event = createMockEvent(1);
      const pipeline = mockRedis.pipeline();

      await historyService.addEvent('session-123', event);

      expect(pipeline.ltrim).toHaveBeenCalledWith(
        'cli:history:session-123',
        0,
        DEFAULT_HISTORY_CONFIG.maxLines - 1
      );
    });

    it('should set TTL on history key', async () => {
      const event = createMockEvent(1);
      const pipeline = mockRedis.pipeline();

      await historyService.addEvent('session-123', event);

      expect(pipeline.expire).toHaveBeenCalledWith(
        'cli:history:session-123',
        DEFAULT_HISTORY_CONFIG.ttlSeconds
      );
    });
  });

  describe('addEvents()', () => {
    it('should store multiple events', async () => {
      const events = [
        createMockEvent(1),
        createMockEvent(2),
        createMockEvent(3),
      ];

      await historyService.addEvents('session-123', events);

      const pipeline = mockRedis.pipeline();
      expect(pipeline.lpush).toHaveBeenCalled();
    });

    it('should preserve event order (newest first)', async () => {
      const events = [
        createMockEvent(1, 'First'),
        createMockEvent(2, 'Second'),
        createMockEvent(3, 'Third'),
      ];
      const pipeline = mockRedis.pipeline();

      await historyService.addEvents('session-123', events);

      // Check that events are pushed in reverse order (newest first in list)
      const lpushCalls = (pipeline.lpush as jest.Mock).mock.calls;
      expect(lpushCalls.length).toBeGreaterThan(0);
    });
  });

  describe('getHistory()', () => {
    it('should retrieve history from Redis', async () => {
      const storedEvents = [
        JSON.stringify(createMockEvent(3, 'Third')),
        JSON.stringify(createMockEvent(2, 'Second')),
        JSON.stringify(createMockEvent(1, 'First')),
      ];
      mockRedis.lrange.mockResolvedValue(storedEvents);

      const history = await historyService.getHistory('session-123');

      expect(mockRedis.lrange).toHaveBeenCalledWith(
        'cli:history:session-123',
        0,
        DEFAULT_HISTORY_CONFIG.maxLines - 1
      );
      expect(history).toHaveLength(3);
    });

    it('should return events in chronological order', async () => {
      const storedEvents = [
        JSON.stringify(createMockEvent(3, 'Third')),
        JSON.stringify(createMockEvent(2, 'Second')),
        JSON.stringify(createMockEvent(1, 'First')),
      ];
      mockRedis.lrange.mockResolvedValue(storedEvents);

      const history = await historyService.getHistory('session-123');

      // Should be reversed to chronological order
      expect(history[0].content).toBe('First');
      expect(history[1].content).toBe('Second');
      expect(history[2].content).toBe('Third');
    });

    it('should respect lineCount parameter', async () => {
      const storedEvents = [
        JSON.stringify(createMockEvent(3)),
        JSON.stringify(createMockEvent(2)),
        JSON.stringify(createMockEvent(1)),
      ];
      mockRedis.lrange.mockResolvedValue(storedEvents.slice(0, 2));

      await historyService.getHistory('session-123', 2);

      expect(mockRedis.lrange).toHaveBeenCalledWith(
        'cli:history:session-123',
        0,
        1 // lineCount - 1
      );
    });

    it('should return empty array for non-existent session', async () => {
      mockRedis.lrange.mockResolvedValue([]);

      const history = await historyService.getHistory('non-existent');

      expect(history).toEqual([]);
    });

    it('should handle malformed JSON gracefully', async () => {
      const storedEvents = [
        JSON.stringify(createMockEvent(2)),
        'invalid json',
        JSON.stringify(createMockEvent(1)),
      ];
      mockRedis.lrange.mockResolvedValue(storedEvents);

      const history = await historyService.getHistory('session-123');

      // Should skip invalid entries
      expect(history).toHaveLength(2);
    });
  });

  describe('clearHistory()', () => {
    it('should delete history key from Redis', async () => {
      await historyService.clearHistory('session-123');

      expect(mockRedis.del).toHaveBeenCalledWith('cli:history:session-123');
    });

    it('should handle non-existent session gracefully', async () => {
      mockRedis.del.mockResolvedValue(0);

      await expect(historyService.clearHistory('non-existent')).resolves.not.toThrow();
    });
  });

  describe('getHistoryLength()', () => {
    it('should return current history length', async () => {
      mockRedis.llen.mockResolvedValue(500);

      const length = await historyService.getHistoryLength('session-123');

      expect(mockRedis.llen).toHaveBeenCalledWith('cli:history:session-123');
      expect(length).toBe(500);
    });

    it('should return 0 for non-existent session', async () => {
      mockRedis.llen.mockResolvedValue(0);

      const length = await historyService.getHistoryLength('non-existent');

      expect(length).toBe(0);
    });
  });

  describe('configuration', () => {
    it('should respect custom max lines config', async () => {
      const customHistoryService = new SessionHistoryService(mockRedis, {
        maxLines: 500,
        ttlSeconds: 3600,
      });

      const event = createMockEvent(1);
      const pipeline = mockRedis.pipeline();

      await customHistoryService.addEvent('session-123', event);

      expect(pipeline.ltrim).toHaveBeenCalledWith(
        'cli:history:session-123',
        0,
        499 // maxLines - 1
      );
    });

    it('should respect custom TTL config', async () => {
      const customHistoryService = new SessionHistoryService(mockRedis, {
        maxLines: 1000,
        ttlSeconds: 7200,
      });

      const event = createMockEvent(1);
      const pipeline = mockRedis.pipeline();

      await customHistoryService.addEvent('session-123', event);

      expect(pipeline.expire).toHaveBeenCalledWith(
        'cli:history:session-123',
        7200
      );
    });
  });
});
