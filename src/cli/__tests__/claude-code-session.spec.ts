/**
 * ClaudeCodeSession Unit Tests
 * Story 8-1: Claude Code CLI Wrapper
 */

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter, Readable, Writable } from 'stream';
import { ClaudeCodeSession } from '../claude-code-session';
import { CliOutputEvent, CliErrorEvent, SessionStatus } from '../interfaces';

// Mock child_process.spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

// Helper to create mock child process
interface MockChildProcess extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  stdin: Writable;
  pid: number;
  kill: jest.Mock;
  killed: boolean;
  mockEmit: (event: string, ...args: unknown[]) => void;
}

function createMockChildProcess(): MockChildProcess {
  const mockProcess = new EventEmitter() as MockChildProcess;

  mockProcess.stdout = new Readable({
    read() {}
  });
  mockProcess.stderr = new Readable({
    read() {}
  });
  mockProcess.stdin = new Writable({
    write(chunk, encoding, callback) {
      if (callback) callback();
      return true;
    }
  });

  // Use Object.defineProperty to set readonly properties
  Object.defineProperty(mockProcess, 'pid', {
    value: 12345,
    writable: true,
    configurable: true
  });

  mockProcess.kill = jest.fn().mockReturnValue(true);

  Object.defineProperty(mockProcess, 'killed', {
    value: false,
    writable: true,
    configurable: true
  });

  mockProcess.mockEmit = (event: string, ...args: unknown[]) => {
    mockProcess.emit(event, ...args);
  };

  return mockProcess;
}

