---
name: generate-context
description: Generate or refresh the SigMap signature map for this workspace and query it via the sigmap MCP tools. Use when the codebase context is missing or stale, or when you need a whole-repo view of functions, classes, types, and module structure.
---

# Generate context (SigMap)

SigMap extracts a compact **signature map** of the whole codebase — function names, class
hierarchies, exported types, interfaces — across 29 languages, achieving ~96.9% token
reduction versus reading source files. Use this skill to (re)build that map and to query
it through the `sigmap` MCP server.

## When to use

- The agent lacks a high-level picture of the project and is about to read many files.
- The signature map / `.github/copilot-instructions.md` is missing or looks out of date.
- You need to answer "where is X", "what calls Y", or "what does editing Z affect".

## Generate or refresh the map

Run from the workspace root (no global install required):

```bash
npx -y sigmap
```

This writes the signature map to `.github/copilot-instructions.md` and updates the
incremental signature cache. Add `--report` for a health summary, or `--routing` to
enable graph-boosted retrieval.

## Query the map via MCP

The `sigmap` MCP server (started automatically by this plugin) exposes these 9 tools:

- `search_signatures` — find symbols by name or keyword.
- `query_context` — rank and return the most relevant files for a task or question.
- `read_context` — read the full or module-scoped signature context.
- `list_modules` — top-level modules sorted by token count.
- `explain_file` — a file's signatures, direct imports, and callers.
- `get_impact` — every file affected when a given file changes (importers, tests, routes).
- `get_map` — import graph, class hierarchy, or route table from PROJECT_MAP.md.
- `get_routing` — model-routing hints (which complexity tier / model per file).
- `create_checkpoint` — snapshot the current project state.

## Recommended flow

1. If the map is stale or absent, run `npx -y sigmap` to regenerate it.
2. Use `queryContext` / `searchSignatures` to locate the symbols relevant to the task.
3. Open only the specific files the map points to, then proceed with the edit.
