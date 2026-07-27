'use strict';

/**
 * SigMap VS Code Extension
 *
 * Features:
 *  - Status bar: shows health grade (A/B/C/D) and time since last regen
 *  - Command: SigMap: Regenerate Context  (runs gen-context with progress + cancel)
 *  - Command: SigMap: Open Context File
 *  - Command: SigMap: Query Context      (ranked files via --query --json)
 *  - Notification: when copilot-instructions.md is > 24 h stale
 *
 * Zero runtime dependencies — uses only the VS Code API.
 */

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

// ── Constants ────────────────────────────────────────────────────────────────

const CONTEXT_FILE = '.github/copilot-instructions.md';
const STALE_HOURS = 24;
const STATUS_INTERVAL_MS = 60 * 1000; // refresh status bar every 60 s
const EXECUTABLE_NAMES = ['sigmap', 'gen-context'];
const QUERY_TOP = 10; // default number of ranked files for SigMap: Query Context
const DAY_MS = 24 * 60 * 60 * 1000;
const HEALTH_PROBE_INTERVAL_MS = 10 * 60 * 1000; // re-run the CLI health probe at most every 10 min
const HEALTH_TIMEOUT_MS = 8000;
const REGEN_TIMEOUT_MS = 5 * 60 * 1000;
const STALE_REPROMPT_MS = DAY_MS; // re-prompt about a stale context at most once a day

// Grade ≥ 90 → A, ≥ 75 → B, ≥ 60 → C, < 60 → D
const GRADE_ICONS = { A: '$(check) A', B: '$(info) B', C: '$(warning) C', D: '$(error) D' };

// ── Logging ──────────────────────────────────────────────────────────────────

let _channel = null;

