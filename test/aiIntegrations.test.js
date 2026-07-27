'use strict';

// Mutable vscode mock: individual tests add/remove lm APIs to exercise
// feature detection.
jest.mock('vscode', () => {
  class LanguageModelTextPart {
    constructor(value) { this.value = value; }
  }
  class LanguageModelToolResult {
    constructor(content) { this.content = content; }
  }
  class McpStdioServerDefinition {
    constructor(label, command, args) { this.label = label; this.command = command; this.args = args; }
  }
  return {
    lm: {
      registerTool: jest.fn(() => ({ dispose: jest.fn() })),
      registerMcpServerDefinitionProvider: jest.fn(() => ({ dispose: jest.fn() })),
    },
    LanguageModelTextPart,
    LanguageModelToolResult,
    McpStdioServerDefinition,
  };
});

const vscode = require('vscode');
const ai = require('../src/aiIntegrations.js');
const {
  registerAiIntegrations, runToolQuery, formatToolResult, buildMcpDefinition,
  TOOL_NAME, MCP_PROVIDER_ID,
} = ai;

function makeDeps(overrides = {}) {
  return {
    workspaceRoot: jest.fn(() => '/workspace'),
    ensureRunner: jest.fn(async () => ({ type: 'command', path: '/bin/sigmap' })),
    runQueryJson: jest.fn(async () => [
      { rank: 1, file: 'src/auth.js', score: 3, sigs: ['function login()', 'function logout()'], tokens: 42 },
    ]),
    log: jest.fn(),
    ...overrides,
  };
}

function makeContext() {
  return { subscriptions: [] };
}

afterEach(() => jest.clearAllMocks());

// ────────────────────────────────────────────────────────────────────────────
describe('formatToolResult', () => {
  test('renders ranked files with signature previews', () => {
    const text = formatToolResult('auth', [
      { rank: 1, file: 'src/auth.js', score: 3, sigs: ['function login()'] },
      { rank: 2, file: 'src/token.js', score: 1, sigs: [] },
    ]);
    expect(text).toContain('Top 2 files for "auth"');
    expect(text).toContain('1. src/auth.js (score 3)');
    expect(text).toContain('   function login()');
    expect(text).toContain('2. src/token.js (score 1)');
  });

  test('caps signatures per file at 5', () => {
    const sigs = ['a()', 'b()', 'c()', 'd()', 'e()', 'f()', 'g()'];
    const text = formatToolResult('x', [{ rank: 1, file: 'f.js', score: 1, sigs }]);
    expect(text).toContain('   e()');
    expect(text).not.toContain('   f()');
  });

  test('explains an empty result instead of returning nothing', () => {
    const text = formatToolResult('nothing', []);
    expect(text).toContain('No SigMap matches');
    expect(text).toContain('Regenerate Context');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('buildMcpDefinition', () => {
  test('script runners go through node with --mcp', () => {
    const def = buildMcpDefinition({ type: 'script', path: '/ws/gen-context.js' });
    expect(def).toEqual({ label: 'SigMap', command: process.execPath, args: ['/ws/gen-context.js', '--mcp'] });
  });

  test('command runners run the binary with --mcp', () => {
    const def = buildMcpDefinition({ type: 'command', path: '/usr/local/bin/sigmap' });
    expect(def).toEqual({ label: 'SigMap', command: '/usr/local/bin/sigmap', args: ['--mcp'] });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('runToolQuery', () => {
  test('returns ranked text for a valid query', async () => {
    const deps = makeDeps();
    const text = await runToolQuery(deps, 'auth flow', 10);
    expect(deps.runQueryJson).toHaveBeenCalledWith('/workspace', expect.any(Object), 'auth flow', 10);
    expect(text).toContain('src/auth.js');
  });

  test('degrades to a message on empty query / no workspace / no CLI — never throws', async () => {
    expect(await runToolQuery(makeDeps(), '   ', 10)).toContain('empty query');
    expect(await runToolQuery(makeDeps({ workspaceRoot: jest.fn(() => null) }), 'x', 10)).toContain('no workspace folder');
    expect(await runToolQuery(makeDeps({ ensureRunner: jest.fn(async () => null) }), 'x', 10)).toContain('CLI not found');
  });

  test('clamps top to [1, 25] and defaults to 10', async () => {
    const deps = makeDeps();
    await runToolQuery(deps, 'q', 999);
    expect(deps.runQueryJson).toHaveBeenLastCalledWith('/workspace', expect.any(Object), 'q', 25);
    await runToolQuery(deps, 'q', undefined);
    expect(deps.runQueryJson).toHaveBeenLastCalledWith('/workspace', expect.any(Object), 'q', 10);
    await runToolQuery(deps, 'q', -3);
    expect(deps.runQueryJson).toHaveBeenLastCalledWith('/workspace', expect.any(Object), 'q', 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('registerAiIntegrations', () => {
  test('registers the LM tool and MCP provider when the APIs exist', () => {
    const context = makeContext();
    const result = registerAiIntegrations(context, makeDeps());
    expect(result).toEqual({ tool: true, mcp: true });
    expect(vscode.lm.registerTool).toHaveBeenCalledWith(TOOL_NAME, expect.objectContaining({ invoke: expect.any(Function) }));
    expect(vscode.lm.registerMcpServerDefinitionProvider).toHaveBeenCalledWith(
      MCP_PROVIDER_ID, expect.objectContaining({ provideMcpServerDefinitions: expect.any(Function) }));
    expect(context.subscriptions).toHaveLength(2);
  });

  test('feature detection: skips cleanly when vscode.lm is absent', () => {
    const savedLm = vscode.lm;
    try {
      delete vscode.lm;
      const context = makeContext();
      const deps = makeDeps();
      const result = registerAiIntegrations(context, deps);
      expect(result).toEqual({ tool: false, mcp: false });
      expect(context.subscriptions).toHaveLength(0);
      expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('unavailable'));
    } finally {
      vscode.lm = savedLm;
    }
  });

  test('tool invoke returns a LanguageModelToolResult with the ranked text', async () => {
    const context = makeContext();
    registerAiIntegrations(context, makeDeps());
    const tool = vscode.lm.registerTool.mock.calls[0][1];

    const result = await tool.invoke({ input: { query: 'auth flow' } });
    expect(result).toBeInstanceOf(vscode.LanguageModelToolResult);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
    expect(result.content[0].value).toContain('src/auth.js');
  });

  test('prepareInvocation surfaces the query being ranked', () => {
    const context = makeContext();
    registerAiIntegrations(context, makeDeps());
    const tool = vscode.lm.registerTool.mock.calls[0][1];
    expect(tool.prepareInvocation({ input: { query: 'auth' } }).invocationMessage).toContain('"auth"');
  });

  test('MCP provider returns a stdio definition when the CLI resolves, [] otherwise', async () => {
    const context = makeContext();
    const deps = makeDeps();
    registerAiIntegrations(context, deps);
    const provider = vscode.lm.registerMcpServerDefinitionProvider.mock.calls[0][1];

    const defs = await provider.provideMcpServerDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toBeInstanceOf(vscode.McpStdioServerDefinition);
    expect(defs[0]).toMatchObject({ label: 'SigMap', command: '/bin/sigmap', args: ['--mcp'] });

    deps.ensureRunner.mockResolvedValue(null);
    expect(await provider.provideMcpServerDefinitions()).toEqual([]);
  });
});
