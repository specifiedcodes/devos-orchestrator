/**
 * Output Parser
 *
 * Parses CLI output lines to detect file changes, test results, and errors.
 * Part of Story 8-2: Live CLI Output Streaming
 */

import {
  FileChangeInfo,
  TestResultInfo,
  ErrorInfo,
  FileChangeType,
  TestSummary,
  CliStreamEventType,
} from '../interfaces';

/**
 * ANSI escape sequence pattern for stripping color codes during parsing
 */
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Strip ANSI escape sequences from a string
 */
function stripAnsi(str: string): string {
  return str.replace(ANSI_PATTERN, '');
}

/**
 * File change patterns for detecting file operations
 */
const FILE_PATTERNS = {
  create: /^>\s*(?:Creating|Writing|Adding)\s+(.+\.\w+)/i,
  edit: /^>\s*(?:Editing|Modifying|Updating)\s+(.+\.\w+)/i,
  delete: /^>\s*(?:Deleting|Removing)\s+(.+\.\w+)/i,
};

/**
 * Test result patterns for detecting test outcomes
 */
const TEST_PATTERNS = {
  pass: /^(?:\x1b\[[0-9;]*m)*PASS(?:\x1b\[[0-9;]*m)*\s+(.+)/,
  fail: /^(?:\x1b\[[0-9;]*m)*FAIL(?:\x1b\[[0-9;]*m)*\s+(.+)/,
  summary: /Tests:\s*(\d+)\s+passed(?:,\s*(\d+)\s+skipped)?(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+total)?/i,
  summaryAlt: /Tests:\s*(\d+)\s+passed,\s*(\d+)\s+failed,\s*(\d+)\s+total/i,
  summarySkipped: /Tests:\s*(\d+)\s+passed,\s*(\d+)\s+skipped,\s*(\d+)\s+failed,\s*(\d+)\s+total/i,
  okTest: /^\s*ok\s+\d+\s+-\s+(.+)$/,
  notOkTest: /^\s*not ok\s+\d+\s+-\s+(.+)$/,
  checkMark: /^\s*[✓✔]\s+(.+?)(?:\s+\(\d+m?s\))?$/,
  crossMark: /^\s*[✕✗✘×]\s+(.+?)(?:\s+\(\d+m?s\))?$/,
};

/**
 * Error patterns for detecting errors
 */
const ERROR_PATTERNS = {
  jsError: /^(?:\x1b\[[0-9;]*m)*(SyntaxError|TypeError|ReferenceError|RangeError|URIError|EvalError|Error):\s*(.+)/,
  tsError: /^error\s+(TS\d+):\s*(.+)/i,
  npmError: /^npm\s+ERR!\s*(?:code\s+)?(.+)/i,
};

/**
 * Command pattern for detecting command execution
 */
const COMMAND_PATTERN = /^\$\s+.+/;

/**
 * Parse a line of output to detect file changes
 *
 * @param line - Raw output line
 * @returns FileChangeInfo if a file change is detected, null otherwise
 */
export function parseFileChange(line: string): FileChangeInfo | null {
  if (!line || line.trim() === '') {
    return null;
  }

  const cleanLine = stripAnsi(line);

  // Check for file creation
  const createMatch = cleanLine.match(FILE_PATTERNS.create);
  if (createMatch) {
    const filePath = createMatch[1].replace(/\.{3}$/, '').trim(); // Remove trailing ellipsis
    return createFileChangeInfo(filePath, 'created');
  }

  // Check for file edit
  const editMatch = cleanLine.match(FILE_PATTERNS.edit);
  if (editMatch) {
    const filePath = editMatch[1].replace(/\.{3}$/, '').trim();
    return createFileChangeInfo(filePath, 'edited');
  }

  // Check for file deletion
  const deleteMatch = cleanLine.match(FILE_PATTERNS.delete);
  if (deleteMatch) {
    const filePath = deleteMatch[1].replace(/\.{3}$/, '').trim();
    return createFileChangeInfo(filePath, 'deleted');
  }

  return null;
}

/**
 * Create FileChangeInfo from a file path
 */
function createFileChangeInfo(filePath: string, changeType: FileChangeType): FileChangeInfo | null {
  // Validate that it's a file (has extension) not a directory
  const lastSegment = filePath.split('/').pop() || '';
  if (!lastSegment.includes('.')) {
    return null;
  }

  return {
    fileName: lastSegment,
    changeType,
    filePath,
  };
}

/**
 * Parse a line of output to detect test results
 *
 * @param line - Raw output line
 * @returns TestResultInfo if a test result is detected, null otherwise
 */
export function parseTestResult(line: string): TestResultInfo | null {
  if (!line || line.trim() === '') {
    return null;
  }

  const cleanLine = stripAnsi(line);

  // Check for Jest PASS
  const passMatch = line.match(TEST_PATTERNS.pass);
  if (passMatch) {
    const filePath = stripAnsi(passMatch[1]).trim();
    const fileName = filePath.split('/').pop() || filePath;
    return {
      testName: fileName,
      status: 'passed',
      filePath,
    };
  }

  // Check for Jest FAIL
  const failMatch = line.match(TEST_PATTERNS.fail);
  if (failMatch) {
    const filePath = stripAnsi(failMatch[1]).trim();
    const fileName = filePath.split('/').pop() || filePath;
    return {
      testName: fileName,
      status: 'failed',
      filePath,
    };
  }

  // Check for test summary with skipped tests
  const summarySkippedMatch = cleanLine.match(TEST_PATTERNS.summarySkipped);
  if (summarySkippedMatch) {
    const passed = parseInt(summarySkippedMatch[1], 10);
    const skipped = parseInt(summarySkippedMatch[2], 10);
    const failed = parseInt(summarySkippedMatch[3], 10);
    const total = parseInt(summarySkippedMatch[4], 10);
    return {
      testName: 'Test Summary',
      status: failed > 0 ? 'failed' : 'passed',
      summary: { passed, failed, skipped, total },
    };
  }

  // Check for standard test summary
  const summaryMatch = cleanLine.match(TEST_PATTERNS.summary);
  if (summaryMatch) {
    const passed = parseInt(summaryMatch[1], 10);
    const skipped = summaryMatch[2] ? parseInt(summaryMatch[2], 10) : 0;
    const failed = summaryMatch[3] ? parseInt(summaryMatch[3], 10) : 0;
    const total = summaryMatch[4] ? parseInt(summaryMatch[4], 10) : passed + failed + skipped;
    return {
      testName: 'Test Summary',
      status: failed > 0 ? 'failed' : 'passed',
      summary: { passed, failed, skipped, total },
    };
  }

  // Check for alternative summary format
  const summaryAltMatch = cleanLine.match(TEST_PATTERNS.summaryAlt);
  if (summaryAltMatch) {
    const passed = parseInt(summaryAltMatch[1], 10);
    const failed = parseInt(summaryAltMatch[2], 10);
    const total = parseInt(summaryAltMatch[3], 10);
    return {
      testName: 'Test Summary',
      status: failed > 0 ? 'failed' : 'passed',
      summary: { passed, failed, skipped: 0, total },
    };
  }

  // Check for individual test "ok" pattern
  const okMatch = cleanLine.match(TEST_PATTERNS.okTest);
  if (okMatch) {
    return {
      testName: okMatch[1].trim(),
      status: 'passed',
    };
  }

  // Check for individual test "not ok" pattern
  const notOkMatch = cleanLine.match(TEST_PATTERNS.notOkTest);
  if (notOkMatch) {
    return {
      testName: notOkMatch[1].trim(),
      status: 'failed',
    };
  }

  // Check for check mark (✓) pattern
  const checkMatch = cleanLine.match(TEST_PATTERNS.checkMark);
  if (checkMatch) {
    return {
      testName: checkMatch[1].trim(),
      status: 'passed',
    };
  }

  // Check for cross mark (✕) pattern
  const crossMatch = cleanLine.match(TEST_PATTERNS.crossMark);
  if (crossMatch) {
    return {
      testName: crossMatch[1].trim(),
      status: 'failed',
    };
  }

  return null;
}

/**
 * Parse a line of output to detect errors
 *
 * @param line - Raw output line
 * @returns ErrorInfo if an error is detected, null otherwise
 */
export function parseError(line: string): ErrorInfo | null {
  if (!line || line.trim() === '') {
    return null;
  }

  const cleanLine = stripAnsi(line);

  // Check for JavaScript/TypeScript runtime errors
  const jsErrorMatch = cleanLine.match(ERROR_PATTERNS.jsError);
  if (jsErrorMatch) {
    return {
      errorType: jsErrorMatch[1],
      message: jsErrorMatch[2].trim(),
    };
  }

  // Check for TypeScript compilation errors
  const tsErrorMatch = cleanLine.match(ERROR_PATTERNS.tsError);
  if (tsErrorMatch) {
    return {
      errorType: tsErrorMatch[1],
      message: tsErrorMatch[2].trim(),
    };
  }

  // Check for npm errors
  const npmErrorMatch = cleanLine.match(ERROR_PATTERNS.npmError);
  if (npmErrorMatch) {
    return {
      errorType: 'npm',
      message: npmErrorMatch[1].trim(),
    };
  }

  return null;
}

/**
 * Result of parsing an output line
 */
export interface ParsedOutputResult {
  type: CliStreamEventType;
  fileChange?: FileChangeInfo;
  testResult?: TestResultInfo;
  error?: ErrorInfo;
}

/**
 * Parse an output line and determine its type with any enhanced information
 *
 * @param line - Raw output line
 * @returns ParsedOutputResult with type and optional enhanced info
 */
export function parseOutputLine(line: string): ParsedOutputResult {
  if (!line) {
    return { type: 'output' };
  }

  // Check for command execution
  if (COMMAND_PATTERN.test(line)) {
    return { type: 'command' };
  }

  // Check for file change
  const fileChange = parseFileChange(line);
  if (fileChange) {
    return {
      type: 'file_change',
      fileChange,
    };
  }

  // Check for test result
  const testResult = parseTestResult(line);
  if (testResult) {
    return {
      type: 'test_result',
      testResult,
    };
  }

  // Check for error
  const error = parseError(line);
  if (error) {
    return {
      type: 'error',
      error,
    };
  }

  // Default to regular output
  return { type: 'output' };
}