/** Log a diagnostic line to the SigMap output channel (never throws). */
function log(msg) {
  try {
    if (!_channel) _channel = vscode.window.createOutputChannel('SigMap');
    _channel.appendLine(`[${new Date().toISOString()}] ${msg}`);
  } catch (_) {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return the workspace root folder path, or null. */
function workspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
}

/**
 * Resolve the path to gen-context.js (local script).
 * Uses sigmap.scriptPath setting if set; otherwise looks in workspace root
 * and workspace node_modules/.bin.
 */
function resolveScript(root) {
  const cfg = vscode.workspace.getConfiguration('sigmap');
  const custom = cfg.get('scriptPath', '').trim();
  if (custom && fs.existsSync(custom)) return custom;
  if (root) {
    const candidate = path.join(root, 'gen-context.js');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function isWindows() {
  return process.platform === 'win32';
}

function executableCandidates(baseDir, name) {
  if (!baseDir) return [];
  if (isWindows()) {
    return [
      path.join(baseDir, `${name}.cmd`),
      path.join(baseDir, `${name}.exe`),
      path.join(baseDir, `${name}.bat`),
      path.join(baseDir, name),
    ];
  }
  return [path.join(baseDir, name)];
}

function firstExecutable(paths) {
  for (const p of paths) {
    if (!p) continue;
    try {
      if (isWindows()) {
        if (fs.existsSync(p)) return p;
      } else {
        fs.accessSync(p, fs.constants.X_OK);
        return p;
      }
    } catch (_) {}
  }
  return null;
}

/**
 * Probe common global installation paths for the gen-context binary.
 * Required because macOS GUI apps (VS Code) do NOT inherit shell PATH,
 * so ~/.volta/bin and nvm paths are invisible without this.
 *
 * Filesystem probing only — the (slow) shell lookup lives in probeShellOnce()
 * so it can run asynchronously and at most once per session.
 *
 * Resolution order:
 *  1. workspace node_modules/.bin/gen-context  (local npm install)
 *  2. ~/.volta/bin/gen-context                 (Volta)
 *  3. ~/.nvm/versions/node/<latest>/bin/gen-context (nvm)
 *  4. /usr/local/bin, /opt/homebrew/bin        (classic npm / Homebrew)
 *  5. ~/.npm-global/bin                        (npm prefix override)
 *
 * @param {string|null} root - workspace root (may be null)
 * @returns {string|null} absolute path to binary, or null
 */
function resolveGlobalCommand(root) {
  const home = os.homedir();
  const candidates = [];
  const addDir = (dir) => {
    if (!dir) return;
    for (const name of EXECUTABLE_NAMES) {
      candidates.push(...executableCandidates(dir, name));
    }
  };

  // 1. workspace-local node_modules
  if (root) addDir(path.join(root, 'node_modules', '.bin'));

  // 2. Volta
  addDir(path.join(home, '.volta', 'bin'));

  // 3. nvm — scan all installed versions, newest first
  const nvmDir = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmDir)) {
    try {
      fs.readdirSync(nvmDir)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .forEach(v => addDir(path.join(nvmDir, v, 'bin')));
    } catch (_) {}
  }

  // 4. classic / Homebrew global paths
  addDir('/usr/local/bin');
  addDir('/opt/homebrew/bin');

  // 5. npm prefix override
  addDir(path.join(home, '.npm-global', 'bin'));
  addDir(path.join(home, 'npm', 'bin'));

  // 6. common Windows global npm / user bin dirs
  if (isWindows()) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

    // npm global paths
    addDir(path.join(appData, 'npm'));
    addDir(path.join(localAppData, 'npm'));

    // nvm-windows (uses %APPDATA%\nvm, not ~/.nvm)
    const nvmWinDir = path.join(appData, 'nvm');
    if (fs.existsSync(nvmWinDir)) {
      try {
        fs.readdirSync(nvmWinDir)
          .filter(v => /^v?\d/.test(v))
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
          .forEach(v => addDir(path.join(nvmWinDir, v)));
      } catch (_) {}
    }

    // Node.js official Windows installer default
    addDir(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'));

    // fnm (Fast Node Manager) on Windows
    const fnmDir = path.join(localAppData, 'fnm', 'node-versions');
    if (fs.existsSync(fnmDir)) {
      try {
        fs.readdirSync(fnmDir)
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
          .forEach(v => addDir(path.join(fnmDir, v, 'installation')));
      } catch (_) {}
    }

    addDir(path.join(home, 'bin'));
    addDir(path.join(home, '.local', 'bin'));
  }

  return firstExecutable(candidates);
}

// ── Runner resolution (cached) ───────────────────────────────────────────────

// Cached global-command path. The local-script lookup stays live (it is a
// couple of cheap existsSync calls and must react to setting changes); the
// global probe walks dozens of paths, so its successful result is cached and
// revalidated with a single existsSync. Failures are never cached.
let _globalCommandCache = null;
// The login-shell lookup spawns real shells, so it runs at most once per session.
let _shellProbePromise = null;

/**
 * Fast, synchronous runner resolution (filesystem probing only):
 *   { type: 'script', path }  → run as `node "<path>"`
 *   { type: 'command', path } → run as `"<path>"` directly
 *   null                      → nothing found (see ensureRunner for the shell fallback)
 */
function resolveRunner(root) {
  const script = resolveScript(root);
  if (script) return { type: 'script', path: script };

  if (_globalCommandCache && fs.existsSync(_globalCommandCache)) {
    return { type: 'command', path: _globalCommandCache };
  }
  _globalCommandCache = null;

  const cmd = resolveGlobalCommand(root);
  if (cmd) {
    log(`Runner: global command found at ${cmd}`);
    _globalCommandCache = cmd;
    return { type: 'command', path: cmd };
  }
  return null;
}

/**
 * Async lookup via `where` (Windows) or a login shell (Unix). Runs at most
 * once per session — previous versions ran this synchronously on every status
 * tick, freezing the extension host for up to ~16 s when sigmap wasn't installed.
 */
function probeShellOnce() {
  if (_shellProbePromise) return _shellProbePromise;
  _shellProbePromise = new Promise((resolve) => {
    const attempts = [];
    if (isWindows()) {
      for (const name of EXECUTABLE_NAMES) attempts.push(['where', [name]]);
    } else {
      for (const sh of ['/bin/zsh', '/bin/bash']) {
        for (const name of EXECUTABLE_NAMES) {
          attempts.push([sh, ['-l', '-c', `command -v ${name} || which ${name}`]]);
        }
      }
    }
    const tryNext = (i) => {
      if (i >= attempts.length) return resolve(null);
      try {
        execFile(attempts[i][0], attempts[i][1], { timeout: 4000, encoding: 'utf8' }, (err, stdout) => {
          if (!err) {
            const first = String(stdout).split(/\r?\n/)
              .map(s => s.trim())
              .find(s => s && !s.startsWith('INFO:') && !s.startsWith('WARNING:') && fs.existsSync(s));
            if (first) return resolve(first);
          }
          tryNext(i + 1);
        });
      } catch (_) {
        tryNext(i + 1);
      }
    };
    tryNext(0);
  });
  return _shellProbePromise;
}

/** Full resolution: fast path first, then the once-per-session shell probe. */
async function ensureRunner(root) {
  const fast = resolveRunner(root);
  if (fast) return fast;
  const shell = await probeShellOnce();
  if (shell && fs.existsSync(shell)) {
    log(`Runner: shell lookup found ${shell}`);
    _globalCommandCache = shell;
    return { type: 'command', path: shell };
  }
  return null;
}

// ── Health status (throttled) ────────────────────────────────────────────────

// Last CLI probe, reused between probes — only the age is recomputed locally.
let _healthCache = null; // { root, mtimeMs, atMs, status }

/** Map a context-file age in hours onto the A–D grade scale. */
function gradeFromAge(hours) {
  if (hours < 1) return 'A';
  if (hours < 6) return 'B';
  if (hours < 24) return 'C';
  return 'D';
}

/**
 * Returns { daysSince, grade, score, tokens, reduction } for a given cwd.
 * Uses gen-context --health --json when available; falls back to an
 * age-derived grade. The CLI probe is throttled: it only runs when the
 * context file's mtime changed or the last probe is older than
 * HEALTH_PROBE_INTERVAL_MS.
 */
function getStatus(root, runner, force = false) {
  return new Promise((resolve) => {
    if (!root) return resolve(null);

    const ctxPath = path.join(root, CONTEXT_FILE);
    if (!fs.existsSync(ctxPath)) {
      _healthCache = null;
      return resolve(null);
    }

    const mtimeMs = fs.statSync(ctxPath).mtimeMs;
    const nowMs = Date.now();
    const daysSince = (nowMs - mtimeMs) / DAY_MS;

    const c = _healthCache;
    if (!force && c && c.root === root && c.mtimeMs === mtimeMs &&
        nowMs - c.atMs < HEALTH_PROBE_INTERVAL_MS) {
      return resolve({ ...c.status, daysSince });
    }

    const finish = (status) => {
      if (status) _healthCache = { root, mtimeMs, atMs: nowMs, status };
      resolve(status);
    };

    if (runner) {
      const [cmd, args] = runner.type === 'script'
        ? [process.execPath, [runner.path, '--health', '--json']]
        : [runner.path, ['--health', '--json']];

      // Validate command exists before executing
      if (!fs.existsSync(cmd)) {
        log(`Warning: command does not exist: ${cmd}`);
        return mtimeFallback(root, finish);
      }

      try {
        execFile(cmd, args, { cwd: root, timeout: HEALTH_TIMEOUT_MS }, (err, stdout) => {
          if (!err) {
            try {
              const data = JSON.parse(stdout.trim());
              return finish({
                grade:     data.grade     || 'A',
                score:     data.score     || 100,
                daysSince,
                tokens:    data.tokens    || 0,
                reduction: data.reduction || 0,
              });
            } catch (_) {}
          }
          // Fallback to mtime-only
          mtimeFallback(root, finish);
        });
      } catch (spawnErr) {
        log(`Error spawning command: ${spawnErr.message}`);
        mtimeFallback(root, finish);
      }
    } else {
      mtimeFallback(root, finish);
    }
  });
}

function mtimeFallback(root, resolve) {
  const ctxPath = path.join(root, CONTEXT_FILE);
  if (!fs.existsSync(ctxPath)) return resolve(null);
  const mtime = fs.statSync(ctxPath).mtimeMs;
  const daysSince = (Date.now() - mtime) / DAY_MS;
  // No CLI available: grade honestly from the file's age instead of a fixed A.
  resolve({ grade: gradeFromAge(daysSince * 24), score: null, daysSince });
}

/** Format daysSince as a human-readable string. */
function formatAge(daysSince) {
  if (daysSince < 1 / 24) return 'just now';
  if (daysSince < 1) {
    const h = Math.round(daysSince * 24);
    return `${h}h ago`;
  }
  const d = Math.floor(daysSince);
  return `${d}d ago`;
}

// ── Query context ───────────────────────────────────────────────────────────────

/**
 * Build the execFile [cmd, args] pair for `--query "<text>" --json --top <n>`,
 * mirroring getStatus: script runners go through `node <path>`, command runners
 * invoke the binary directly.
 *
 * @returns {[string, string[]]} [command, args]
 */
function buildQueryArgs(runner, text, top) {
  const flags = ['--query', text, '--json', '--top', String(top)];
  return runner.type === 'script'
    ? [process.execPath, [runner.path, ...flags]]
    : [runner.path, flags];
}

/**
 * Parse the JSON emitted by `--query <text> --json` into a list of ranked
 * results. Returns [] on empty or malformed output so callers can degrade
 * gracefully.
 *
 * @returns {Array<{rank:number, file:string, score:number, sigs:string[], tokens:number}>}
 */
function parseQueryResults(stdout) {
  try {
    const data = JSON.parse(String(stdout).trim());
    if (!data || !Array.isArray(data.results)) return [];
    return data.results.map(r => ({
      rank:   r.rank,
      file:   r.file,
      score:  r.score,
      sigs:   Array.isArray(r.sigs) ? r.sigs : [],
      tokens: r.tokens || 0,
    }));
  } catch (_) {
    return [];
  }
}

/**
 * Run `--query <text> --json` through a resolved runner and return the parsed
 * ranked results ([] on any failure). Shared by the QuickPick command and the
 * sigmap_query language model tool.
 */
function runQueryJson(root, runner, text, top) {
  const [cmd, args] = buildQueryArgs(runner, text, top);
  if (!fs.existsSync(cmd)) return Promise.resolve([]);
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { cwd: root, timeout: 15000 }, (err, stdout) => {
        resolve(err ? [] : parseQueryResults(stdout));
      });
    } catch (_) {
      resolve([]);
    }
  });
}

