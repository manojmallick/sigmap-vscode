<div align="center">

# SigMap — VS Code Extension

### Zero-dependency AI context engine for VS Code, Cursor, and VSCodium

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/manojmallick.sigmap?color=7c6af7&label=VS%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=manojmallick.sigmap)
[![Open VSX](https://img.shields.io/open-vsx/v/manojmallick/sigmap?color=a251e3&label=Open%20VSX&logo=vscodium)](https://open-vsx.org/extension/manojmallick/sigmap)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/manojmallick.sigmap?color=blue&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=manojmallick.sigmap)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/manojmallick.sigmap?color=brightgreen)](https://marketplace.visualstudio.com/items?itemName=manojmallick.sigmap)
[![Release](https://img.shields.io/github/v/release/manojmallick/sigmap-vscode?color=7c6af7&label=release)](https://github.com/manojmallick/sigmap-vscode/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node ≥18](https://img.shields.io/badge/node-%E2%89%A518-brightgreen?logo=node.js)](https://nodejs.org)

**80.0% retrieval hit@5 · 96.9% token reduction · 29 languages · Zero npm deps**

</div>

---

## What is SigMap?

SigMap extracts a compact **signature map** of your entire codebase — function names, class hierarchies, exported types, interfaces — and writes it to `.github/copilot-instructions.md` automatically.

Every AI coding assistant (GitHub Copilot, Claude, Cursor, Windsurf, Gemini, Codex) reads that file as its **first-message context**. Without it, the AI starts knowing nothing about your project. With SigMap, it starts with everything.

```
Before SigMap: "I don't know your codebase — can you share some files?"
After SigMap:  "I can see your AuthService, UserRepository, 47 API routes…"
```

**A 50,000-line TypeScript monorepo → ~3,800 tokens of pure signatures — 96.9% reduction.**

---

## What's new in v4.0

- Standalone release — independent version cycle from the SigMap CLI core
- Compatible with SigMap CLI v6.0: graph-boosted retrieval (83.3% hit@5), incremental sig cache
- 29 languages (up from 25 in v2.x)
- Corrected canonical benchmark numbers (96.9% token reduction, 80.0% hit@5)

---

## Features

### Live health grade in the status bar

| Grade | Status bar | Meaning |
|:---:|---|---|
| **A** | `sm: ✔ A 2h ago` | Fresh — AI has full context |
| **B** | `sm: ℹ B 6h ago` | Good |
| **C** | `sm: ⚠ C 1d ago` | Stale — regenerate soon |
| **D** | `sm: ✖ D 3d ago` | Very stale — regenerate now |

Click the status bar item for **instant regeneration**.

### Other features

- **Auto-regeneration** — checks on startup and every 60 seconds
- **Stale notifications** — pop-up with one-click Regenerate after 24 h
- **Secret scanning** — AWS keys, tokens, DB strings auto-redacted before writing
- **MCP server** — 9 tools exposed over stdio JSON-RPC for Claude / Cursor
- **One-command context** — `SigMap: Regenerate Context` from the Command Palette

---

## Installation

### VS Code Marketplace (recommended)

Search **"SigMap"** in the Extensions panel, or:

```
ext install manojmallick.sigmap
```

### Open VSX (VSCodium / Gitpod / Windsurf)

[open-vsx.org/extension/manojmallick/sigmap](https://open-vsx.org/extension/manojmallick/sigmap)

### Manual (.vsix)

Download `sigmap-X.Y.Z.vsix` from [Releases](https://github.com/manojmallick/sigmap-vscode/releases), then:

```
Extensions: Install from VSIX…
```

---

## Quick start

```bash
# 1. Install the CLI
npm install -g sigmap

# 2. In VS Code: Ctrl+Shift+P → SigMap: Regenerate Context
# Or run directly:
npx sigmap
```

Then use the full workflow:

```bash
sigmap ask "where is auth handled?"   # query-focused context
sigmap validate                        # check coverage
sigmap judge                           # score answer groundedness
sigmap --watch                         # auto-regenerate on save
```

---

## Requirements

| Requirement | Details |
|---|---|
| **VS Code** | 1.85.0 or higher |
| **Node.js** | 18 or higher |
| **SigMap CLI** | `npm install -g sigmap` · `npm install sigmap` · `npx sigmap` · or standalone binary |

---

## 29 Language support

TypeScript · JavaScript · Python · Go · Rust · Java · C# · C/C++ · Ruby · PHP · Swift · Dart · Kotlin · Scala · Vue · Svelte · CSS/SCSS · GraphQL · SQL · Terraform · Protobuf · Markdown · TOML · XML · Properties · Dockerfile · and more.

---

## Commands

| Command | Description |
|---|---|
| `SigMap: Regenerate Context` | Run `sigmap` in your workspace root |
| `SigMap: Open Context File` | Open `.github/copilot-instructions.md` |

### CLI reference

```bash
sigmap                    # generate once
sigmap ask "<query>"      # ranked context for a specific task
sigmap validate           # check coverage health
sigmap judge              # groundedness score for an AI answer
sigmap --watch            # auto-regenerate on file changes
sigmap --health           # 0–100 health score
sigmap --mcp              # start MCP server (9 tools)
sigmap --diff             # context for changed files only
```

---

## MCP server (9 tools)

Works with Claude Code and Cursor via `sigmap --mcp`:

| Tool | Description |
|---|---|
| `read_context` | Full or per-module signature map |
| `search_signatures` | Keyword search across all signatures |
| `get_map` | Import graph, class hierarchy, or route table |
| `query_context` | Graph-boosted ranked file retrieval |
| `create_checkpoint` | Session checkpoint with git state |
| `get_routing` | Model routing hints (fast/balanced/powerful) |
| `explain_file` | Signatures, imports, and callers for a file |
| `list_modules` | All modules sorted by token count |
| `get_impact` | Blast-radius BFS for a changed file |

---

## Benchmark

| Metric | Value |
|---|---:|
| Retrieval hit@5 | **80.0%** vs 13.6% baseline |
| Graph-boosted hit@5 | **83.3%** |
| Overall token reduction | **96.9%** |
| Prompt reduction | **40.8%** (2.84 → 1.68 prompts) |
| Task success proxy | **52.2%** |
| GPT-4o overflow repos | 13/18 → **0/18** |
| Languages | **29** |

Benchmark ID: `sigmap-v6.0-main` · Date: 2026-04-19

---

## Token reduction by repo

| Repo | Language | Reduction |
|---|---|---:|
| express | JavaScript | **98.7%** |
| flask | Python | **96.0%** |
| gin | Go | **96.7%** |
| spring-petclinic | Java | **99.2%** |
| rails | Ruby | **99.5%** |
| rust-analyzer | Rust | **99.8%** |
| abseil-cpp | C++ | **99.7%** |
| laravel | PHP | **99.6%** |
| vue-core | Vue | **97.8%** |

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `sigmap.scriptPath` | `""` | Absolute path to `gen-context.js`. Leave empty to auto-detect. |

---

## Troubleshooting

**Status bar shows `sm: no context`**  
→ Run `SigMap: Regenerate Context`. Check Node 18+: `node --version`

**"command not found"**  
→ `npm install -g sigmap` or set `sigmap.scriptPath` in settings

**Copilot not using the context**  
→ File must be at `.github/copilot-instructions.md` in the workspace root

**Want to exclude files?**  
→ Create `.contextignore` (gitignore syntax) in your project root

---

## AI tool integration

| Tool | How |
|---|---|
| **GitHub Copilot** | Reads `.github/copilot-instructions.md` automatically |
| **Claude / Claude Code** | Add `"outputs": ["claude"]` to config → writes `CLAUDE.md` |
| **Cursor** | Add `"outputs": ["cursor"]` → writes `.cursorrules` |
| **Windsurf** | Add `"outputs": ["windsurf"]` → writes `.windsurfrules` |
| **MCP (Claude/Cursor)** | `sigmap --mcp` — 9 tools over stdio JSON-RPC |

---

## Links

| | |
|---|---|
| 📖 Docs | [manojmallick.github.io/sigmap](https://manojmallick.github.io/sigmap/) |
| 🔌 JetBrains plugin | [github.com/manojmallick/sigmap-jetbrains](https://github.com/manojmallick/sigmap-jetbrains) |
| 🖥 CLI / core | [github.com/manojmallick/sigmap](https://github.com/manojmallick/sigmap) |
| 📦 npm | [npmjs.com/package/sigmap](https://www.npmjs.com/package/sigmap) |
| 🟣 Open VSX | [open-vsx.org/extension/manojmallick/sigmap](https://open-vsx.org/extension/manojmallick/sigmap) |
| 🐛 Issues | [github.com/manojmallick/sigmap-vscode/issues](https://github.com/manojmallick/sigmap-vscode/issues) |

---

<div align="center">

MIT © 2026 [Manoj Mallick](https://github.com/manojmallick) · Made in Amsterdam 🇳🇱

*SigMap for daily always-on context · Repomix for deep one-off sessions — use both.*

</div>
