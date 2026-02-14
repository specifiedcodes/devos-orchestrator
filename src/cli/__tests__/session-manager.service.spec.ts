/**
 * SessionManager Service Unit Tests
 * Story 8-1: Claude Code CLI Wrapper
 */

import { SessionManager } from '../services/session-manager.service';
import { ClaudeCodeSession } from '../claude-code-session';
import { CliSessionRedisService } from '../services/cli-session-redis.service';
import { CliSessionMetadata, DEFAULT_SESSION_CONFIG } from '../interfaces';
import { EventEmitter } from 'events';

// Mock dependencies
jest.mock('../claude-code-session');
jest.mock('../services/cli-session-redis.service');

const MockClaudeCodeSession = ClaudeCodeSession as jest.MockedClass<typeof ClaudeCodeSession>;
const MockRedisService = CliSessionRedisService as jest.MockedClass<typeof CliSessionRedisService>;

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-uuid-1234'),
}));

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let mockRedisService: jest.Mocked<CliSessionRedisService>;
  let mockSession: jest.Mocked<ClaudeCodeSession> & EventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create mock Redis service
    mockRedisService = {
      storeSession: jest.fn().mockResolvedValue(undefined),
      getSession: jest.fn().mockResolvedValue(null),
      deleteSession: jest.fn().mockResolvedValue(undefined),
      updateHeartbeat: jest.fn().mockResolvedValue(undefined),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      getWorkspaceSessions: jest.fn().mockResolvedValue([]),
      getWorkspaceSessionCount: jest.fn().mockResolvedValue(0),
      getSessionByAgent: jest.fn().mockResolvedValue(null),
      getAllSessionIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<CliSessionRedisService>;

    MockRedisService.mockImplementation(() => mockRedisService);

    // Create mock session as EventEmitter
    mockSession = Object.assign(new EventEmitter(), {
      getSessionId: jest.fn().mockReturnValue('mock-uuid-1234'),
      getAgentId: jest.fn().mockReturnValue('agent-456'),
      getStatus: jest.fn().mockReturnValue('running'),
      getPid: jest.fn().mockReturnValue(12345),
      spawn: jest.fn().mockReturnValue({}),
      sendCommand: jest.fn(),
      terminate: jest.fn().mockResolvedValue(undefined),
      getRecentOutput: jest.fn().mockReturnValue([]),
      onOutput: jest.fn(),
      onError: jest.fn(),
      startHeartbeat: jest.fn(),
      stopHeartbeat: jest.fn(),
    }) as unknown as jest.Mocked<ClaudeCodeSession> & EventEmitter;

    MockClaudeCodeSession.mockImplementation(() => mockSession);

    sessionManager = new SessionManager(mockRedisService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createSession()', () => {
    it('should return ClaudeCodeSession instance', async () => {
      const session = await sessionManager.createSession(
        'agent-456',
        'Implement feature',
        'workspace-789',
        'project-abc'
      );

      expect(session).toBeDefined();
      expect(MockClaudeCodeSession).toHaveBeenCalled();
    });

    it('should store session in Redis', async () => {
      await sessionManager.createSession(
        'agent-456',
        'Implement feature',
        'workspace-789',
        'project-abc'
      );

      expect(mockRedisService.storeSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'mock-uuid-1234',
          agentId: 'agent-456',
          workspaceId: 'workspace-789',
          projectId: 'project-abc',
          task: 'Implement feature',
          status: 'running',
        })
      );
    });

    it('should spawn the process with correct arguments', async () => {
      await sessionManager.createSession(
        'agent-456',
        'Implement feature',
        'workspace-789',
        'project-abc'
      );

      expect(mockSession.spawn).toHaveBeenCalledWith(
        'Implement feature',
        expect.objectContaining({
          workingDirectory: expect.any(String),
        })
      );
    });

    it('should generate unique session ID using UUID v4', async () => {
      const { v4: uuid } = require('uuid');

      await sessionManager.createSession(
        'agent-456',
        'Implement feature',
        'workspace-789',
        'project-abc'
      );

      expect(uuid).toHaveBeenCalled();
    });

    it('should start heartbeat interval', async () => {
      await sessionManager.createSession(
        'agent-456',
        'Implement feature',
        'workspace-789',
        'project-abc'
      );

      expect(mockSession.startHeartbeat).toHaveBeenCalled();
    });

    it('should throw error when max concurrent sessions reached', async () => {
      mockRedisService.getWorkspaceSessionCount.mockResolvedValue(10);

      await expect(
        sessionManager.createSession(
          'agent-456',
          'Implement feature',
          'workspace-789',
          'project-abc'
        )
      ).rejects.toThrow('Maximum concurrent sessions (10) reached for workspace');
    });

    it('should allow session when below limit', async () => {
      mockRedisService.getWorkspaceSessionCount.mockResolvedValue(5);

      const session = await sessionManager.createSession(
        'agent-456',
        'Implement feature',
        'workspace-789',
        'project-abc'
      );

      expect(session).toBeDefined();
    });
  });

  describe('getSession()', () => {
    it('should return correct session', async () => {
      await sessionManager.createSession(
        'agent-456',
        'Implement feature',
        'workspace-789',
        'project-abc'
      );

      const session = sessionManager.getSession('mock-uuid-1234');

      expect(session).toBeDefined();
      expect(session?.getSessionId()).toBe('mock-uuid-1234');
    });

    it('should return null for non-existent session', () => {
      const session = sessionManager.getSession('non-existent');

      expect(session).toBeNull();
    });
  });

  describe('getSessionByAgent()', () => {
    it('should return session for agent', async () => {
      await sessionManager.createSession(
        'agent-456',
        'Implement feature',
        'workspace-789',
        'project-abc'
      );

      const session = sessionManager.getSessionByAgent('agent-456');

      expect(session).toBeDefined();
      expect(session?.getAgentId()).toBe('agent-456');
    });

    it('should return null for agent without session', () => {
      const session = sessionManager.getSessionByAgent('unknown-agent');

      expect(session).toBeNull();
    });
  });

  describe('terminateSession()', () => {
    it('should call session.terminate()', async () => {
      await sessionManager.createSession(
        'agent-456',
        'Implement feature',
        'workspace-789',
        'project-abc'
      );

      await sessionManager.terminateSession('mock-uuid-1234');

      expect(mockSession.terminate).toHaveBeenCalled();
    });

    it('should remove session from Redis', async () => {
      await sessionManager.createSession(
        'agent-456',
        'Implement feature',
        'workspace-789',
        'project-abc'
      );

      await sessionManager.terminateSession('mock-uuid-1234');

      expect(mockRedisService.deleteSession).toHaveBeenCalledWith('mock-uuid-1234');
    });

    it('should remove session from internal map', async () => {
      await sessionManager.createSession(
        'agent-456',
        'Implement feature',
        'workspace-789',
        'project-abc'
      );

      await sessionManager.terminateSession('mock-uuid-1234');

      const session = sessionManager.getSession('mock-uuid-1234');
      expect(session).toBeNull();
    });

    it('should handle non-existent session gracefully', async () => {
      await expect(
        sessionManager.terminateSession('non-existent')
      ).resolves.not.toThrow();
    });
  });

  describe('terminateAllSessions()', () => {
    it('should terminate all active sessions', async () => {
      // Create multiple sessions with different mocks
      const mockSession2 = Object.assign(new EventEmitter(), {
        getSessionId: jest.fn().mockReturnValue('session-2'),
        getAgentId: jest.fn().mockReturnValue('agent-789'),
        getStatus: jest.fn().mockReturnValue('running'),
        getPid: jest.fn().mockReturnValue(12346),
        spawn: jest.fn().mockReturnValue({}),
        terminate: jest.fn().mockResolvedValue(undefined),
        startHeartbeat: jest.fn(),
        stopHeartbeat: jest.fn(),
      }) as unknown as jest.Mocked<ClaudeCodeSession> & EventEmitter;

      MockClaudeCodeSession
        .mockImplementationOnce(() => mockSession)
        .mockImplementationOnce(() => mockSession2);

      // Mock uuid to return different values
      const { v4: uuid } = require('uuid');
      (uuid as jest.Mock)
        .mockReturnValueOnce('mock-uuid-1234')
        .mockReturnValueOnce('session-2');

      await sessionManager.createSession('agent-456', 'Task 1', 'workspace-1', 'project-1');
      await sessionManager.createSession('agent-789', 'Task 2', 'workspace-1', 'project-1');

      await sessionManager.terminateAllSessions();

      expect(mockSession.terminate).toHaveBeenCalled();
      expect(mockSession2.terminate).toHaveBeenCalled();
    });

    it('should clear all sessions from internal map', async () => {
      await sessionManager.createSession('agent-456', 'Task', 'workspace-1', 'project-1');

      await sessionManager.terminateAllSessions();

      const sessions = sessionManager.getAllSessions();
      expect(sessions.length).toBe(0);
    });
  });

  describe('getAllSessions()', () => {
    it('should return all active sessions', async () => {
      await sessionManager.createSession('agent-456', 'Task', 'workspace-1', 'project-1');

      const sessions = sessionManager.getAllSessions();

      expect(sessions.length).toBe(1);
    });

    it('should return empty array when no sessions', () => {
      const sessions = sessionManager.getAllSessions();

      expect(sessions).toEqual([]);
    });
  });

  describe('heartbeat management', () => {
    it('should update Redis heartbeat periodically', async () => {
      await sessionManager.createSession(
        'agent-456',
        'Implement feature',
        'workspace-789',
        'project-abc'
      );

      // Get the heartbeat callback that was passed to startHeartbeat
      const heartbeatCallback = (mockSession.startHeartbeat as jest.Mock).mock.calls[0][0];

      // Call the heartbeat callback
      heartbeatCallback();

      expect(mockRedisService.updateHeartbeat).toHaveBeenCalledWith('mock-uuid-1234');
    });
  });

  describe('session cleanup on termination event', () => {
    it('should clean up session when terminated event is emitted', async () => {
      await sessionManager.createSession(
        'agent-456',
        'Implement feature',
        'workspace-789',
        'project-abc'
      );

      // Emit terminated event
      mockSession.emit('terminated', { code: 0, signal: null, terminated: true });

      // Allow cleanup to process
      await Promise.resolve();

      expect(mockRedisService.deleteSession).toHaveBeenCalledWith('mock-uuid-1234');
    });
  });

  describe('configuration', () => {
    it('should respect custom max concurrent sessions limit', async () => {
      const customConfig = {
        ...DEFAULT_SESSION_CONFIG,
        maxConcurrentSessions: 5,
      };

      sessionManager = new SessionManager(mockRedisService, customConfig);
      mockRedisService.getWorkspaceSessionCount.mockResolvedValue(5);

      await expect(
        sessionManager.createSession('agent-456', 'Task', 'workspace-789', 'project-abc')
      ).rejects.toThrow('Maximum concurrent sessions (5) reached for workspace');
    });
  });
});