/**
 * Prompt for a query, run it through the resolved runner, and present the
 * ranked files in a QuickPick. Selecting a result opens that file.
 */
async function runQuery(root, runner) {
  if (!root) {
    vscode.window.showWarningMessage('SigMap: no workspace folder open.');
    return;
  }
  if (!runner) {
    vscode.window.showWarningMessage('SigMap: command not found. Install with `npm install -g sigmap` or set sigmap.scriptPath.');
    return;
  }

  const text = await vscode.window.showInputBox({
    prompt: 'SigMap: query your codebase',
    placeHolder: 'e.g. authentication flow',
  });
  if (!text || !text.trim()) return;

  const results = await runQueryJson(root, runner, text.trim(), QUERY_TOP);

  if (!results.length) {
    vscode.window.showInformationMessage(`SigMap: no results for "${text.trim()}".`);
    return;
  }

  const picked = await vscode.window.showQuickPick(
    results.map(r => ({
      label: r.file,
      description: `score ${r.score} · ${r.tokens} tok`,
      detail: r.sigs.slice(0, 3).join('  ·  '),
      file: r.file,
    })),
    { placeHolder: `SigMap results for "${text.trim()}" — select to open`, matchOnDetail: true }
  );
  if (!picked) return;

  const uri = vscode.Uri.file(path.join(root, picked.file));
  await vscode.window.showTextDocument(uri);
}

