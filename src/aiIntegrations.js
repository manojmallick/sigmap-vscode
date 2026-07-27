'use strict';

/**
 * AI-native integrations: the sigmap_query Language Model Tool (invoked by
 * Copilot agent mode / referenced as #sigmap in chat) and the MCP server
 * definition provider (one-click `sigmap --mcp` registration).
 *
 * Both APIs are feature-detected — activation must succeed on hosts that
 * don't expose vscode.lm (older VS Code, some forks).
 */

const vscode = require('vscode');

const TOOL_NAME = 'sigmap_query';
const MCP_PROVIDER_ID = 'sigmap.mcpServers';
const MAX_TOP = 25;
const SIGS_PER_FILE = 5;

/** Render ranked query results as plain text for the model. */
function formatToolResult(query, results) {
  if (!results || !results.length) {
    return `No SigMap matches for "${query}". The signature map may be missing or stale — run the "SigMap: Regenerate Context" command and retry.`;
  }
  const lines = [`Top ${results.length} files for "${query}" (ranked by SigMap signature index):`];
  for (const r of results) {
    lines.push(`${r.rank}. ${r.file} (score ${r.score})`);
    for (const sig of (r.sigs || []).slice(0, SIGS_PER_FILE)) {
      lines.push(`   ${sig}`);
    }
  }
  return lines.join('\n');
}

/** Build the stdio MCP server definition fields for a resolved runner. */
function buildMcpDefinition(runner) {
  return runner.type === 'script'
    ? { label: 'SigMap', command: process.execPath, args: [runner.path, '--mcp'] }
    : { label: 'SigMap', command: runner.path, args: ['--mcp'] };
}

/**
 * Run a tool-initiated query end to end. Always resolves to model-readable
 * text — never throws — so a missing workspace or CLI degrades into an
 * explanation the agent can act on.
 */
async function runToolQuery(deps, query, top) {
  const text = String(query || '').trim();
  if (!text) return 'SigMap: empty query — provide a natural-language description of the code to find.';
  const root = deps.workspaceRoot();
  if (!root) return 'SigMap: no workspace folder open.';
  const runner = await deps.ensureRunner(root);
  if (!runner) return 'SigMap: CLI not found. Install with `npm install -g sigmap` (or set sigmap.scriptPath) and retry.';
  const n = Math.min(Math.max(Number(top) || 10, 1), MAX_TOP);
  const results = await deps.runQueryJson(root, runner, text, n);
  return formatToolResult(text, results);
}

/**
 * Register the LM tool and the MCP provider when the host supports them.
 * @param {vscode.ExtensionContext} context
 * @param {{workspaceRoot: Function, ensureRunner: Function, runQueryJson: Function, log: Function}} deps
 * @returns {{tool: boolean, mcp: boolean}} what was actually registered
 */
function registerAiIntegrations(context, deps) {
  const registered = { tool: false, mcp: false };

  if (vscode.lm && typeof vscode.lm.registerTool === 'function') {
    try {
      context.subscriptions.push(vscode.lm.registerTool(TOOL_NAME, {
        async invoke(options, _token) {
          const input = (options && options.input) || {};
          const text = await runToolQuery(deps, input.query, input.top);
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
        },
        prepareInvocation(options) {
          const q = (options && options.input && options.input.query) || '';
          return { invocationMessage: `SigMap: ranking files for "${q}"` };
        },
      }));
      registered.tool = true;
      deps.log(`AI: registered language model tool ${TOOL_NAME}`);
    } catch (e) {
      deps.log(`AI: tool registration failed: ${e.message}`);
    }
  } else {
    deps.log('AI: vscode.lm.registerTool unavailable — skipping LM tool');
  }

  if (vscode.lm && typeof vscode.lm.registerMcpServerDefinitionProvider === 'function') {
    try {
      context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
        provideMcpServerDefinitions: async () => {
          const runner = await deps.ensureRunner(deps.workspaceRoot());
          if (!runner || typeof vscode.McpStdioServerDefinition !== 'function') return [];
          const def = buildMcpDefinition(runner);
          return [new vscode.McpStdioServerDefinition(def.label, def.command, def.args)];
        },
      }));
      registered.mcp = true;
      deps.log('AI: registered MCP server definition provider');
    } catch (e) {
      deps.log(`AI: MCP provider registration failed: ${e.message}`);
    }
  } else {
    deps.log('AI: vscode.lm.registerMcpServerDefinitionProvider unavailable — skipping MCP provider');
  }

  return registered;
}

module.exports = {
  registerAiIntegrations, runToolQuery, formatToolResult, buildMcpDefinition,
  TOOL_NAME, MCP_PROVIDER_ID,
};
