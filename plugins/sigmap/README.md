# SigMap — AI Context Engine (Cursor Plugin)

**96.9% token reduction · 29 languages · zero npm deps in your project**

SigMap extracts a compact **signature map** of your entire codebase — function names,
class hierarchies, exported types, interfaces — and serves it to Cursor's agent on demand
through an MCP server. The agent starts every task already knowing your project instead of
reading files blind.

> A 50,000-line TypeScript monorepo → ~3,800 tokens of pure signatures.

## What this plugin adds to Cursor

| Component | What it does |
|-----------|--------------|
| **MCP server** (`mcp.json`) | Runs `npx sigmap --mcp`, exposing 9 tools: `searchSignatures`, `queryContext`, `getMap`, `listModules`, `explainFile`, `getImpact`, `getRouting`, `readContext`, `createCheckpoint`. |
| **Rule** (`rules/sigmap-context.mdc`) | Tells the agent to consult the signature map before grepping or reading files. |
| **Skill** (`generate-context`) | Teaches the agent to (re)generate the map with `npx sigmap` and query it via MCP. |

## Requirements

- **Node.js ≥ 18** on your PATH (the MCP server runs via `npx`).
- No project dependencies — `npx -y sigmap@latest` fetches the engine on first use.

## Usage

Once installed, the agent automatically uses the signature map for codebase questions.
To regenerate the map manually:

```bash
npx -y sigmap
```

## Links

- Homepage: https://manojmallick.github.io/sigmap/
- VS Code / Open VSX extension: https://open-vsx.org/extension/manojmallick/sigmap
- Issues: https://github.com/manojmallick/sigmap-vscode/issues

## License

MIT © Manoj Mallick