// ── Status bar ────────────────────────────────────────────────────────────────

function createStatusBarItem() {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'sigmap.regenerate';
  item.tooltip = 'SigMap — click to regenerate context';
  return item;
}

async function updateStatusBar(statusBar) {
  const root = workspaceRoot();
  const runner = resolveRunner(root);

  if (!root) {
    statusBar.text = '$(file-code) SigMap';
    statusBar.tooltip = 'SigMap: open a folder to activate';
    statusBar.show();
    return;
  }

  const status = await getStatus(root, runner);

  if (!status) {
    statusBar.text = '$(file-code) sm: no context';
    statusBar.tooltip = 'SigMap: no context file found. Run: node gen-context.js';
    statusBar.show();
    return;
  }

  const icon    = GRADE_ICONS[status.grade] || GRADE_ICONS.A;
  const age     = formatAge(status.daysSince);
  const tokStr  = status.tokens    ? `${(status.tokens / 1000).toFixed(1)}K tok` : '';
  const redStr  = status.reduction ? `${status.reduction}% \u2193` : '';
  const scoreStr = typeof status.score === 'number' ? ` (${status.score}/100)` : '';
  const extras  = [tokStr, redStr].filter(Boolean);
  statusBar.text = `$(file-code) SigMap ${icon}${extras.length ? ' \u00b7 ' + extras.join(' \u00b7 ') : ''}`;
  statusBar.tooltip = [
    `SigMap health: ${status.grade}${scoreStr}`,
    extras.length ? `Context size: ${tokStr}  Reduction: ${redStr}` : '',
    `Last regenerated: ${age}`,
    'Click to regenerate',
  ].filter(Boolean).join('\n');
  statusBar.show();
}

