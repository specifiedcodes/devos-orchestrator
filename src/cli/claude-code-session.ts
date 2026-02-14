/**
 * ClaudeCodeSession
 *
 * Wraps the Claude Code CLI as a child process with full output capture
 * and lifecycle management capabilities.
 *
 * Story 8-1: Claude Code CLI Wrapper
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as readline from 'readline';
import {
  SessionStatus,
  SpawnOptions,
  CliOutputEvent,
  CliErrorEvent,
  ProcessExitInfo,
  DEFAULT_SESSION_CONFIG,
} from './interfaces';

/**
 * Maximum number of output lines to buffer
 */
const MAX_OUTPUT_BUFFER = 1000;

/**
 * ClaudeCodeSession manages a single Claude Code CLI process
 *
 * Events:
 * - 'output': CliOutputEvent - Emitted for each line of stdout/stderr/command
 * - 'error': CliErrorEvent - Emitted on errors
 * - 'terminated': ProcessExitInfo - Emitted when process terminates
 */
export class ClaudeCodeSession extends EventEmitter {
  private readonly sessionId: string;
  private readonly agentId: string;
  private process: ChildProcess | null = null;
  private status: SessionStatus = 'idle';
  private lineNumber: number = 0;
  private outputBuffer: CliOutputEvent[] = [];
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private terminationTimeout: number;
  private stdoutReader: readline.Interface | null = null;
  private stderrReader: readline.Interface | null = null;

  constructor(
    sessionId: string,
    agentId: string,
    terminationTimeout: number = DEFAULT_SESSION_CONFIG.terminationTimeout
  ) {
    super();
    this.sessionId = sessionId;
    this.agentId = agentId;
    this.terminationTimeout = terminationTimeout;
  }

  /**
   * Returns the unique session identifier
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Returns the agent ID associated with this session
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Returns the current session status
   */
  getStatus(): SessionStatus {
    return this.status;
  }

  /**
   * Returns the process ID if running, null otherwise
   */
  getPid(): number | null {
    return this.process?.pid ?? null;
  }

  /**
   * Spawns the Claude Code CLI process
   *
   * @param task - The task description to pass to Claude
   * @param options - Spawn options including working directory
   * @returns The spawned child process
   * @throws Error if a process is already running
   */
  spawn(task: string, options: SpawnOptions): ChildProcess {
    if (this.process && this.status === 'running') {
      throw new Error('Session already has a running process');
    }

    const { workingDirectory, environment = {} } = options;

    // Spawn claude CLI with task
    // Using --print flag for non-interactive task execution
    const args = ['--print', task];

    try {
      this.process = spawn('claude', args, {
        cwd: workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...environment,
          TERM: 'xterm-256color', // Enable color support
        },
      });
    } catch (error) {
      this.emitError('spawn_failed', (error as Error).message);
      throw error;
    }

    this.status = 'running';
    this.lineNumber = 0;
    this.outputBuffer = [];

    this.setupStreamHandlers();
    this.setupProcessEventHandlers();

