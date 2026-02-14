/**
 * HealthMonitor Service Unit Tests
 * Story 8-1: Claude Code CLI Wrapper
 */

import { HealthMonitor } from '../services/health-monitor.service';
import { CliSessionRedisService } from '../services/cli-session-redis.service';
import { SessionManager } from '../services/session-manager.service';
import { CliSessionMetadata, SessionHealthStatus } from '../interfaces';

// Mock dependencies
jest.mock('../services/cli-session-redis.service');
jest.mock('../services/session-manager.service');

const MockRedisService = CliSessionRedisService as jest.MockedClass<typeof CliSessionRedisService>;
const MockSessionManager = SessionManager as jest.MockedClass<typeof SessionManager>;

describe('HealthMonitor', () => {
  let healthMonitor: HealthMonitor;
  let mockRedisService: jest.Mocked<CliSessionRedisService>;
  let mockSessionManager: jest.Mocked<SessionManager>;

  const sampleMetadata: CliSessionMetadata = {
    sessionId: 'session-123',
    agentId: 'agent-456',
    workspaceId: 'workspace-789',
    projectId: 'project-abc',
    pid: 12345,
    status: 'running',
    task: 'Test task',
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create mock services
    mockRedisService = {
      getAllSessionIds: jest.fn().mockResolvedValue([]),
      getSession: jest.fn().mockResolvedValue(null),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CliSessionRedisService>;

    mockSessionManager = {
      terminateSession: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SessionManager>;

    MockRedisService.mockImplementation(() => mockRedisService);
    MockSessionManager.mockImplementation(() => mockSessionManager);

    healthMonitor = new HealthMonitor(
      mockRedisService,
      mockSessionManager,
      300000, // 5 minute stale threshold
      60000   // 60 second health check interval
    );
  });

  afterEach(() => {
    healthMonitor.stop();
    jest.useRealTimers();
  });

  describe('start()', () => {
    it('should start the health monitor', () => {
      healthMonitor.start();

      expect(healthMonitor.isMonitoring()).toBe(true);
    });

    it('should run initial health check', async () => {
      mockRedisService.getAllSessionIds.mockResolvedValue([]);

      healthMonitor.start();

      // Allow promises to resolve
      await Promise.resolve();

      expect(mockRedisService.getAllSessionIds).toHaveBeenCalled();
    });

    it('should schedule periodic health checks', async () => {
      mockRedisService.getAllSessionIds.mockResolvedValue([]);

      healthMonitor.start();

      // Initial check
      await Promise.resolve();
      expect(mockRedisService.getAllSessionIds).toHaveBeenCalledTimes(1);

      // Advance to next health check
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      expect(mockRedisService.getAllSessionIds).toHaveBeenCalledTimes(2);
    });

    it('should not start if already running', () => {
      healthMonitor.start();
      healthMonitor.start();

      expect(healthMonitor.isMonitoring()).toBe(true);
    });
  });

  describe('stop()', () => {
    it('should stop the health monitor', () => {
      healthMonitor.start();
      healthMonitor.stop();

      expect(healthMonitor.isMonitoring()).toBe(false);
    });

    it('should clear health check timer', async () => {
      mockRedisService.getAllSessionIds.mockResolvedValue([]);

      healthMonitor.start();
      await Promise.resolve();

      healthMonitor.stop();

      // Advance time and verify no more checks
      const callCountAfterStop = mockRedisService.getAllSessionIds.mock.calls.length;
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      expect(mockRedisService.getAllSessionIds).toHaveBeenCalledTimes(callCountAfterStop);
    });
  });

  describe('performHealthCheck()', () => {
    it('should return health status', async () => {
      mockRedisService.getAllSessionIds.mockResolvedValue(['session-1', 'session-2']);
      mockRedisService.getSession.mockResolvedValue({
        ...sampleMetadata,
        lastHeartbeat: new Date().toISOString(),
      });

      const status = await healthMonitor.performHealthCheck();

      expect(status).toMatchObject({
        totalSessions: 2,
        activeSessions: 2,
        staleSessions: 0,
        terminatedSessions: 0,
      });
      expect(status.memoryUsage).toBeGreaterThan(0);
      expect(status.lastHealthCheck).toBeDefined();
    });

    it('should detect stale sessions', async () => {
      const staleHeartbeat = new Date(Date.now() - 400000).toISOString(); // 6+ minutes ago

      mockRedisService.getAllSessionIds.mockResolvedValue(['session-1']);
      mockRedisService.getSession.mockResolvedValue({
        ...sampleMetadata,
        lastHeartbeat: staleHeartbeat,
      });

      const status = await healthMonitor.performHealthCheck();

      expect(status.staleSessions).toBe(1);
      expect(status.activeSessions).toBe(0);
    });

    it('should emit cli:session_stale event for stale sessions', async () => {
      const staleHeartbeat = new Date(Date.now() - 400000).toISOString();
      const staleHandler = jest.fn();

      healthMonitor.on('cli:session_stale', staleHandler);

      mockRedisService.getAllSessionIds.mockResolvedValue(['session-123']);
      mockRedisService.getSession.mockResolvedValue({
        ...sampleMetadata,
        lastHeartbeat: staleHeartbeat,
      });

      await healthMonitor.performHealthCheck();

      expect(staleHandler).toHaveBeenCalledWith({
        sessionId: 'session-123',
        agentId: 'agent-456',
        lastHeartbeat: staleHeartbeat,
      });
    });

    it('should terminate stale sessions', async () => {
      const staleHeartbeat = new Date(Date.now() - 400000).toISOString();

      mockRedisService.getAllSessionIds.mockResolvedValue(['session-123']);
      mockRedisService.getSession.mockResolvedValue({
        ...sampleMetadata,
        lastHeartbeat: staleHeartbeat,
      });

      await healthMonitor.performHealthCheck();

      expect(mockSessionManager.terminateSession).toHaveBeenCalledWith('session-123');
    });

    it('should count terminated sessions', async () => {
      mockRedisService.getAllSessionIds.mockResolvedValue(['session-1']);
      mockRedisService.getSession.mockResolvedValue({
        ...sampleMetadata,
        status: 'terminated',
      });

      const status = await healthMonitor.performHealthCheck();

      expect(status.terminatedSessions).toBe(1);
      expect(status.activeSessions).toBe(0);
    });

    it('should emit health_check_complete event', async () => {
      const healthHandler = jest.fn();
      healthMonitor.on('health_check_complete', healthHandler);

      mockRedisService.getAllSessionIds.mockResolvedValue([]);

      await healthMonitor.performHealthCheck();

      expect(healthHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          totalSessions: 0,
          activeSessions: 0,
          staleSessions: 0,
          terminatedSessions: 0,
        })
      );
    });

    it('should handle errors gracefully', async () => {
      mockRedisService.getAllSessionIds.mockRejectedValue(new Error('Redis error'));

      // The error will be logged via winston, not console.error
      // We just verify the method completes and returns valid status
      const status = await healthMonitor.performHealthCheck();

      expect(status.totalSessions).toBe(0);
      expect(status.activeSessions).toBe(0);
      expect(status.staleSessions).toBe(0);
    });

    it('should update Redis status if termination fails', async () => {
      const staleHeartbeat = new Date(Date.now() - 400000).toISOString();

      mockRedisService.getAllSessionIds.mockResolvedValue(['session-123']);
      mockRedisService.getSession.mockResolvedValue({
        ...sampleMetadata,
        lastHeartbeat: staleHeartbeat,
      });
      mockSessionManager.terminateSession.mockRejectedValue(new Error('Termination failed'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await healthMonitor.performHealthCheck();

      expect(mockRedisService.updateStatus).toHaveBeenCalledWith('session-123', 'terminated');

      consoleSpy.mockRestore();
    });
  });

  describe('getHealthStatus()', () => {
    it('should perform and return health check', async () => {
      mockRedisService.getAllSessionIds.mockResolvedValue([]);

      const status = await healthMonitor.getHealthStatus();

      expect(status).toBeDefined();
      expect(mockRedisService.getAllSessionIds).toHaveBeenCalled();
    });
  });

  describe('forceHealthCheck()', () => {
    it('should perform immediate health check', async () => {
      mockRedisService.getAllSessionIds.mockResolvedValue([]);

      const status = await healthMonitor.forceHealthCheck();

      expect(status).toBeDefined();
      expect(mockRedisService.getAllSessionIds).toHaveBeenCalled();
    });
  });

  describe('getConfig()', () => {
    it('should return configuration values', () => {
      const config = healthMonitor.getConfig();

      expect(config.staleThreshold).toBe(300000);
      expect(config.healthCheckInterval).toBe(60000);
    });
  });
});
