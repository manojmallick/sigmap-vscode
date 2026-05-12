'use strict';

// Mock the dependencies before requiring the module
jest.mock('fs');
jest.mock('os');
jest.mock('child_process');

const fs = require('fs');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const path = require('path');

// Mock vscode module
jest.mock('vscode', () => ({
  window: {
    createStatusBarItem: jest.fn(() => ({
      text: '',
      tooltip: '',
      command: '',
      show: jest.fn(),
      hide: jest.fn(),
    })),
    showWarningMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    createTerminal: jest.fn(() => ({
      show: jest.fn(),
      sendText: jest.fn(),
    })),
  },
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn((key, defaultValue) => defaultValue),
    })),
    workspaceFolders: [
      { uri: { fsPath: '/workspace' } },
    ],
  },
  commands: {
    executeCommand: jest.fn(),
    registerCommand: jest.fn((cmd, fn) => ({ dispose: jest.fn() })),
  },
  Uri: {
    parse: jest.fn(str => str),
    file: jest.fn(p => p),
  },
  env: {
    clipboard: {
      writeText: jest.fn(),
    },
    shell: undefined,
  },
}));

// Import the functions we're testing (after mocks are set up)
const ext = require('../src/extension.js');
const {
  executableCandidates, firstExecutable, resolveGlobalCommand, resolveScript,
  resolveRunner, formatAge,
} = ext;