    return this.process;
  }

  /**
   * Sets up stdout and stderr stream handlers for line-by-line processing
   */
  private setupStreamHandlers(): void {
    if (!this.process) return;

    // Setup stdout handler
    if (this.process.stdout) {
      this.stdoutReader = readline.createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity,
      });

      this.stdoutReader.on('line', (line: string) => {
        this.handleOutputLine(line, 'stdout');
      });
    }

    // Setup stderr handler
    if (this.process.stderr) {
      this.stderrReader = readline.createInterface({
        input: this.process.stderr,
        crlfDelay: Infinity,
      });

      this.stderrReader.on('line', (line: string) => {
        this.handleOutputLine(line, 'stderr');
      });
    }
  }

  /**
   * Closes readline interfaces to prevent memory leaks
   */
  private closeReadlineInterfaces(): void {
    if (this.stdoutReader) {
      this.stdoutReader.close();
      this.stdoutReader = null;
    }
    if (this.stderrReader) {
      this.stderrReader.close();
      this.stderrReader = null;
    }
  }

  /**
   * Sets up process event handlers for exit and error
   */
  private setupProcessEventHandlers(): void {
    if (!this.process) return;

    this.process.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.handleExit(code, signal);
    });

    this.process.on('error', (error: Error) => {
      this.emitError('crash', error.message);
    });
  }

  /**
   * Handles a line of output from stdout or stderr
   */
  private handleOutputLine(content: string, type: 'stdout' | 'stderr'): void {
    this.lineNumber++;

    const event: CliOutputEvent = {
      sessionId: this.sessionId,
      agentId: this.agentId,
      type,
      content,
      timestamp: new Date().toISOString(),
      lineNumber: this.lineNumber,
    };

    this.addToBuffer(event);
    this.emit('output', event);
  }

  /**
   * Adds an output event to the circular buffer
   */
  private addToBuffer(event: CliOutputEvent): void {
    this.outputBuffer.push(event);

    // Maintain max buffer size (circular buffer behavior)
    while (this.outputBuffer.length > MAX_OUTPUT_BUFFER) {
      this.outputBuffer.shift();
    }
  }

  /**
   * Handles process exit
   */
  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.status = 'terminated';

    // Close readline interfaces to prevent memory leaks
    this.closeReadlineInterfaces();

    // Emit exit output event
    const exitEvent: CliOutputEvent = {
      sessionId: this.sessionId,
      agentId: this.agentId,
      type: 'exit',
      content: `Process exited with code ${code}, signal ${signal}`,
      timestamp: new Date().toISOString(),
      lineNumber: ++this.lineNumber,
    };

    this.addToBuffer(exitEvent);
    this.emit('output', exitEvent);

    // Emit terminated event
    const exitInfo: ProcessExitInfo = {
      code,
      signal,
      terminated: true,
    };

    this.emit('terminated', exitInfo);

    // Clear heartbeat interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Sends a command to the process stdin
   *
   * @param command - The command to send
   * @throws Error if no process is running or stdin write fails
   */
  sendCommand(command: string): void {
    if (!this.process || this.status !== 'running') {
      throw new Error('No running process to send command to');
    }

    if (!this.process.stdin) {
      throw new Error('Process stdin is not available');
    }

    // Emit command event
    const commandEvent: CliOutputEvent = {
      sessionId: this.sessionId,
      agentId: this.agentId,
      type: 'command',
      content: command,
      timestamp: new Date().toISOString(),
      lineNumber: ++this.lineNumber,
    };

    this.addToBuffer(commandEvent);
    this.emit('output', commandEvent);

    try {
      this.process.stdin.write(`${command}\n`, (error) => {
        if (error) {
          this.emitError('crash', `Failed to write to stdin: ${error.message}`);
        }
      });
    } catch (error) {
      throw new Error(`Failed to send command: ${(error as Error).message}`);
    }
  }

  /**
   * Terminates the process gracefully with SIGTERM, then SIGKILL after timeout
   *
   * @returns Promise that resolves when the process has terminated
   */
  async terminate(): Promise<void> {
    if (!this.process || this.status === 'terminated') {
      this.status = 'terminated';
      return;
    }

    return new Promise<void>((resolve) => {
      let sigkillTimeout: NodeJS.Timeout | null = null;

      // Handler for when process exits
      const exitHandler = () => {
        if (sigkillTimeout) {
          clearTimeout(sigkillTimeout);
        }
        resolve();
      };

      // Listen for exit
      this.once('terminated', exitHandler);

      // Send SIGTERM first
      this.process!.kill('SIGTERM');

      // Schedule SIGKILL if process doesn't exit
      sigkillTimeout = setTimeout(() => {
        if (this.process && this.status !== 'terminated') {
          this.process.kill('SIGKILL');
        }
      }, this.terminationTimeout);
    });
  }

  /**
   * Returns recent output lines from the buffer
   *
   * @param lineCount - Number of lines to return (max 1000)
   * @returns Array of recent output events
   */
  getRecentOutput(lineCount: number): CliOutputEvent[] {
    const count = Math.min(lineCount, MAX_OUTPUT_BUFFER, this.outputBuffer.length);
    return this.outputBuffer.slice(-count);
  }

  /**
   * Registers a callback for output events
   *
   * @param callback - Function to call on each output event
   */
  onOutput(callback: (event: CliOutputEvent) => void): void {
    this.on('output', callback);
  }

  /**
   * Registers a callback for error events
   *
   * @param callback - Function to call on each error event
   */
  onError(callback: (event: CliErrorEvent) => void): void {
    this.on('error', callback);
  }

  /**
   * Emits an error event
   */
  private emitError(
    errorType: CliErrorEvent['errorType'],
    message: string,
    exitCode?: number,
    signal?: string
  ): void {
    const errorEvent: CliErrorEvent = {
      sessionId: this.sessionId,
      agentId: this.agentId,
      errorType,
      message,
      timestamp: new Date().toISOString(),
      exitCode,
      signal,
    };

    this.emit('error', errorEvent);
  }

  /**
   * Starts the heartbeat interval for this session
   *
   * @param callback - Function to call on each heartbeat
   * @param intervalMs - Heartbeat interval in milliseconds
   */
  startHeartbeat(callback: () => void, intervalMs: number = DEFAULT_SESSION_CONFIG.heartbeatInterval): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.status === 'running') {
        callback();
      }
    }, intervalMs);
  }

  /**
   * Stops the heartbeat interval
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}
