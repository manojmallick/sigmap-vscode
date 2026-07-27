'use strict';

jest.mock('fs');
jest.mock('vscode');

const fs = require('fs');
const decs = require('../src/decorations.js');
const { parseContextPaths } = decs;

describe('parseContextPaths', () => {
  afterEach(() => jest.clearAllMocks());

  test('extracts paths from ### headings', () => {
    const content = `# SigMap Context

### src/foo.ts
### src/bar.js
### tests/unit.test.ts`;

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(content);

    const result = parseContextPaths('/workspace/.github/copilot-instructions.md');

    expect(result).toBeInstanceOf(Set);
    expect(result.has('src/foo.ts')).toBe(true);
    expect(result.has('src/bar.js')).toBe(true);
    expect(result.has('tests/unit.test.ts')).toBe(true);
  });

  test('returns empty Set when file does not exist', () => {
    fs.existsSync.mockReturnValue(false);

    const result = parseContextPaths('/nonexistent/.github/copilot-instructions.md');

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  test('trims whitespace from paths', () => {
    const content = `### src/foo.ts
###   src/bar.js
### src/baz.ts`;

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(content);

    const result = parseContextPaths('/workspace/.github/copilot-instructions.md');

    expect(result.has('src/foo.ts')).toBe(true);
    expect(result.has('src/bar.js')).toBe(true);
    expect(result.has('src/baz.ts')).toBe(true);
    expect(result.size).toBe(3);
  });

  test('ignores non-heading lines', () => {
    const content = `# SigMap Context

Some documentation text

### src/included.ts

More text that mentions src/not-included.ts`;

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(content);

    const result = parseContextPaths('/workspace/.github/copilot-instructions.md');

    expect(result.has('src/included.ts')).toBe(true);
    expect(result.has('src/not-included.ts')).toBe(false);
    expect(result.size).toBe(1);
  });

  test('handles complex paths with multiple directories', () => {
    const content = `### packages/core/src/index.ts
### test/fixtures/large-file.js
### docs/api/v1/endpoints.md`;

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(content);

    const result = parseContextPaths('/workspace/.github/copilot-instructions.md');

    expect(result.has('packages/core/src/index.ts')).toBe(true);
    expect(result.has('test/fixtures/large-file.js')).toBe(true);
    expect(result.has('docs/api/v1/endpoints.md')).toBe(true);
  });

  test('handles paths with special characters', () => {
    const content = `### src/my-component.tsx
### test/@types/index.d.ts
### config/next.config.js`;

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(content);

    const result = parseContextPaths('/workspace/.github/copilot-instructions.md');

    expect(result.has('src/my-component.tsx')).toBe(true);
    expect(result.has('test/@types/index.d.ts')).toBe(true);
    expect(result.has('config/next.config.js')).toBe(true);
  });

  test('module exports parseContextPaths', () => {
    expect(typeof parseContextPaths).toBe('function');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('applyDecorations', () => {
  let mockVscode;

  beforeEach(() => {
    mockVscode = require('vscode');
    jest.clearAllMocks();
  });

  test('applies GREEN decoration to included files', () => {
    const content = `### src/index.ts`;
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(content);

    const mockEditor = {
      document: {
        uri: { fsPath: '/workspace/src/index.ts' },
        lineAt: jest.fn((n) => ({ range: { start: {}, end: {} } })),
        lineCount: 10,
      },
      setDecorations: jest.fn(),
    };
    mockVscode.window.visibleTextEditors = [mockEditor];

    const { applyDecorations, GREEN, GREY } = decs;
    applyDecorations('/workspace');

    expect(mockEditor.setDecorations).toHaveBeenCalledWith(GREEN, expect.any(Array));
    expect(mockEditor.setDecorations).toHaveBeenCalledWith(GREY, []);
  });

  test('applies GREY decoration to excluded files', () => {
    const content = `### src/included.ts`;
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(content);

    const mockEditor = {
      document: {
        uri: { fsPath: '/workspace/src/excluded.ts' },
        lineAt: jest.fn((n) => ({ range: { start: {}, end: {} } })),
        lineCount: 10,
      },
      setDecorations: jest.fn(),
    };
    mockVscode.window.visibleTextEditors = [mockEditor];

    const { applyDecorations, GREEN, GREY } = decs;
    applyDecorations('/workspace');

    expect(mockEditor.setDecorations).toHaveBeenCalledWith(GREEN, []);
    expect(mockEditor.setDecorations).toHaveBeenCalledWith(GREY, expect.any(Array));
  });

  test('normalizes Windows backslash paths before comparison (regression test)', () => {
    const content = `### src/index.ts`;
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(content);

    // Simulate Windows path with backslashes
    const mockEditor = {
      document: {
        uri: { fsPath: 'C:\\workspace\\src\\index.ts' },
        lineAt: jest.fn((n) => ({ range: { start: {}, end: {} } })),
        lineCount: 10,
      },
      setDecorations: jest.fn(),
    };
    mockVscode.window.visibleTextEditors = [mockEditor];

    // Mock path.relative to return Windows-style path
    const pathModule = require('path');
    const originalRelative = pathModule.relative;
    pathModule.relative = jest.fn(() => 'src\\index.ts');

    const { applyDecorations, GREEN } = decs;
    applyDecorations('C:\\workspace');

    // Should recognize src\index.ts as matching src/index.ts
    expect(mockEditor.setDecorations).toHaveBeenCalledWith(GREEN, expect.any(Array));

    // Restore original
    pathModule.relative = originalRelative;
  });

  test('handles empty visibleTextEditors list', () => {
    const content = `### src/index.ts`;
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(content);

    mockVscode.window.visibleTextEditors = [];

    const { applyDecorations } = decs;
    expect(() => applyDecorations('/workspace')).not.toThrow();
  });

  test('requires exact relative-path match (no suffix false positives)', () => {
    // "index.ts" in the map must NOT light up src/index.ts — suffix matching
    // marked every same-named file as included in multi-package repos.
    const content = `### index.ts\n### src/included.ts`;
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(content);

    const makeEditor = (fsPath) => ({
      document: {
        uri: { fsPath },
        lineAt: jest.fn((n) => ({ range: { start: {}, end: {} } })),
        lineCount: 10,
      },
      setDecorations: jest.fn(),
    });
    const nested = makeEditor('/workspace/src/index.ts');   // suffix-only match → excluded
    const exact  = makeEditor('/workspace/src/included.ts'); // exact match → included
    mockVscode.window.visibleTextEditors = [nested, exact];

    const { applyDecorations, GREEN, GREY } = decs;
    applyDecorations('/workspace');

    expect(nested.setDecorations).toHaveBeenCalledWith(GREEN, []);
    expect(nested.setDecorations).toHaveBeenCalledWith(GREY, expect.arrayContaining([expect.anything()]));
    expect(exact.setDecorations).toHaveBeenCalledWith(GREEN, expect.arrayContaining([expect.anything()]));
    expect(exact.setDecorations).toHaveBeenCalledWith(GREY, []);
  });

  test('module exports applyDecorations and scheduleUpdate', () => {
    expect(typeof decs.applyDecorations).toBe('function');
    expect(typeof decs.scheduleUpdate).toBe('function');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('scheduleUpdate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('debounces calls to applyDecorations', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('### src/index.ts');

    const mockVscode = require('vscode');
    mockVscode.window.visibleTextEditors = [];

    const { scheduleUpdate } = decs;

    // Call scheduleUpdate multiple times
    scheduleUpdate('/workspace');
    scheduleUpdate('/workspace');
    scheduleUpdate('/workspace');

    // No execution yet
    expect(fs.readFileSync).not.toHaveBeenCalled();

    // Fast-forward 2000ms
    jest.advanceTimersByTime(2000);

    // applyDecorations should have been called only once (debounced)
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
  });

  test('fires applyDecorations after 2000ms', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('### src/index.ts');

    const mockVscode = require('vscode');
    mockVscode.window.visibleTextEditors = [];

    const { scheduleUpdate } = decs;
    scheduleUpdate('/workspace');

    // Before 2000ms
    expect(fs.readFileSync).not.toHaveBeenCalled();

    // At 2000ms
    jest.advanceTimersByTime(2000);
    expect(fs.readFileSync).toHaveBeenCalled();
  });
});