// ── Stale notification ────────────────────────────────────────────────────────

/** Key used to suppress 'do not show again' per workspace */
function suppressionKey(root) {
  return `cf.stale.suppress.${Buffer.from(root).toString('base64').slice(0, 16)}`;
}

// Checked on every status tick (not just activation), so long-lived windows
// still get nudged — but prompt at most once per STALE_REPROMPT_MS.
let _lastStalePromptMs = 0;

async function checkStaleContext(context, root, runner) {
  if (!root) return;

  const ctxPath = path.join(root, CONTEXT_FILE);
  if (!fs.existsSync(ctxPath)) return;

  const mtime = fs.statSync(ctxPath).mtimeMs;
  const hoursSince = (Date.now() - mtime) / (1000 * 60 * 60);
  if (hoursSince < STALE_HOURS) return;

  // Check suppression flag
  const key = suppressionKey(root);
  if (context.workspaceState.get(key)) return;

  const now = Date.now();
  if (now - _lastStalePromptMs < STALE_REPROMPT_MS) return;
  _lastStalePromptMs = now;

  const daysOld = Math.round(hoursSince / 24);
  const choice = await vscode.window.showInformationMessage(
    `SigMap: context file is ${daysOld} day${daysOld !== 1 ? 's' : ''} old. Regenerate now?`,
    'Regenerate',
    'Not now',
    "Don't show again"
  );

  if (choice === 'Regenerate') {
    await runRegenerate(root, runner || await ensureRunner(root));
  } else if (choice === "Don't show again") {
    await context.workspaceState.update(key, true);
  }
}

// ── Command: regenerate ───────────────────────────────────────────────────────

async function runRegenerate(root, runner) {
  if (!root) {
    vscode.window.showWarningMessage('SigMap: no workspace folder open.');
    return;
  }
  if (!runner) {
    const choice = await vscode.window.showWarningMessage(
      'SigMap: command not found. Try npm global/local, npx, standalone binary in PATH, or set sigmap.scriptPath.',
      'Copy install command',
      'Open settings'
    );
    if (choice === 'Copy install command') {
      await vscode.env.clipboard.writeText('npm install -g sigmap');
      vscode.window.showInformationMessage('Copied: npm install -g sigmap');
    } else if (choice === 'Open settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'sigmap.scriptPath');
    }
    return;
  }

  const [cmd, args] = runner.type === 'script'
    ? [process.execPath, [runner.path]]
    : [runner.path, []];
  log(`Regenerate: ${cmd} ${args.join(' ')}`);

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'SigMap: regenerating context\u2026',
      cancellable: true,
    },
    (_progress, token) => new Promise((resolve) => {
      let child = null;
      try {
        child = execFile(cmd, args, { cwd: root, timeout: REGEN_TIMEOUT_MS }, (err, stdout, stderr) => {
          if (stdout) log(String(stdout).trim());
          if (stderr) log(String(stderr).trim());
          if (token.isCancellationRequested) return resolve(undefined);
          if (err) {
            log(`Regenerate failed: ${err.message}`);
            Promise.resolve(vscode.window.showErrorMessage(
              'SigMap: context regeneration failed \u2014 see the SigMap output channel.',
              'Show Output'
            )).then(choice => {
              if (choice === 'Show Output' && _channel) _channel.show(true);
            });
          } else {
            vscode.window.showInformationMessage('SigMap: context regenerated.');
          }
          resolve(undefined);
        });
      } catch (spawnErr) {
        log(`Regenerate spawn error: ${spawnErr.message}`);
        vscode.window.showErrorMessage(`SigMap: failed to run gen-context: ${spawnErr.message}`);
        return resolve(undefined);
      }
      token.onCancellationRequested(() => {
        try { if (child) child.kill(); } catch (_) {}
      });
    })
  );
}

