# Changelog

## [4.3.0] - 2026-07-28

### Added
- **`sigmap_query` Language Model Tool** (#18): Copilot agent mode can now call SigMap's ranked retrieval automatically (and users can reference it in chat as `#sigmap`). Input `{ query, top? }`; returns the top-ranked workspace files with their key signatures via the existing runner resolution — no workspace/CLI degrades into an actionable text answer, never a throw.
- **One-click MCP registration** (#18): an MCP server definition provider offers the resolved sigmap CLI as a stdio server (`--mcp`) — no manual `mcp.json` editing.
- Shared `runQueryJson` helper backing both the QuickPick command and the LM tool.

### Changed
- `engines.vscode` raised `^1.85.0` → `^1.101.0` (first stable release of both `vscode.lm` APIs). Both integrations are feature-detected, so activation still succeeds on hosts without `vscode.lm`.

## [4.2.1] - 2026-07-28

### Fixed
- **Extension-host freeze** (#16): runner resolution ran on every 60 s status tick and, when sigmap wasn't installed, fell through to *synchronous* login-shell probes (up to ~16 s of blocking, every minute). The global-command resolution is now cached (revalidated with a single `existsSync`, failures never cached) and the shell lookup is asynchronous and runs at most once per session (`ensureRunner`).
- **Health probe throttled** (#16): `--health --json` spawned every 60 s; it now runs only when the context file's mtime changes or the last probe is ≥ 10 min old — the age display is recomputed locally in between.
- **Honest fallback grade** (#16): without the CLI, the status bar hardcoded grade A / score 100 regardless of age; the grade is now derived from the context file's age (A < 1 h, B < 6 h, C < 24 h, D after) and no score is fabricated.
- **Regenerate failure feedback** (#16): regeneration ran fire-and-forget in a terminal; it now runs under a cancellable progress notification with a 5-minute cap, logs output to the SigMap output channel, and notifies on success or failure.
- **Stale nudge in long-lived windows** (#16): the stale-context check ran once at activation; it now also runs on the status tick, re-prompting at most once every 24 h.
- **Decoration false positives** (#16): gutter dots used suffix matching, so `index.ts` in the map lit up *every* `index.ts` in the workspace; matching is now exact on the workspace-relative path.
- Diagnostics moved from `console.log` to a proper **SigMap output channel**; Marketplace description updated (29 → 33 languages).

## [4.2.0] - 2026-06-19

### Added
- **SigMap: Query Context command** (#14): query your codebase from inside the editor.
  - Prompts for a query, runs `sigmap --query "<text>" --json --top 10` through the existing runner resolution.
  - Shows ranked files in a QuickPick (score · token count · signature preview); selecting one opens the file.
  - New pure helpers `buildQueryArgs` / `parseQueryResults` (unit tested).
- Expanded test suite: behavioral coverage for `runQuery`, `getStatus`, `runRegenerate`, `updateStatusBar`, `checkStaleContext`, and activation command callbacks — coverage now 84% statements / 75% branches / 72% functions / 89% lines (70% gate restored to green).

## [4.1.5] - 2026-05-12

### Added
- **Comprehensive unit test suite**: 36 tests covering all critical functions (#11)
  - `executableCandidates`, `firstExecutable`, `formatAge` — platform-specific path handling
  - `parseContextPaths` — markdown parsing, whitespace handling, complex paths
  - `applyDecorations`, `scheduleUpdate` — decoration logic with debounce tests
  - **Windows regression test**: backslash path normalization in applyDecorations
- **Automated CI pipeline** (.github/workflows/ci.yml):
  - `node --check` syntax validation on every push (prevents bracket errors like v4.1.3)
  - `npm test --coverage` runs tests and enforces 70% coverage thresholds
  - Triggers on push to main and all pull_requests
  - Coverage uploaded to codecov

### Benefits
- All future PRs must pass tests before merging
- Syntax errors caught before release
- 70% code coverage prevents untested logic from shipping
- Platform-specific bugs (Windows path separators, spawn errors) detected early

## [4.1.4] - 2026-05-12

### Fixed
- Remove extraneous closing bracket causing SyntaxError in v4.1.3 (#10)

## [4.1.3] - 2026-05-12

### Fixed
- **Critical**: Handle `spawn EINVAL` error on Windows extension activation (#8)
- Validate command path exists before executing
- Wrap execFile in try-catch to gracefully handle spawn errors
- Extension now activates even if health check command fails

## [4.1.2] - 2026-05-12

### Added
- Comprehensive startup and activation logs with `[SigMap]` prefix for debugging extension initialization issues
- Log when workspace root is detected and status bar is updated
- Log runner resolution (local script vs global command) to help diagnose sigmap installation problems
- Log file watcher and decoration initialization status
- Users can view logs in VS Code Output panel → "SigMap" dropdown

## [4.1.1] - 2026-05-12

### Fixed
- **Windows PowerShell 5.1 compatibility**: Use `;` instead of `&&` for command chaining in terminal, and add `&` prefix for proper command invocation syntax (#4)
- **Windows gutter decorations**: Normalize path separators (backslash → forward slash) before comparison to fix green/grey indicator dots not appearing (#4)
- **Windows status bar visibility**: Show status bar with "open a folder to activate" message when no workspace folder is open (#4)

## [4.1.0] - 2026-05-11

### Fixed
- Windows PATH resolution now checks `%LOCALAPPDATA%\npm`, `nvm-windows` paths (`%APPDATA%\nvm\<version>`), fnm (Fast Node Manager), and Node.js official installer default location (`C:\Program Files\nodejs`)
- `where` command output parsing now filters `INFO:` and `WARNING:` prefix lines to avoid false positives
- Improved diagnostic logging — check Output → SigMap channel when extension cannot locate sigmap binary

### Added
- Complete Jest unit test suite with 26 tests covering path resolution, executable detection, and decorations
- `test` and `test:watch` npm scripts
- `jest` and `jest.setup.js` configuration for testing VS Code extension functions
- Helper functions now exported from `extension.js` for testability

## [3.4.0] - 2026-04-14

### Added
- Added support documentation for Phase A coverage formats: TOML (`.toml`), properties (`.properties`), XML (`.xml`), and Markdown (`.md`)

### Changed
- Version sync with SigMap core release 3.4.0
## [3.3.4] - 2026-04-14

### Changed
- Version sync with SigMap core release 3.3.4
- Updated marketplace description language count from 21 to 25

## [3.3.3] - 2026-04-14

### Added
- Added support documentation for 4 new extractor-backed languages: SQL, GraphQL, Terraform, Protobuf

### Changed
- Updated language support references from 21 to 25
- Version sync with SigMap core release 3.3.3

## [2.0.2] - 2026-04-04

### Changed
- Added Open VSX badge and availability table to README
- Added CLI commands reference table to README
- Updated MCP section to list all 7 tools
- Improved status bar format documentation

## [2.0.1] — 2026-04-04

### Added
- v2 pipeline support: TODOs, recent changes, coverage gaps, PR diff context
- Dependency extractors for Python and TypeScript
- Impact radius hints (reverse dependency annotations)
- Enriched signatures with return types and type hints across all 21 languages
- "What's new in 2.0" section in extension README

### Changed
- Status bar prefix updated from `cf:` to `sm:` for SigMap branding alignment

### Fixed
- Status bar now correctly shows SigMap branding

## [1.5.0] — 2026-04-03

### Added
- Initial release on VS Code Marketplace
- Status bar showing health grade (A/B/C/D) and time since last regeneration
- `SigMap: Regenerate Context` command
- `SigMap: Open Context File` command
- Stale context notification (>24h) with one-click regenerate
- Configurable `sigmap.scriptPath` setting
- 21 language support
- Secret scanning (AWS keys, GitHub tokens, DB strings, etc.)
- MCP server support for Claude and Cursor
