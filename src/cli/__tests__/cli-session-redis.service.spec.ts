/**
 * CliSessionRedisService Unit Tests
 * Story 8-1: Claude Code CLI Wrapper
 */

import { CliSessionRedisService } from '../services/cli-session-redis.service';
import { CliSessionMetadata, REDIS_KEY_PATTERNS } from '../interfaces';
import Redis from 'ioredis';

// Mock ioredis
jest.mock('ioredis');

const MockRedis = Redis as jest.MockedClass<typeof Redis>;

describe('CliSessionRedisService', () => {
  let service: CliSessionRedisService;
  let mockRedisInstance: jest.Mocked<Redis>;

  const sampleMetadata: CliSessionMetadata = {
    sessionId: 'session-123',
    agentId: 'agent-456',
    workspaceId: 'workspace-789',
    projectId: 'project-abc',
    pid: 12345,
    status: 'running',
    task: 'Implement feature X',
    startedAt: '2026-02-13T10:00:00Z',
    lastHeartbeat: '2026-02-13T10:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock Redis instance
    mockRedisInstance = {
      hset: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({}),
      hdel: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
      exists: jest.fn().mockResolvedValue(0),
      quit: jest.fn().mockResolvedValue('OK'),
      multi: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
      on: jest.fn(),
    } as unknown as jest.Mocked<Redis>;

    MockRedis.mockImplementation(() => mockRedisInstance);

    service = new CliSessionRedisService(mockRedisInstance);
  });

  describe('storeSession()', () => {
    it('should create Redis hash with correct fields', async () => {
      await service.storeSession(sampleMetadata);

      expect(mockRedisInstance.hset).toHaveBeenCalledWith(
        `${REDIS_KEY_PATTERNS.SESSION}${sampleMetadata.sessionId}`,
        expect.objectContaining({
          sessionId: sampleMetadata.sessionId,
          agentId: sampleMetadata.agentId,
          workspaceId: sampleMetadata.workspaceId,
          projectId: sampleMetadata.projectId,
          pid: sampleMetadata.pid.toString(),
          status: sampleMetadata.status,
          task: sampleMetadata.task,
          startedAt: sampleMetadata.startedAt,
          lastHeartbeat: sampleMetadata.lastHeartbeat,
        })
      );
    });

    it('should set 24-hour TTL on session', async () => {
      await service.storeSession(sampleMetadata);

      expect(mockRedisInstance.expire).toHaveBeenCalledWith(
        `${REDIS_KEY_PATTERNS.SESSION}${sampleMetadata.sessionId}`,
        86400
      );
    });

    it('should add session to workspace set', async () => {
      await service.storeSession(sampleMetadata);

      expect(mockRedisInstance.sadd).toHaveBeenCalledWith(
        `${REDIS_KEY_PATTERNS.WORKSPACE_SESSIONS}${sampleMetadata.workspaceId}:sessions`,
        sampleMetadata.sessionId
      );
    });

    it('should create agent-to-session mapping', async () => {
      await service.storeSession(sampleMetadata);

      expect(mockRedisInstance.set).toHaveBeenCalledWith(
        `${REDIS_KEY_PATTERNS.AGENT_SESSION}${sampleMetadata.agentId}`,
        sampleMetadata.sessionId
      );
    });
  });

  describe('getSession()', () => {
    it('should retrieve session metadata', async () => {
      mockRedisInstance.hgetall.mockResolvedValue({
        sessionId: sampleMetadata.sessionId,
        agentId: sampleMetadata.agentId,
        workspaceId: sampleMetadata.workspaceId,
        projectId: sampleMetadata.projectId,
        pid: sampleMetadata.pid.toString(),
        status: sampleMetadata.status,
        task: sampleMetadata.task,
        startedAt: sampleMetadata.startedAt,
        lastHeartbeat: sampleMetadata.lastHeartbeat,
      });

      const result = await service.getSession(sampleMetadata.sessionId);

      expect(mockRedisInstance.hgetall).toHaveBeenCalledWith(
        `${REDIS_KEY_PATTERNS.SESSION}${sampleMetadata.sessionId}`
      );
      expect(result).toEqual(expect.objectContaining({
        sessionId: sampleMetadata.sessionId,
        agentId: sampleMetadata.agentId,
        pid: sampleMetadata.pid,
      }));
    });

    it('should return null for non-existent session', async () => {
      mockRedisInstance.hgetall.mockResolvedValue({});

      const result = await service.getSession('non-existent');

      expect(result).toBeNull();
    });

    it('should convert pid to number', async () => {
      mockRedisInstance.hgetall.mockResolvedValue({
        sessionId: sampleMetadata.sessionId,
        agentId: sampleMetadata.agentId,
        workspaceId: sampleMetadata.workspaceId,
        projectId: sampleMetadata.projectId,
        pid: '99999',
        status: 'running',
        task: 'test',
        startedAt: sampleMetadata.startedAt,
        lastHeartbeat: sampleMetadata.lastHeartbeat,
      });

      const result = await service.getSession(sampleMetadata.sessionId);

      expect(result?.pid).toBe(99999);
      expect(typeof result?.pid).toBe('number');
    });
  });

  describe('updateHeartbeat()', () => {
    it('should update lastHeartbeat field', async () => {
      const now = new Date().toISOString();

      await service.updateHeartbeat(sampleMetadata.sessionId);

      expect(mockRedisInstance.hset).toHaveBeenCalledWith(
        `${REDIS_KEY_PATTERNS.SESSION}${sampleMetadata.sessionId}`,
        'lastHeartbeat',
        expect.any(String)
      );
    });

    it('should refresh TTL on heartbeat', async () => {
      await service.updateHeartbeat(sampleMetadata.sessionId);

      expect(mockRedisInstance.expire).toHaveBeenCalledWith(
        `${REDIS_KEY_PATTERNS.SESSION}${sampleMetadata.sessionId}`,
        86400
      );
    });
  });

  describe('deleteSession()', () => {
    it('should remove session from Redis', async () => {
      mockRedisInstance.hgetall.mockResolvedValue({
        sessionId: sampleMetadata.sessionId,
        agentId: sampleMetadata.agentId,
        workspaceId: sampleMetadata.workspaceId,
        projectId: sampleMetadata.projectId,
        pid: sampleMetadata.pid.toString(),
        status: sampleMetadata.status,
        task: sampleMetadata.task,
        startedAt: sampleMetadata.startedAt,
        lastHeartbeat: sampleMetadata.lastHeartbeat,
      });

      await service.deleteSession(sampleMetadata.sessionId);

      expect(mockRedisInstance.del).toHaveBeenCalledWith(
        `${REDIS_KEY_PATTERNS.SESSION}${sampleMetadata.sessionId}`
      );
    });

    it('should remove session from workspace set', async () => {
      mockRedisInstance.hgetall.mockResolvedValue({
        sessionId: sampleMetadata.sessionId,
        agentId: sampleMetadata.agentId,
        workspaceId: sampleMetadata.workspaceId,
        projectId: sampleMetadata.projectId,
        pid: sampleMetadata.pid.toString(),
        status: sampleMetadata.status,
        task: sampleMetadata.task,
        startedAt: sampleMetadata.startedAt,
        lastHeartbeat: sampleMetadata.lastHeartbeat,
      });

      await service.deleteSession(sampleMetadata.sessionId);

      expect(mockRedisInstance.srem).toHaveBeenCalledWith(
        `${REDIS_KEY_PATTERNS.WORKSPACE_SESSIONS}${sampleMetadata.workspaceId}:sessions`,
        sampleMetadata.sessionId
      );
    });

    it('should remove agent-to-session mapping', async () => {
      mockRedisInstance.hgetall.mockResolvedValue({
        sessionId: sampleMetadata.sessionId,
        agentId: sampleMetadata.agentId,
        workspaceId: sampleMetadata.workspaceId,
        projectId: sampleMetadata.projectId,
        pid: sampleMetadata.pid.toString(),
        status: sampleMetadata.status,
        task: sampleMetadata.task,
        startedAt: sampleMetadata.startedAt,
        lastHeartbeat: sampleMetadata.lastHeartbeat,
      });

      await service.deleteSession(sampleMetadata.sessionId);

      expect(mockRedisInstance.del).toHaveBeenCalledWith(
        `${REDIS_KEY_PATTERNS.AGENT_SESSION}${sampleMetadata.agentId}`
      );
    });
  });

  describe('getWorkspaceSessions()', () => {
    it('should return all workspace sessions', async () => {
      const sessionIds = ['session-1', 'session-2', 'session-3'];
      mockRedisInstance.smembers.mockResolvedValue(sessionIds);

      const result = await service.getWorkspaceSessions('workspace-789');

      expect(mockRedisInstance.smembers).toHaveBeenCalledWith(
        `${REDIS_KEY_PATTERNS.WORKSPACE_SESSIONS}workspace-789:sessions`
      );
      expect(result).toEqual(sessionIds);
    });

    it('should return empty array for workspace with no sessions', async () => {
      mockRedisInstance.smembers.mockResolvedValue([]);

      const result = await service.getWorkspaceSessions('empty-workspace');

      expect(result).toEqual([]);
    });
  });

  describe('getSessionByAgent()', () => {
    it('should return session ID for agent', async () => {
      mockRedisInstance.get.mockResolvedValue('session-123');

      const result = await service.getSessionByAgent('agent-456');

      expect(mockRedisInstance.get).toHaveBeenCalledWith(
        `${REDIS_KEY_PATTERNS.AGENT_SESSION}agent-456`
      );
      expect(result).toBe('session-123');
    });

    it('should return null for agent with no session', async () => {
      mockRedisInstance.get.mockResolvedValue(null);

      const result = await service.getSessionByAgent('no-session-agent');

      expect(result).toBeNull();
    });
  });

  describe('updateStatus()', () => {
    it('should update session status field', async () => {
      await service.updateStatus(sampleMetadata.sessionId, 'terminated');

      expect(mockRedisInstance.hset).toHaveBeenCalledWith(
        `${REDIS_KEY_PATTERNS.SESSION}${sampleMetadata.sessionId}`,
        'status',
        'terminated'
      );
    });

    it('should set terminatedAt when status is terminated', async () => {
      await service.updateStatus(sampleMetadata.sessionId, 'terminated');

      expect(mockRedisInstance.hset).toHaveBeenCalledWith(
        `${REDIS_KEY_PATTERNS.SESSION}${sampleMetadata.sessionId}`,
        'terminatedAt',
        expect.any(String)
      );
    });
  });

  describe('getAllSessions()', () => {
    it('should return all session IDs matching pattern', async () => {
      const mockScan = jest.fn()
        .mockResolvedValueOnce(['0', ['cli:session:s1', 'cli:session:s2']]);

      mockRedisInstance.scan = mockScan;

      const result = await service.getAllSessionIds();

      expect(result).toEqual(['s1', 's2']);
    });
  });

  describe('getWorkspaceSessionCount()', () => {
    it('should return count of sessions in workspace', async () => {
      mockRedisInstance.smembers.mockResolvedValue(['s1', 's2', 's3']);

      const count = await service.getWorkspaceSessionCount('workspace-789');

      expect(count).toBe(3);
    });
  });
});