// ── Activation ────────────────────────────────────────────────────────────────

/** @param {vscode.ExtensionContext} context */
async function activate(context) {
  log('Extension activated');

  const statusBar = createStatusBarItem();
  context.subscriptions.push(statusBar);

  // Initial status bar update
  const root = workspaceRoot();
  log(`Workspace root: ${root || '(none)'}`);
  await updateStatusBar(statusBar);

  // Kick the once-per-session shell probe in the background so a missing
  // fast-path resolution still finds shell-only installs without blocking.
  if (root && !resolveRunner(root)) {
    probeShellOnce().then(found => {
      if (found) updateStatusBar(statusBar);
    });
  }

  // Refresh status bar on interval; also re-check staleness (throttled inside).
  const interval = setInterval(() => {
    updateStatusBar(statusBar);
    checkStaleContext(context, workspaceRoot(), null);
  }, STATUS_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  // Feature 2: gutter decorations — green (included) / grey (excluded)
  const decs = require('./decorations');
  context.subscriptions.push(decs.GREEN, decs.GREY);

  if (root) {
    decs.applyDecorations(root);
    vscode.window.onDidChangeActiveTextEditor(() => decs.scheduleUpdate(root), null, context.subscriptions);
  }

  // Refresh when workspace files change (i.e. context file regenerated)
  const watcher = vscode.workspace.createFileSystemWatcher('**/.github/copilot-instructions.md');
  watcher.onDidChange(() => { log('Context file changed'); updateStatusBar(statusBar); if (root) decs.scheduleUpdate(root); });
  watcher.onDidCreate(() => { log('Context file created'); updateStatusBar(statusBar); if (root) decs.scheduleUpdate(root); });
  context.subscriptions.push(watcher);

  // Command: regenerate
  context.subscriptions.push(
    vscode.commands.registerCommand('sigmap.regenerate', async () => {
      log('Command: regenerate context');
      const root = workspaceRoot();
      const runner = await ensureRunner(root);
      await runRegenerate(root, runner);
    })
  );

  // Command: open context file
  context.subscriptions.push(
    vscode.commands.registerCommand('sigmap.openContext', async () => {
      log('Command: open context file');
      const root = workspaceRoot();
      if (!root) {
        vscode.window.showWarningMessage('SigMap: no workspace folder open.');
        return;
      }
      const ctxPath = path.join(root, CONTEXT_FILE);
      if (!fs.existsSync(ctxPath)) {
        vscode.window.showWarningMessage('SigMap: no context file found. Run: node gen-context.js');
        return;
      }
      const uri = vscode.Uri.file(ctxPath);
      await vscode.window.showTextDocument(uri);
    })
  );

  // Command: query context
  context.subscriptions.push(
    vscode.commands.registerCommand('sigmap.queryContext', async () => {
      log('Command: query context');
      const root = workspaceRoot();
      const runner = await ensureRunner(root);
      await runQuery(root, runner);
    })
  );

  // AI-native integrations: sigmap_query LM tool + MCP server definition
  // provider (feature-detected — no-ops on hosts without vscode.lm).
  try {
    const ai = require('./aiIntegrations');
    ai.registerAiIntegrations(context, { workspaceRoot, ensureRunner, runQueryJson, log });
  } catch (e) {
    log(`AI integrations failed to register: ${e.message}`);
  }

  // Stale check on activation (slight delay to not block startup)
  setTimeout(async () => {
    const root = workspaceRoot();
    await checkStaleContext(context, root, null);
  }, 3000);

  log('Extension fully activated');
}

function deactivate() {}

/** Reset module-level caches — exported for tests only. */
function _resetInternalState() {
  _globalCommandCache = null;
  _shellProbePromise = null;
  _healthCache = null;
  _lastStalePromptMs = 0;
}

module.exports = { activate, deactivate,
  // exported for testing:
  executableCandidates, firstExecutable, resolveGlobalCommand,
  resolveScript, resolveRunner, ensureRunner, probeShellOnce, formatAge,
  gradeFromAge, buildQueryArgs, parseQueryResults, runQueryJson,
  getStatus, mtimeFallback, updateStatusBar, runRegenerate, runQuery,
  checkStaleContext, suppressionKey, _resetInternalState };