// Helper to set process.platform
function setPlatform(platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

// ────────────────────────────────────────────────────────────────────────────
describe('executableCandidates', () => {
  afterEach(() => {
    jest.clearAllMocks();
    setPlatform('darwin');
  });

  test('returns 4 candidates on Windows', () => {
    setPlatform('win32');
    const result = executableCandidates('/Users/test/npm', 'sigmap');
    expect(result.length).toBe(4);
    expect(result[0]).toMatch(/sigmap\.cmd$/);
    expect(result[1]).toMatch(/sigmap\.exe$/);
    expect(result[2]).toMatch(/sigmap\.bat$/);
    expect(result[3]).toMatch(/sigmap$/);
  });

  test('returns 1 candidate on Unix', () => {
    setPlatform('linux');
    const result = executableCandidates('/usr/local/bin', 'sigmap');
    expect(result.length).toBe(1);
    expect(result[0]).toMatch(/sigmap$/);
  });

  test('returns empty array when baseDir is falsy', () => {
    expect(executableCandidates(null, 'sigmap')).toEqual([]);
    expect(executableCandidates('', 'sigmap')).toEqual([]);
    expect(executableCandidates(undefined, 'sigmap')).toEqual([]);
  });

  test('generates candidates for both sigmap and gen-context names', () => {
    setPlatform('win32');
    const result = executableCandidates('/bin', 'gen-context');
    expect(result.length).toBe(4);
    expect(result[0]).toMatch(/gen-context\.cmd$/);
    expect(result[1]).toMatch(/gen-context\.exe$/);
    expect(result[2]).toMatch(/gen-context\.bat$/);
    expect(result[3]).toMatch(/gen-context$/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('firstExecutable', () => {
  afterEach(() => {
    jest.clearAllMocks();
    setPlatform('darwin');
  });

  test('returns first existing path on Windows', () => {
    setPlatform('win32');
    fs.existsSync.mockImplementation(p => p === '/path/to/second/sigmap.cmd');

    const result = firstExecutable([
      '/path/to/first/sigmap.cmd',
      '/path/to/second/sigmap.cmd',
      '/path/to/third/sigmap.cmd',
    ]);

    expect(result).toBe('/path/to/second/sigmap.cmd');
  });

  test('returns first executable path on Unix', () => {
    setPlatform('linux');
    fs.accessSync.mockImplementation(p => {
      if (p === '/path/to/second/sigmap') return;
      throw new Error('Not executable');
    });

    const result = firstExecutable([
      '/path/to/first/sigmap',
      '/path/to/second/sigmap',
    ]);

    expect(result).toBe('/path/to/second/sigmap');
  });

  test('returns null when nothing is found', () => {
    setPlatform('win32');
    fs.existsSync.mockReturnValue(false);

    const result = firstExecutable(['/path/one', '/path/two', '/path/three']);
    expect(result).toBeNull();
  });

  test('skips falsy entries', () => {
    setPlatform('win32');
    fs.existsSync.mockImplementation(p => p === '/path/three');

    const result = firstExecutable([null, undefined, '', '/path/three']);
    expect(result).toBe('/path/three');
  });

  test('returns null for empty array', () => {
    const result = firstExecutable([]);
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('formatAge', () => {
  test('formats < 1/24 day as "just now"', () => {
    expect(formatAge(0)).toBe('just now');
    expect(formatAge(0.01)).toBe('just now');
    expect(formatAge(1 / 48)).toBe('just now'); // 30 minutes
  });

  test('formats < 1 day as hours', () => {
    expect(formatAge(0.5)).toBe('12h ago'); // 12 hours
    expect(formatAge(0.25)).toBe('6h ago');  // 6 hours
    expect(formatAge(1 / 24)).toBe('1h ago'); // 1 hour
  });

  test('formats >= 1 day as days', () => {
    expect(formatAge(1)).toBe('1d ago');
    expect(formatAge(1.5)).toBe('1d ago');
    expect(formatAge(7)).toBe('7d ago');
    expect(formatAge(30)).toBe('30d ago');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('resolveScript', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns custom script path when sigmap.scriptPath is set and file exists', () => {
    const mockVscode = require('vscode');
    mockVscode.workspace.getConfiguration.mockReturnValue({
      get: jest.fn((key, defaultValue) => {
        if (key === 'scriptPath') return '/custom/gen-context.js';
        return defaultValue;
      }),
    });
    fs.existsSync.mockImplementation(p => p === '/custom/gen-context.js');

    const result = resolveScript('/workspace');
    expect(result).toBe('/custom/gen-context.js');
  });

  test('returns null when custom path is set but file does not exist', () => {
    const mockVscode = require('vscode');
    mockVscode.workspace.getConfiguration.mockReturnValue({
      get: jest.fn((key, defaultValue) => {
        if (key === 'scriptPath') return '/nonexistent/gen-context.js';
        return defaultValue;
      }),
    });
    fs.existsSync.mockReturnValue(false);

    const result = resolveScript('/workspace');
    expect(result).toBeNull();
  });

  test('returns workspace gen-context.js when custom path not set but file exists', () => {
    const mockVscode = require('vscode');
    mockVscode.workspace.getConfiguration.mockReturnValue({
      get: jest.fn(() => ''), // empty custom path
    });
    fs.existsSync.mockImplementation(p => p === '/workspace/gen-context.js');

    const result = resolveScript('/workspace');
    expect(result).toBe('/workspace/gen-context.js');
  });

  test('returns null when neither custom nor workspace path exists', () => {
    const mockVscode = require('vscode');
    mockVscode.workspace.getConfiguration.mockReturnValue({
      get: jest.fn(() => ''),
    });
    fs.existsSync.mockReturnValue(false);

    const result = resolveScript('/workspace');
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('resolveRunner', () => {
  test('exports resolveRunner function', () => {
    expect(typeof resolveRunner).toBe('function');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('resolveGlobalCommand', () => {
  afterEach(() => {
    jest.clearAllMocks();
    setPlatform('darwin');
  });

  test('returns a path or null when searching global paths', () => {
    os.homedir.mockReturnValue('/home/user');
    fs.existsSync.mockReturnValue(false);
    execFileSync.mockImplementation(() => { throw new Error('Not found'); });

    const result = resolveGlobalCommand('/workspace');
    expect(result === null || typeof result === 'string').toBe(true);
  });

  test('handles Windows home directory correctly', () => {
    setPlatform('win32');
    os.homedir.mockReturnValue('C:\\Users\\test');

    // Function should not throw
    expect(() => resolveGlobalCommand('/workspace')).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('integration tests', () => {
  test('module exports required functions', () => {
    expect(typeof ext.activate).toBe('function');
    expect(typeof ext.deactivate).toBe('function');
    expect(typeof ext.executableCandidates).toBe('function');
    expect(typeof ext.firstExecutable).toBe('function');
    expect(typeof ext.resolveGlobalCommand).toBe('function');
    expect(typeof ext.resolveScript).toBe('function');
    expect(typeof ext.resolveRunner).toBe('function');
    expect(typeof ext.formatAge).toBe('function');
  });

  test('formatAge + resolveRunner work correctly on Windows paths', () => {
    setPlatform('win32');
    // Windows-specific path normalization in resolveScript
    const mockVscode = require('vscode');
    mockVscode.workspace.getConfiguration.mockReturnValue({
      get: jest.fn(() => 'C:\\Program Files\\sigmap\\gen-context.js'),
    });
    fs.existsSync.mockReturnValue(true);

    const runner = resolveRunner('C:\\Users\\workspace');
    expect(runner).toEqual({ type: 'script', path: 'C:\\Program Files\\sigmap\\gen-context.js' });
  });
});
