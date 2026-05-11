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
