/**
 * CLI Module Integration Tests
 * Story 8-1: Claude Code CLI Wrapper
 *
 * Tests the full session lifecycle with mocked dependencies.
 */

import { EventEmitter } from 'events';
import { ClaudeCodeSession } from '../claude-code-session';
import { CliSessionRedisService } from '../services/cli-session-redis.service';
import { SessionManager } from '../services/session-manager.service';
import { HealthMonitor } from '../services/health-monitor.service';
import { CliSessionMetadata, DEFAULT_SESSION_CONFIG } from '../interfaces';
import Redis from 'ioredis';

// Mock ioredis
jest.mock('ioredis');
const MockRedis = Redis as jest.MockedClass<typeof Redis>;

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';
import { Readable, Writable } from 'stream';
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('CLI Module Integration', () => {
  let mockRedisInstance: jest.Mocked<Redis>;
  let redisService: CliSessionRedisService;
  let sessionManager: SessionManager;
  let healthMonitor: HealthMonitor;

  // Storage for mock Redis data
  let mockStorage: Map<string, Record<string, string>>;
  let mockSets: Map<string, Set<string>>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Initialize mock storage
    mockStorage = new Map();
    mockSets = new Map();

    // Create mock Redis with working storage
    mockRedisInstance = {
      hset: jest.fn().mockImplementation((key: string, value: Record<string, string>) => {
        const existing = mockStorage.get(key) || {};
        if (typeof value === 'object') {
          mockStorage.set(key, { ...existing, ...value });
        }
        return Promise.resolve(1);
      }),
      hgetall: jest.fn().mockImplementation((key: string) => {
        return Promise.resolve(mockStorage.get(key) || {});
      }),
      del: jest.fn().mockImplementation((key: string) => {
        mockStorage.delete(key);
        return Promise.resolve(1);
      }),
      expire: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockImplementation((key: string, value: string) => {
        mockStorage.set(key, { value });
        return Promise.resolve('OK');
      }),
      get: jest.fn().mockImplementation((key: string) => {
        const data = mockStorage.get(key);
        return Promise.resolve(data?.value || null);
      }),
      sadd: jest.fn().mockImplementation((key: string, value: string) => {
        const set = mockSets.get(key) || new Set();
        set.add(value);
        mockSets.set(key, set);
        return Promise.resolve(1);
      }),
      srem: jest.fn().mockImplementation((key: string, value: string) => {
        const set = mockSets.get(key);
        if (set) {
          set.delete(value);
        }
        return Promise.resolve(1);
      }),
      smembers: jest.fn().mockImplementation((key: string) => {
        const set = mockSets.get(key);
        return Promise.resolve(set ? Array.from(set) : []);
      }),
      scan: jest.fn().mockImplementation(() => {
        const keys = Array.from(mockStorage.keys())
          .filter(k => k.startsWith('cli:session:'));
        return Promise.resolve(['0', keys]);
      }),
      quit: jest.fn().mockResolvedValue('OK'),
      on: jest.fn(),
    } as unknown as jest.Mocked<Redis>;

    MockRedis.mockImplementation(() => mockRedisInstance);

    // Create services
    redisService = new CliSessionRedisService(mockRedisInstance);
    sessionManager = new SessionManager(redisService);
    healthMonitor = new HealthMonitor(redisService, sessionManager);
  });

  afterEach(() => {
    healthMonitor.stop();
    jest.useRealTimers();
  });

  describe('Session Lifecycle', () => {
    it('should complete full spawn -> output -> terminate cycle', async () => {
      // Create mock child process with proper streams
      const mockProcess = createMockProcess(12345);

      mockSpawn.mockReturnValue(mockProcess as any);

      // Create session
      const session = await sessionManager.createSession(
        'agent-1',
        'Test task',
        'workspace-1',
        'project-1'
      );

      expect(session).toBeDefined();
      expect(session.getStatus()).toBe('running');
      expect(session.getPid()).toBe(12345);

      // Verify session stored in Redis
      expect(mockRedisInstance.hset).toHaveBeenCalled();
      expect(mockRedisInstance.sadd).toHaveBeenCalled();

      // Collect output events
      const outputs: any[] = [];
      session.on('output', (event) => outputs.push(event));

      // Send a command
      session.sendCommand('test command');
      expect(outputs.length).toBe(1);
      expect(outputs[0].type).toBe('command');

      // Terminate session
      const terminatePromise = sessionManager.terminateSession(session.getSessionId());

      // Simulate process exit
      mockProcess.emit('exit', 0, null);

      await terminatePromise;

      // Verify cleanup
      expect(session.getStatus()).toBe('terminated');
      expect(sessionManager.getSession(session.getSessionId())).toBeNull();
    });

    it('should track multiple sessions correctly', async () => {
      const mockProcess1 = createMockProcess(11111);
      const mockProcess2 = createMockProcess(22222);

      mockSpawn
        .mockReturnValueOnce(mockProcess1 as any)
        .mockReturnValueOnce(mockProcess2 as any);

      const session1 = await sessionManager.createSession(
        'agent-1',
        'Task 1',
        'workspace-1',
        'project-1'
      );

      const session2 = await sessionManager.createSession(
        'agent-2',
        'Task 2',
        'workspace-1',
        'project-1'
      );

      expect(sessionManager.getAllSessions().length).toBe(2);
      expect(sessionManager.getSessionByAgent('agent-1')).toBe(session1);
      expect(sessionManager.getSessionByAgent('agent-2')).toBe(session2);

      // Terminate all
      const promise = sessionManager.terminateAllSessions();

      mockProcess1.emit('exit', 0, null);
      mockProcess2.emit('exit', 0, null);

      await promise;

      expect(sessionManager.getAllSessions().length).toBe(0);
    });
  });

  describe('Redis Persistence', () => {
    it('should persist session metadata across operations', async () => {
      const mockProcess = createMockProcess(12345);
      mockSpawn.mockReturnValue(mockProcess as any);

      const session = await sessionManager.createSession(
        'agent-1',
        'Test task',
        'workspace-1',
        'project-1'
      );

      // Verify session was stored
      const sessionKey = `cli:session:${session.getSessionId()}`;
      expect(mockStorage.has(sessionKey)).toBe(true);

      const storedData = mockStorage.get(sessionKey);
      expect(storedData?.agentId).toBe('agent-1');
      expect(storedData?.status).toBe('running');
      expect(storedData?.task).toBe('Test task');
    });

    it('should update heartbeat in Redis', async () => {
      const mockProcess = createMockProcess(12345);
      mockSpawn.mockReturnValue(mockProcess as any);

      const session = await sessionManager.createSession(
        'agent-1',
        'Test task',
        'workspace-1',
        'project-1'
      );

      // Trigger heartbeat
      jest.advanceTimersByTime(30000);

      // Verify heartbeat was updated
      await Promise.resolve(); // Allow promises to resolve
      expect(mockRedisInstance.hset).toHaveBeenCalledWith(
        expect.stringContaining('cli:session:'),
        'lastHeartbeat',
        expect.any(String)
      );
    });
  });

  describe('Health Monitoring', () => {
    it('should detect and clean up stale sessions', async () => {
      // Manually add a stale session to Redis storage
      const staleSessionId = 'stale-session-123';
      const staleHeartbeat = new Date(Date.now() - 400000).toISOString(); // 6+ min ago

      mockStorage.set(`cli:session:${staleSessionId}`, {
        sessionId: staleSessionId,
        agentId: 'agent-stale',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        pid: '99999',
        status: 'running',
        task: 'Stale task',
        startedAt: staleHeartbeat,
        lastHeartbeat: staleHeartbeat,
      });

      const staleEvents: any[] = [];
      healthMonitor.on('cli:session_stale', (event) => staleEvents.push(event));

      // Perform health check directly
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const status = await healthMonitor.performHealthCheck();
      consoleSpy.mockRestore();

      expect(status.staleSessions).toBe(1);
      expect(staleEvents.length).toBe(1);
      expect(staleEvents[0].sessionId).toBe(staleSessionId);
    });

    it('should report correct health status', async () => {
      const mockProcess = createMockProcess(12345);
      mockSpawn.mockReturnValue(mockProcess as any);

      // Create an active session
      await sessionManager.createSession(
        'agent-1',
        'Active task',
        'workspace-1',
        'project-1'
      );

      const status = await healthMonitor.getHealthStatus();

      expect(status.totalSessions).toBeGreaterThanOrEqual(1);
      expect(status.memoryUsage).toBeGreaterThan(0);
      expect(status.lastHealthCheck).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should enforce workspace session limits', async () => {
      // Create 10 sessions (the limit)
      for (let i = 0; i < 10; i++) {
        const mockProcess = createMockProcess(10000 + i);
        mockSpawn.mockReturnValueOnce(mockProcess as any);

        await sessionManager.createSession(
          `agent-${i}`,
          `Task ${i}`,
          'workspace-1',
          'project-1'
        );
      }

      // 11th session should fail
      const mockProcess11 = createMockProcess(99999);
      mockSpawn.mockReturnValueOnce(mockProcess11 as any);

      await expect(
        sessionManager.createSession(
          'agent-11',
          'Task 11',
          'workspace-1',
          'project-1'
        )
      ).rejects.toThrow('Maximum concurrent sessions');
    });
  });

  // Helper to create mock child process with proper streams
  function createMockProcess(pid: number) {
    const mockProcess = new EventEmitter() as EventEmitter & {
      stdout: Readable;
      stderr: Readable;
      stdin: Writable;
      pid: number;
      kill: jest.Mock;
    };

    mockProcess.stdout = new Readable({ read() {} });
    mockProcess.stderr = new Readable({ read() {} });
    mockProcess.stdin = new Writable({
      write(chunk, encoding, callback) {
        if (callback) callback();
        return true;
      }
    });

    Object.defineProperty(mockProcess, 'pid', {
      value: pid,
      writable: false,
      configurable: true
    });

    mockProcess.kill = jest.fn().mockReturnValue(true);

    return mockProcess;
  }
});