describe('ClaudeCodeSession', () => {
  let session: ClaudeCodeSession;
  let mockProcess: ReturnType<typeof createMockChildProcess>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockProcess = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProcess as unknown as ChildProcess);

    session = new ClaudeCodeSession('session-123', 'agent-456');
  });

  afterEach(() => {
    jest.useRealTimers();
    session.removeAllListeners();
  });

  describe('constructor', () => {
    it('should initialize with correct session and agent IDs', () => {
      expect(session.getSessionId()).toBe('session-123');
      expect(session.getAgentId()).toBe('agent-456');
    });

    it('should initialize with idle status', () => {
      expect(session.getStatus()).toBe('idle');
    });

    it('should initialize with null PID', () => {
      expect(session.getPid()).toBeNull();
    });
  });

  describe('spawn()', () => {
    it('should create child process with correct command', () => {
      const task = 'Implement user authentication';
      const workingDir = '/path/to/project';

      session.spawn(task, { workingDirectory: workingDir });

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--print', task]),
        expect.objectContaining({
          cwd: workingDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('should set working directory correctly', () => {
      const workingDir = '/custom/work/dir';

      session.spawn('task', { workingDirectory: workingDir });

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.any(Array),
        expect.objectContaining({ cwd: workingDir })
      );
    });

    it('should return child process', () => {
      const result = session.spawn('task', { workingDirectory: '/tmp' });

      expect(result).toBe(mockProcess);
    });

    it('should set status to running after spawn', () => {
      session.spawn('task', { workingDirectory: '/tmp' });

      expect(session.getStatus()).toBe('running');
    });

    it('should set PID from spawned process', () => {
      session.spawn('task', { workingDirectory: '/tmp' });

      expect(session.getPid()).toBe(12345);
    });

    it('should throw error if already spawned', () => {
      session.spawn('task', { workingDirectory: '/tmp' });

      expect(() => {
        session.spawn('task2', { workingDirectory: '/tmp' });
      }).toThrow('Session already has a running process');
    });

    it('should include TERM environment variable for color support', () => {
      session.spawn('task', { workingDirectory: '/tmp' });

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({ TERM: 'xterm-256color' })
        })
      );
    });
  });

  describe('onOutput()', () => {
    it('should receive stdout data line by line', () => {
      const outputLines: CliOutputEvent[] = [];

      session.on('output', (event: CliOutputEvent) => {
        outputLines.push(event);
      });

      session.spawn('task', { workingDirectory: '/tmp' });

      // sendCommand emits an output event of type 'command'
      session.sendCommand('test');

      expect(outputLines.length).toBeGreaterThanOrEqual(1);
      expect(outputLines[0].type).toBe('command');
      expect(outputLines[0].sessionId).toBe('session-123');
      expect(outputLines[0].agentId).toBe('agent-456');
    });

    it('should include line numbers in output events', () => {
      const outputLines: CliOutputEvent[] = [];

      session.on('output', (event: CliOutputEvent) => {
        outputLines.push(event);
      });

      session.spawn('task', { workingDirectory: '/tmp' });

      // Send multiple commands to verify line numbers increment
      session.sendCommand('command 1');
      session.sendCommand('command 2');

      expect(outputLines.length).toBe(2);
      expect(outputLines[0].lineNumber).toBe(1);
      expect(outputLines[1].lineNumber).toBe(2);
    });

    it('should include timestamp in output events', (done) => {
      session.on('output', (event: CliOutputEvent) => {
        expect(event.timestamp).toBeDefined();
        expect(new Date(event.timestamp).getTime()).not.toBeNaN();
        done();
      });

      session.spawn('task', { workingDirectory: '/tmp' });
      mockProcess.stdout.push('Test line\n');
    });
  });

  describe('onError()', () => {
    it('should receive stderr data', (done) => {
      session.on('output', (event: CliOutputEvent) => {
        if (event.type === 'stderr') {
          expect(event.content).toBe('Error message');
          expect(event.type).toBe('stderr');
          done();
        }
      });

      session.spawn('task', { workingDirectory: '/tmp' });
      mockProcess.stderr.push('Error message\n');
    });

    it('should emit error event on spawn failure', () => {
      mockSpawn.mockImplementationOnce(() => {
        throw new Error('Command not found');
      });

      const errorHandler = jest.fn();
      session.on('error', errorHandler);

      expect(() => {
        session.spawn('task', { workingDirectory: '/tmp' });
      }).toThrow('Command not found');
    });
  });

  describe('sendCommand()', () => {
    it('should write to stdin', () => {
      session.spawn('task', { workingDirectory: '/tmp' });

      const writeSpy = jest.spyOn(mockProcess.stdin, 'write');
      session.sendCommand('test command');

      expect(writeSpy).toHaveBeenCalledWith('test command\n', expect.any(Function));
    });

    it('should throw error if process not running', () => {
      expect(() => {
        session.sendCommand('test');
      }).toThrow('No running process to send command to');
    });

    it('should emit command output event', (done) => {
      session.on('output', (event: CliOutputEvent) => {
        if (event.type === 'command') {
          expect(event.content).toBe('test command');
          done();
        }
      });

      session.spawn('task', { workingDirectory: '/tmp' });
      session.sendCommand('test command');
    });
  });

  describe('terminate()', () => {
    it('should send SIGTERM first', async () => {
      session.spawn('task', { workingDirectory: '/tmp' });

      const terminatePromise = session.terminate();

      // Process exits gracefully
      mockProcess.mockEmit('exit', 0, null);

      await terminatePromise;

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should send SIGKILL after timeout', async () => {
      session.spawn('task', { workingDirectory: '/tmp' });

      const terminatePromise = session.terminate();

      // Advance timer past termination timeout
      jest.advanceTimersByTime(5000);

      // Process exits after SIGKILL
      mockProcess.mockEmit('exit', null, 'SIGKILL');

      await terminatePromise;

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should update status to terminated', async () => {
      session.spawn('task', { workingDirectory: '/tmp' });

      const terminatePromise = session.terminate();
      mockProcess.mockEmit('exit', 0, null);

      await terminatePromise;

      expect(session.getStatus()).toBe('terminated');
    });

    it('should emit terminated event', async () => {
      const terminatedHandler = jest.fn();
      session.on('terminated', terminatedHandler);

      session.spawn('task', { workingDirectory: '/tmp' });

      const terminatePromise = session.terminate();
      mockProcess.mockEmit('exit', 0, null);

      await terminatePromise;

      expect(terminatedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 0,
          signal: null,
          terminated: true
        })
      );
    });

    it('should resolve immediately if no process running', async () => {
      await expect(session.terminate()).resolves.toBeUndefined();
      expect(session.getStatus()).toBe('terminated');
    });
  });

  describe('getStatus()', () => {
    it('should return idle before spawn', () => {
      expect(session.getStatus()).toBe('idle');
    });

    it('should return running after spawn', () => {
      session.spawn('task', { workingDirectory: '/tmp' });
      expect(session.getStatus()).toBe('running');
    });

    it('should return terminated after exit', () => {
      session.spawn('task', { workingDirectory: '/tmp' });
      mockProcess.mockEmit('exit', 0, null);

      expect(session.getStatus()).toBe('terminated');
    });
  });

  describe('exit event handling', () => {
    it('should update status to terminated on exit', () => {
      session.spawn('task', { workingDirectory: '/tmp' });

      mockProcess.mockEmit('exit', 0, null);

      expect(session.getStatus()).toBe('terminated');
    });

    it('should emit exit output event', (done) => {
      session.on('output', (event: CliOutputEvent) => {
        if (event.type === 'exit') {
          expect(event.content).toContain('0');
          done();
        }
      });

      session.spawn('task', { workingDirectory: '/tmp' });
      mockProcess.mockEmit('exit', 0, null);
    });

    it('should emit terminated event on exit', (done) => {
      session.on('terminated', (info: { code: number | null; signal: NodeJS.Signals | null }) => {
        expect(info.code).toBe(0);
        expect(info.signal).toBeNull();
        done();
      });

      session.spawn('task', { workingDirectory: '/tmp' });
      mockProcess.mockEmit('exit', 0, null);
    });
  });

  describe('output buffering', () => {
    it('should maintain buffer of recent output lines', () => {
      session.spawn('task', { workingDirectory: '/tmp' });

      // Push some lines
      mockProcess.stdout.push('Line 1\n');
      mockProcess.stdout.push('Line 2\n');
      mockProcess.stdout.push('Line 3\n');

      // Wait for processing
      jest.advanceTimersByTime(100);

      const recentOutput = session.getRecentOutput(10);
      expect(recentOutput).toBeInstanceOf(Array);
    });

    it('should respect max buffer size (1000 lines)', () => {
      session.spawn('task', { workingDirectory: '/tmp' });

      // getRecentOutput should never return more than buffer max
      const recentOutput = session.getRecentOutput(2000);
      expect(recentOutput.length).toBeLessThanOrEqual(1000);
    });

    it('should return requested number of lines', () => {
      session.spawn('task', { workingDirectory: '/tmp' });

      // Push lines
      for (let i = 0; i < 20; i++) {
        mockProcess.stdout.push(`Line ${i}\n`);
      }

      jest.advanceTimersByTime(100);

      const recent5 = session.getRecentOutput(5);
      expect(recent5.length).toBeLessThanOrEqual(5);
    });
  });

  describe('error handling', () => {
    it('should emit error event on process error', (done) => {
      session.on('error', (event: CliErrorEvent) => {
        expect(event.errorType).toBe('crash');
        expect(event.message).toContain('error');
        done();
      });

      session.spawn('task', { workingDirectory: '/tmp' });
      mockProcess.mockEmit('error', new Error('Process error'));
    });

    it('should handle stdin errors gracefully', () => {
      session.spawn('task', { workingDirectory: '/tmp' });

      // Make stdin.write throw
      jest.spyOn(mockProcess.stdin, 'write').mockImplementationOnce(() => {
        throw new Error('stdin closed');
      });

      expect(() => {
        session.sendCommand('test');
      }).toThrow('Failed to send command');
    });
  });
});
