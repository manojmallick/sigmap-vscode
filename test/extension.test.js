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
    showErrorMessage: jest.fn(),
    showInputBox: jest.fn(),
    showQuickPick: jest.fn(),
    showTextDocument: jest.fn(),
    createTerminal: jest.fn(() => ({
      show: jest.fn(),
      sendText: jest.fn(),
    })),
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    })),
    withProgress: jest.fn((_opts, task) =>
      task({ report: jest.fn() }, { isCancellationRequested: false, onCancellationRequested: jest.fn() })),
  },
  ProgressLocation: { Notification: 15 },
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
  resolveRunner, ensureRunner, formatAge, gradeFromAge, buildQueryArgs, parseQueryResults,
  getStatus, mtimeFallback, updateStatusBar, runRegenerate, runQuery,
  checkStaleContext, suppressionKey, _resetInternalState,
} = ext;

// Shared handle to the mocked vscode module.
const vscode = require('vscode');

/** Reset the vscode UI mocks to a clean slate between behavioral tests. */
function resetVscodeMocks() {
  vscode.window.showWarningMessage.mockReset();
  vscode.window.showInformationMessage.mockReset();
  vscode.window.showErrorMessage.mockReset();
  vscode.window.showInputBox.mockReset();
  vscode.window.showQuickPick.mockReset();
  vscode.window.showTextDocument.mockReset();
  vscode.window.createTerminal.mockClear();
  vscode.window.withProgress.mockClear(); // clear calls, keep the pass-through impl
}

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
describe('buildQueryArgs', () => {
  test('builds node-invoked args for a script runner', () => {
    const [cmd, args] = buildQueryArgs({ type: 'script', path: '/ws/gen-context.js' }, 'auth flow', 10);
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual(['/ws/gen-context.js', '--query', 'auth flow', '--json', '--top', '10']);
  });

  test('builds direct binary args for a command runner', () => {
    const [cmd, args] = buildQueryArgs({ type: 'command', path: '/usr/local/bin/sigmap' }, 'status bar', 5);
    expect(cmd).toBe('/usr/local/bin/sigmap');
    expect(args).toEqual(['--query', 'status bar', '--json', '--top', '5']);
  });

  test('coerces a numeric top to a string', () => {
    const [, args] = buildQueryArgs({ type: 'command', path: 'sigmap' }, 'x', 3);
    expect(args[args.length - 1]).toBe('3');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('parseQueryResults', () => {
  test('parses ranked results from valid --query --json output', () => {
    const stdout = JSON.stringify({
      query: 'auth',
      results: [
        { rank: 1, file: 'src/auth.js', score: 3, sigs: ['function login()'], tokens: 42 },
        { rank: 2, file: 'src/token.js', score: 1, sigs: [], tokens: 10 },
      ],
    });
    const out = parseQueryResults(stdout);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ rank: 1, file: 'src/auth.js', score: 3, sigs: ['function login()'], tokens: 42 });
    expect(out[1].sigs).toEqual([]);
  });

  test('tolerates surrounding whitespace', () => {
    const out = parseQueryResults('\n  {"results":[{"rank":1,"file":"a.js","score":0}]}  \n');
    expect(out).toHaveLength(1);
    expect(out[0].file).toBe('a.js');
    expect(out[0].sigs).toEqual([]); // missing sigs defaults to []
    expect(out[0].tokens).toBe(0);   // missing tokens defaults to 0
  });

  test('returns [] for empty, malformed, or resultless output', () => {
    expect(parseQueryResults('')).toEqual([]);
    expect(parseQueryResults('not json')).toEqual([]);
    expect(parseQueryResults('{}')).toEqual([]);
    expect(parseQueryResults('{"results":"nope"}')).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('runQuery', () => {
  const runner = { type: 'command', path: '/usr/local/bin/sigmap' };

  beforeEach(() => {
    jest.clearAllMocks();
    resetVscodeMocks();
    setPlatform('darwin');
    fs.existsSync.mockReturnValue(true); // binary + query both "exist"
  });

  test('warns and exits when there is no workspace root', async () => {
    await runQuery(null, runner);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('no workspace folder'));
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
  });

  test('warns and exits when no runner is resolved', async () => {
    await runQuery('/workspace', null);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('command not found'));
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
  });

  test('does nothing when the query input is empty or cancelled', async () => {
    vscode.window.showInputBox.mockResolvedValue('   ');
    await runQuery('/workspace', runner);
    expect(execFile).not.toHaveBeenCalled();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  test('shows an info message when the query returns no results', async () => {
    vscode.window.showInputBox.mockResolvedValue('auth');
    execFile.mockImplementation((cmd, args, opts, cb) => cb(null, JSON.stringify({ results: [] })));
    await runQuery('/workspace', runner);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('no results'));
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  test('treats an execFile error as no results', async () => {
    vscode.window.showInputBox.mockResolvedValue('auth');
    execFile.mockImplementation((cmd, args, opts, cb) => cb(new Error('boom'), ''));
    await runQuery('/workspace', runner);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('no results'));
  });

  test('opens the selected file from the ranked QuickPick', async () => {
    vscode.window.showInputBox.mockResolvedValue('auth');
    execFile.mockImplementation((cmd, args, opts, cb) => cb(null, JSON.stringify({
      results: [{ rank: 1, file: 'src/auth.js', score: 3, sigs: ['function login()'], tokens: 42 }],
    })));
    vscode.window.showQuickPick.mockResolvedValue({ label: 'src/auth.js', file: 'src/auth.js' });

    await runQuery('/workspace', runner);

    const items = vscode.window.showQuickPick.mock.calls[0][0];
    expect(items[0]).toMatchObject({ label: 'src/auth.js', file: 'src/auth.js' });
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(path.join('/workspace', 'src/auth.js'));
  });

  test('does not open a file when the QuickPick is dismissed', async () => {
    vscode.window.showInputBox.mockResolvedValue('auth');
    execFile.mockImplementation((cmd, args, opts, cb) => cb(null, JSON.stringify({
      results: [{ rank: 1, file: 'src/auth.js', score: 3, sigs: [], tokens: 42 }],
    })));
    vscode.window.showQuickPick.mockResolvedValue(undefined);

    await runQuery('/workspace', runner);
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('getStatus / mtimeFallback', () => {
  const runner = { type: 'command', path: '/bin/sigmap' };

  beforeEach(() => {
    jest.clearAllMocks();
    _resetInternalState();
    setPlatform('darwin');
  });

  test('resolves null when there is no root', async () => {
    await expect(getStatus(null, runner)).resolves.toBeNull();
  });

  test('parses --health --json output into a status object', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ mtimeMs: 1000 });
    execFile.mockImplementation((cmd, args, opts, cb) =>
      cb(null, JSON.stringify({ grade: 'B', score: 80, tokens: 1200, reduction: 90 })));

    const status = await getStatus('/workspace', runner);
    expect(status).toMatchObject({ grade: 'B', score: 80, tokens: 1200, reduction: 90 });
    expect(typeof status.daysSince).toBe('number');
  });

  test('falls back to mtime when --health fails', async () => {
    // command exists, but execFile errors → mtimeFallback; no context file → null
    fs.existsSync.mockImplementation(p => p === '/bin/sigmap');
    execFile.mockImplementation((cmd, args, opts, cb) => cb(new Error('nope'), ''));
    const status = await getStatus('/workspace', runner);
    expect(status).toBeNull();
  });

  test('mtimeFallback grades honestly from file age (ancient file → D, no fabricated score)', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ mtimeMs: 1000 }); // 1970 → decades old
    return new Promise((resolve) => {
      mtimeFallback('/workspace', (status) => {
        expect(status).toMatchObject({ grade: 'D', score: null });
        resolve();
      });
    });
  });

  test('mtimeFallback grades a fresh file A', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ mtimeMs: Date.now() - 10 * 60 * 1000 }); // 10 min old
    return new Promise((resolve) => {
      mtimeFallback('/workspace', (status) => {
        expect(status).toMatchObject({ grade: 'A' });
        resolve();
      });
    });
  });

  test('throttles CLI probes: unchanged mtime is served from cache, mtime change re-probes', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ mtimeMs: 5000 });
    execFile.mockClear();
    execFile.mockImplementation((cmd, args, opts, cb) =>
      cb(null, JSON.stringify({ grade: 'B', score: 80, tokens: 100, reduction: 90 })));

    const first = await getStatus('/workspace', runner);
    expect(first.grade).toBe('B');
    expect(execFile).toHaveBeenCalledTimes(1);

    const second = await getStatus('/workspace', runner);
    expect(second.grade).toBe('B'); // same data…
    expect(execFile).toHaveBeenCalledTimes(1); // …without a second spawn

    fs.statSync.mockReturnValue({ mtimeMs: 6000 }); // context regenerated
    await getStatus('/workspace', runner);
    expect(execFile).toHaveBeenCalledTimes(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('gradeFromAge', () => {
  test('maps age in hours onto the A–D scale', () => {
    expect(gradeFromAge(0.5)).toBe('A');
    expect(gradeFromAge(3)).toBe('B');
    expect(gradeFromAge(12)).toBe('C');
    expect(gradeFromAge(48)).toBe('D');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('runner cache / ensureRunner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetInternalState();
    setPlatform('darwin');
    os.homedir.mockReturnValue('/home/user');
    vscode.workspace.getConfiguration.mockReturnValue({ get: jest.fn((k, d) => d) });
  });

  test('caches a resolved global command and revalidates with a single existsSync', () => {
    fs.existsSync.mockImplementation(p => p === '/usr/local/bin/sigmap');
    fs.accessSync.mockImplementation(p => {
      if (p !== '/usr/local/bin/sigmap') throw new Error('not executable');
    });

    const first = resolveRunner('/workspace');
    expect(first).toEqual({ type: 'command', path: '/usr/local/bin/sigmap' });

    // Full probing would now fail — but the cached path still exists, so it is reused.
    fs.accessSync.mockImplementation(() => { throw new Error('not executable'); });
    expect(resolveRunner('/workspace')).toEqual(first);

    // Cached binary disappears → cache dropped, resolution honestly returns null.
    fs.existsSync.mockReturnValue(false);
    expect(resolveRunner('/workspace')).toBeNull();
  });

  test('ensureRunner runs the shell probe at most once per session', async () => {
    fs.existsSync.mockReturnValue(false);
    fs.accessSync.mockImplementation(() => { throw new Error('no'); });
    execFile.mockClear();
    execFile.mockImplementation((cmd, args, opts, cb) => cb(new Error('not found'), ''));

    expect(await ensureRunner('/workspace')).toBeNull();
    const probeCalls = execFile.mock.calls.length;
    expect(probeCalls).toBeGreaterThan(0); // shells were consulted…

    expect(await ensureRunner('/workspace')).toBeNull();
    expect(execFile.mock.calls.length).toBe(probeCalls); // …but never again
  });

  test('ensureRunner adopts a shell-resolved path', async () => {
    fs.accessSync.mockImplementation(() => { throw new Error('no'); });
    fs.existsSync.mockImplementation(p => p === '/opt/somewhere/sigmap');
    execFile.mockImplementation((cmd, args, opts, cb) => cb(null, '/opt/somewhere/sigmap\n'));

    expect(await ensureRunner('/workspace')).toEqual({ type: 'command', path: '/opt/somewhere/sigmap' });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('runRegenerate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetVscodeMocks();
    setPlatform('darwin');
  });

  test('warns when there is no root', async () => {
    await runRegenerate(null, { type: 'command', path: '/bin/sigmap' });
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('no workspace folder'));
  });

  test('offers install help when no runner is found', async () => {
    vscode.window.showWarningMessage.mockResolvedValue('Copy install command');
    await runRegenerate('/workspace', null);
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('npm install -g sigmap');
  });

  test('runs the CLI under withProgress and notifies on success', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => { cb(null, 'ok', ''); return { kill: jest.fn() }; });
    await runRegenerate('/workspace', { type: 'command', path: '/bin/sigmap' });
    expect(vscode.window.withProgress).toHaveBeenCalled();
    expect(execFile).toHaveBeenCalledWith(
      '/bin/sigmap', [], expect.objectContaining({ cwd: '/workspace' }), expect.any(Function));
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('SigMap: context regenerated.');
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  test('surfaces a failure instead of staying silent', async () => {
    vscode.window.showErrorMessage.mockResolvedValue(undefined);
    execFile.mockImplementation((cmd, args, opts, cb) => { cb(new Error('exit 1'), '', 'boom'); return { kill: jest.fn() }; });
    await runRegenerate('/workspace', { type: 'command', path: '/bin/sigmap' });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('failed'), 'Show Output');
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  test('runs script runners through node', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => { cb(null, '', ''); return { kill: jest.fn() }; });
    await runRegenerate('/workspace', { type: 'script', path: '/ws/gen-context.js' });
    expect(execFile).toHaveBeenCalledWith(
      process.execPath, ['/ws/gen-context.js'], expect.any(Object), expect.any(Function));
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('updateStatusBar', () => {
  let statusBar;
  beforeEach(() => {
    jest.clearAllMocks();
    setPlatform('darwin');
    os.homedir.mockReturnValue('/home/user');
    statusBar = { text: '', tooltip: '', show: jest.fn() };
    vscode.workspace.getConfiguration.mockReturnValue({ get: jest.fn((k, d) => d) });
  });

  test('shows a generic label when no folder is open', async () => {
    vscode.workspace.workspaceFolders = undefined;
    await updateStatusBar(statusBar);
    expect(statusBar.text).toContain('SigMap');
    expect(statusBar.show).toHaveBeenCalled();
  });

  test('shows "no context" when nothing resolves', async () => {
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/workspace' } }];
    fs.existsSync.mockReturnValue(false); // no runner, no context file
    await updateStatusBar(statusBar);
    expect(statusBar.text).toContain('no context');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('checkStaleContext / suppressionKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetVscodeMocks();
    setPlatform('darwin');
  });

  test('suppressionKey is deterministic and namespaced', () => {
    const k = suppressionKey('/workspace');
    expect(k).toMatch(/^cf\.stale\.suppress\./);
    expect(suppressionKey('/workspace')).toBe(k);
  });

  test('does nothing when the context file is missing', async () => {
    fs.existsSync.mockReturnValue(false);
    await checkStaleContext({ workspaceState: { get: jest.fn(), update: jest.fn() } }, '/workspace', null);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  test('prompts and records suppression on "Don\'t show again"', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ mtimeMs: 1000 }); // very old → stale
    vscode.window.showInformationMessage.mockResolvedValue("Don't show again");
    const update = jest.fn();
    await checkStaleContext({ workspaceState: { get: jest.fn(() => false), update } }, '/workspace', null);
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.any(String), true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('integration tests', () => {
  test('deactivate runs without error', () => {
    expect(ext.deactivate()).toBeUndefined();
  });

  test('module exports required functions', () => {
    expect(typeof ext.activate).toBe('function');
    expect(typeof ext.deactivate).toBe('function');
    expect(typeof ext.executableCandidates).toBe('function');
    expect(typeof ext.firstExecutable).toBe('function');
    expect(typeof ext.resolveGlobalCommand).toBe('function');
    expect(typeof ext.resolveScript).toBe('function');
    expect(typeof ext.resolveRunner).toBe('function');
    expect(typeof ext.formatAge).toBe('function');
    expect(typeof ext.buildQueryArgs).toBe('function');
    expect(typeof ext.parseQueryResults).toBe('function');
  });

  test('registers sigmap.queryContext during activation', async () => {
    setPlatform('darwin');
    _resetInternalState();
    // Stateful mock impls leak from earlier tests — pin the ones activate() touches.
    fs.existsSync.mockReturnValue(false); // no runner found → no health spawn
    os.homedir.mockReturnValue('/home/user');
    execFileSync.mockImplementation(() => { throw new Error('not found'); });
    // ensureRunner's once-per-session shell probe must resolve deterministically.
    execFile.mockImplementation((cmd, args, opts, cb) => cb(new Error('not found'), ''));

    // Augment the minimal vscode mock with the APIs activate() + decorations use.
    const mockVscode = require('vscode');
    mockVscode.window.createStatusBarItem.mockReturnValue({ text: '', tooltip: '', command: '', show: jest.fn() });
    mockVscode.window.createTextEditorDecorationType = jest.fn(() => ({ dispose: jest.fn() }));
    mockVscode.window.onDidChangeActiveTextEditor = jest.fn(() => ({ dispose: jest.fn() }));
    mockVscode.window.visibleTextEditors = [];
    mockVscode.workspace.createFileSystemWatcher = jest.fn(() => ({
      onDidChange: jest.fn(), onDidCreate: jest.fn(), dispose: jest.fn(),
    }));
    mockVscode.workspace.getConfiguration.mockReturnValue({ get: jest.fn((key, def) => def) });
    mockVscode.StatusBarAlignment = { Left: 0, Right: 1 };
    mockVscode.OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 };
    mockVscode.Range = jest.fn((a, b) => ({ start: a, end: b }));
    mockVscode.Uri.parse = jest.fn(s => s);
    mockVscode.commands.registerCommand.mockClear();

    jest.useFakeTimers(); // keep the refresh interval + stale-check timer from firing after teardown
    try {
      await ext.activate({ subscriptions: [] });
      const calls = mockVscode.commands.registerCommand.mock.calls;
      const registered = calls.map(c => c[0]);
      expect(registered).toContain('sigmap.queryContext');

      // Invoke each registered command callback to cover their bodies.
      const handlers = Object.fromEntries(calls.map(c => [c[0], c[1]]));
      mockVscode.window.showInputBox.mockResolvedValue(''); // queryContext → empty input → returns
      await handlers['sigmap.queryContext']();
      await handlers['sigmap.regenerate']();   // no runner → warning branch
      await handlers['sigmap.openContext']();  // fs.existsSync(ctx) false → warning branch
      expect(mockVscode.window.showWarningMessage).toHaveBeenCalled();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  test('openContext opens the context file when it exists', async () => {
    resetVscodeMocks();
    _resetInternalState();
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/workspace' } }];
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ mtimeMs: Date.now() });
    execFile.mockImplementation((cmd, args, opts, cb) => cb(new Error('no health'), ''));
    fs.readFileSync.mockReturnValue('### src/a.js\n'); // decorations reads the context file during activate
    vscode.commands.registerCommand.mockClear();
    jest.useFakeTimers();
    try {
      os.homedir.mockReturnValue('/home/user');
      await ext.activate({ subscriptions: [] });
      const handlers = Object.fromEntries(
        vscode.commands.registerCommand.mock.calls.map(c => [c[0], c[1]])
      );
      await handlers['sigmap.openContext']();
      expect(vscode.window.showTextDocument).toHaveBeenCalled();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
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
