// Mock VS Code API for testing
jest.mock('vscode', () => ({
  window: {
    createStatusBarItem: jest.fn(() => ({
      show: jest.fn(),
      hide: jest.fn(),
      command: undefined,
      tooltip: undefined,
      text: undefined,
    })),
    visibleTextEditors: [],
    createTextEditorDecorationType: jest.fn(opts => ({})),
    onDidChangeActiveTextEditor: jest.fn(() => ({ dispose: jest.fn() })),
    createTerminal: jest.fn(() => ({
      show: jest.fn(),
      sendText: jest.fn(),
      dispose: jest.fn(),
    })),
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    })),
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: jest.fn(() => ({
      get: jest.fn(key => {
        if (key === 'scriptPath') return '';
        return undefined;
      }),
    })),
    createFileSystemWatcher: jest.fn(() => ({
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
      onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
      onDidDelete: jest.fn(() => ({ dispose: jest.fn() })),
      dispose: jest.fn(),
    })),
  },
  commands: {
    registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
    executeCommand: jest.fn(),
  },
  Uri: {
    file: jest.fn(p => ({ fsPath: p, path: p })),
    parse: jest.fn(uri => ({ fsPath: uri, path: uri })),
  },
  Range: jest.fn((start, end) => ({ start, end })),
  StatusBarAlignment: {
    Left: 0,
    Right: 1,
  },
  OverviewRulerLane: {
    Left: 1,
    Center: 2,
    Right: 4,
    Full: 7,
  },
  env: {
    clipboard: {
      writeText: jest.fn(),
    },
  },
}), { virtual: true });
