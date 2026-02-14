/**
 * Output Parser Unit Tests
 * Story 8-2: Live CLI Output Streaming
 */

import {
  parseFileChange,
  parseTestResult,
  parseError,
  parseOutputLine,
} from '../utils/output-parser';
import { FileChangeInfo, TestResultInfo, ErrorInfo } from '../interfaces';

describe('OutputParser', () => {
  describe('parseFileChange()', () => {
    describe('file creation patterns', () => {
      it('should parse "Creating file.ts" pattern', () => {
        const result = parseFileChange('> Creating src/auth/login.ts');

        expect(result).not.toBeNull();
        expect(result?.fileName).toBe('login.ts');
        expect(result?.changeType).toBe('created');
        expect(result?.filePath).toBe('src/auth/login.ts');
      });

      it('should parse "Writing file.ts" pattern', () => {
        const result = parseFileChange('> Writing src/components/Button.tsx');

        expect(result).not.toBeNull();
        expect(result?.fileName).toBe('Button.tsx');
        expect(result?.changeType).toBe('created');
        expect(result?.filePath).toBe('src/components/Button.tsx');
      });

      it('should parse "Adding file.ts" pattern', () => {
        const result = parseFileChange('> Adding src/utils/helper.ts...');

        expect(result).not.toBeNull();
        expect(result?.fileName).toBe('helper.ts');
        expect(result?.changeType).toBe('created');
        expect(result?.filePath).toBe('src/utils/helper.ts');
      });

      it('should handle file paths with dots', () => {
        const result = parseFileChange('> Creating src/.eslintrc.json');

        expect(result).not.toBeNull();
        expect(result?.fileName).toBe('.eslintrc.json');
        expect(result?.filePath).toBe('src/.eslintrc.json');
      });
    });

    describe('file edit patterns', () => {
      it('should parse "Editing file.ts" pattern', () => {
        const result = parseFileChange('> Editing src/auth/login.ts');

        expect(result).not.toBeNull();
        expect(result?.fileName).toBe('login.ts');
        expect(result?.changeType).toBe('edited');
        expect(result?.filePath).toBe('src/auth/login.ts');
      });

      it('should parse "Modifying file.ts" pattern', () => {
        const result = parseFileChange('> Modifying src/api/routes.ts');

        expect(result).not.toBeNull();
        expect(result?.fileName).toBe('routes.ts');
        expect(result?.changeType).toBe('edited');
        expect(result?.filePath).toBe('src/api/routes.ts');
      });

      it('should parse "Updating file.ts" pattern', () => {
        const result = parseFileChange('> Updating package.json');

        expect(result).not.toBeNull();
        expect(result?.fileName).toBe('package.json');
        expect(result?.changeType).toBe('edited');
        expect(result?.filePath).toBe('package.json');
      });
    });

    describe('file deletion patterns', () => {
      it('should parse "Deleting file.ts" pattern', () => {
        const result = parseFileChange('> Deleting src/old/deprecated.ts');

        expect(result).not.toBeNull();
        expect(result?.fileName).toBe('deprecated.ts');
        expect(result?.changeType).toBe('deleted');
        expect(result?.filePath).toBe('src/old/deprecated.ts');
      });

      it('should parse "Removing file.ts" pattern', () => {
        const result = parseFileChange('> Removing temp/cache.json');

        expect(result).not.toBeNull();
        expect(result?.fileName).toBe('cache.json');
        expect(result?.changeType).toBe('deleted');
        expect(result?.filePath).toBe('temp/cache.json');
      });
    });

    describe('unrecognized patterns', () => {
      it('should return null for regular output', () => {
        const result = parseFileChange('Running tests...');
        expect(result).toBeNull();
      });

      it('should return null for empty string', () => {
        const result = parseFileChange('');
        expect(result).toBeNull();
      });

      it('should return null for directory operations', () => {
        const result = parseFileChange('> Creating src/components/');
        expect(result).toBeNull();
      });
    });
  });

  describe('parseTestResult()', () => {
    describe('Jest PASS/FAIL patterns', () => {
      it('should parse Jest PASS pattern', () => {
        const result = parseTestResult('PASS src/auth/__tests__/login.spec.ts');

        expect(result).not.toBeNull();
        expect(result?.testName).toBe('login.spec.ts');
        expect(result?.status).toBe('passed');
        expect(result?.filePath).toBe('src/auth/__tests__/login.spec.ts');
      });

      it('should parse Jest FAIL pattern', () => {
        const result = parseTestResult('FAIL src/api/__tests__/routes.spec.ts');

        expect(result).not.toBeNull();
        expect(result?.testName).toBe('routes.spec.ts');
        expect(result?.status).toBe('failed');
        expect(result?.filePath).toBe('src/api/__tests__/routes.spec.ts');
      });

      it('should parse Jest PASS with colors (ANSI)', () => {
        const result = parseTestResult('\x1b[32mPASS\x1b[39m src/auth/__tests__/login.spec.ts');

        expect(result).not.toBeNull();
        expect(result?.status).toBe('passed');
      });

      it('should parse Jest FAIL with colors (ANSI)', () => {
        const result = parseTestResult('\x1b[31mFAIL\x1b[39m src/auth/__tests__/login.spec.ts');

        expect(result).not.toBeNull();
        expect(result?.status).toBe('failed');
      });
    });

    describe('test summary patterns', () => {
      it('should parse "Tests: X passed, Y failed" pattern', () => {
        const result = parseTestResult('Tests:       12 passed, 2 failed, 14 total');

        expect(result).not.toBeNull();
        expect(result?.testName).toBe('Test Summary');
        expect(result?.summary).toBeDefined();
        expect(result?.summary?.passed).toBe(12);
        expect(result?.summary?.failed).toBe(2);
        expect(result?.summary?.total).toBe(14);
      });

      it('should parse "Tests: X passed" pattern (all passing)', () => {
        const result = parseTestResult('Tests:       15 passed, 15 total');

        expect(result).not.toBeNull();
        expect(result?.summary?.passed).toBe(15);
        expect(result?.summary?.failed).toBe(0);
        expect(result?.summary?.total).toBe(15);
      });

      it('should parse test summary with skipped tests', () => {
        const result = parseTestResult('Tests:       10 passed, 2 skipped, 1 failed, 13 total');

        expect(result).not.toBeNull();
        expect(result?.summary?.passed).toBe(10);
        expect(result?.summary?.skipped).toBe(2);
        expect(result?.summary?.failed).toBe(1);
        expect(result?.summary?.total).toBe(13);
      });
    });

    describe('individual test patterns', () => {
      it('should parse "ok" individual test result', () => {
        const result = parseTestResult('    ok 1 - should create user');

        expect(result).not.toBeNull();
        expect(result?.testName).toBe('should create user');
        expect(result?.status).toBe('passed');
      });

      it('should parse "not ok" individual test result', () => {
        const result = parseTestResult('    not ok 2 - should validate email');

        expect(result).not.toBeNull();
        expect(result?.testName).toBe('should validate email');
        expect(result?.status).toBe('failed');
      });

      it('should parse check mark pattern', () => {
        const result = parseTestResult('    ✓ should handle auth correctly (15ms)');

        expect(result).not.toBeNull();
        expect(result?.testName).toBe('should handle auth correctly');
        expect(result?.status).toBe('passed');
      });

      it('should parse cross mark pattern', () => {
        const result = parseTestResult('    ✕ should throw error for invalid input');

        expect(result).not.toBeNull();
        expect(result?.testName).toBe('should throw error for invalid input');
        expect(result?.status).toBe('failed');
      });
    });

    describe('unrecognized patterns', () => {
      it('should return null for regular output', () => {
        const result = parseTestResult('Building project...');
        expect(result).toBeNull();
      });

      it('should return null for empty string', () => {
        const result = parseTestResult('');
        expect(result).toBeNull();
      });
    });
  });

  describe('parseError()', () => {
    describe('common error types', () => {
      it('should parse SyntaxError', () => {
        const result = parseError('SyntaxError: Unexpected token }');

        expect(result).not.toBeNull();
        expect(result?.errorType).toBe('SyntaxError');
        expect(result?.message).toBe('Unexpected token }');
      });

      it('should parse TypeError', () => {
        const result = parseError('TypeError: undefined is not a function');

        expect(result).not.toBeNull();
        expect(result?.errorType).toBe('TypeError');
        expect(result?.message).toBe('undefined is not a function');
      });

      it('should parse ReferenceError', () => {
        const result = parseError('ReferenceError: foo is not defined');

        expect(result).not.toBeNull();
        expect(result?.errorType).toBe('ReferenceError');
        expect(result?.message).toBe('foo is not defined');
      });

      it('should parse generic Error', () => {
        const result = parseError('Error: Cannot find module \'lodash\'');

        expect(result).not.toBeNull();
        expect(result?.errorType).toBe('Error');
        expect(result?.message).toBe('Cannot find module \'lodash\'');
      });

      it('should parse RangeError', () => {
        const result = parseError('RangeError: Maximum call stack size exceeded');

        expect(result).not.toBeNull();
        expect(result?.errorType).toBe('RangeError');
        expect(result?.message).toBe('Maximum call stack size exceeded');
      });
    });

    describe('error patterns with stack traces', () => {
      it('should parse error at file location', () => {
        const result = parseError('Error: Connection refused at /app/src/db.ts:42:15');

        expect(result).not.toBeNull();
        expect(result?.errorType).toBe('Error');
        expect(result?.message).toContain('Connection refused');
      });

      it('should detect compilation errors', () => {
        const result = parseError('error TS2304: Cannot find name \'foo\'.');

        expect(result).not.toBeNull();
        expect(result?.errorType).toBe('TS2304');
        expect(result?.message).toBe('Cannot find name \'foo\'.');
      });

      it('should detect npm errors', () => {
        const result = parseError('npm ERR! code E404');

        expect(result).not.toBeNull();
        expect(result?.errorType).toBe('npm');
        expect(result?.message).toContain('E404');
      });
    });

    describe('error patterns with ANSI colors', () => {
      it('should parse error with ANSI color codes', () => {
        const result = parseError('\x1b[31mError: Something went wrong\x1b[39m');

        expect(result).not.toBeNull();
        expect(result?.errorType).toBe('Error');
        expect(result?.message).toBe('Something went wrong');
      });
    });

    describe('unrecognized patterns', () => {
      it('should return null for regular output', () => {
        const result = parseError('Compiling TypeScript...');
        expect(result).toBeNull();
      });

      it('should return null for empty string', () => {
        const result = parseError('');
        expect(result).toBeNull();
      });

      it('should return null for warning messages', () => {
        const result = parseError('Warning: Using deprecated API');
        expect(result).toBeNull();
      });
    });
  });

  describe('parseOutputLine()', () => {
    it('should detect file change and return enhanced event type', () => {
      const result = parseOutputLine('> Creating src/auth/login.ts');

      expect(result.type).toBe('file_change');
      expect(result.fileChange).toBeDefined();
      expect(result.fileChange?.changeType).toBe('created');
    });

    it('should detect test result and return enhanced event type', () => {
      const result = parseOutputLine('PASS src/auth/__tests__/login.spec.ts');

      expect(result.type).toBe('test_result');
      expect(result.testResult).toBeDefined();
      expect(result.testResult?.status).toBe('passed');
    });

    it('should detect error and return enhanced event type', () => {
      const result = parseOutputLine('TypeError: undefined is not a function');

      expect(result.type).toBe('error');
      expect(result.error).toBeDefined();
      expect(result.error?.errorType).toBe('TypeError');
    });

    it('should return output type for regular lines', () => {
      const result = parseOutputLine('Building project...');

      expect(result.type).toBe('output');
      expect(result.fileChange).toBeUndefined();
      expect(result.testResult).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('should handle command output lines', () => {
      const result = parseOutputLine('$ npm install');

      expect(result.type).toBe('command');
    });
  });
});
