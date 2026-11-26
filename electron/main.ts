import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  screen,
  shell
} from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';

function isLocalPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    const done = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(350);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}
import {
  commitAcrossRepos,
  discardFiles,
  getCommitFiles,
  getDiffContent,
  getRepoCommits,
  getRepoRefs,
  listRepoFiles,
  readFileContent,
  scanWorkspace,
  stageFiles,
  unstageFiles
} from './gitService';
import {
  CommitActionTarget,
  CompareSource,
  RepoSummary
} from '../shared/types';

const windowInitialRootMap = new Map<number, string>();

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

function getWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): WindowState {
  const defaults: WindowState = { width: 1480, height: 920 };
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    const width =
      typeof parsed.width === 'number' && parsed.width >= 640
        ? Math.round(parsed.width)
        : defaults.width;
    const height =
      typeof parsed.height === 'number' && parsed.height >= 480
        ? Math.round(parsed.height)
        : defaults.height;
    const isMaximized = Boolean(parsed.isMaximized);

    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      const displays = screen.getAllDisplays();
      const visible = displays.some((d) => {
        const wa = d.workArea;
        return (
          parsed.x! < wa.x + wa.width - 80 &&
          parsed.x! + width > wa.x + 80 &&
          parsed.y! < wa.y + wa.height - 60 &&
          parsed.y! + height > wa.y + 60
        );
      });
      if (visible) {
        return {
          width,
          height,
          x: Math.round(parsed.x),
          y: Math.round(parsed.y),
          isMaximized
        };
      }
    }

    return { width, height, isMaximized };
  } catch {
    return defaults;
  }
}

function saveWindowState(state: WindowState): void {
  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2));
  } catch {
    // ignore disk errors on shutdown
  }
}

function getAppIconPath(): string | undefined {
  const file =
    process.platform === 'win32'
      ? path.join(__dirname, '../../assets/icon.ico')
      : path.join(__dirname, '../../assets/icon.png');
  return fs.existsSync(file) ? file : undefined;
}

function createWindow(initialRoot?: string): void {
  const icon = getAppIconPath();
  const state = loadWindowState();
  const existingCount = BrowserWindow.getAllWindows().length;
  const offset = existingCount > 0 ? Math.min(existingCount, 5) * 28 : 0;

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x !== undefined ? state.x + offset : undefined,
    y: state.y !== undefined ? state.y + offset : undefined,
    minWidth: 640,
    minHeight: 480,
    icon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#f5f6f8',
    title: initialRoot
      ? `Git Multi-Repo Viewer — ${path.basename(initialRoot)}`
      : 'Git Multi-Repo Viewer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (state.isMaximized) {
    win.maximize();
  }

  let saveTimer: NodeJS.Timeout | null = null;
  const persistBounds = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const isMaximized = win.isMaximized();
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
    saveWindowState({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized
    });
  };
  const schedulePersist = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistBounds, 250);
  };

  win.on('resize', schedulePersist);
  win.on('move', schedulePersist);
  win.on('maximize', persistBounds);
  win.on('unmaximize', persistBounds);
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    persistBounds();
  });

  const wcId = win.webContents.id;
  if (initialRoot) {
    windowInitialRootMap.set(wcId, initialRoot);
  }

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else if (!app.isPackaged && process.env.NODE_ENV === 'development') {
    void win.loadURL('http://localhost:5173');
  } else if (!app.isPackaged) {
    void isLocalPortOpen(5173).then((running) => {
      if (win.isDestroyed()) return;
      if (running) {
        void win.loadURL('http://localhost:5173');
      } else {
        void win.loadFile(path.join(__dirname, '../../dist/index.html'));
      }
    });
  } else {
    void win.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  win.on('closed', () => {
    windowInitialRootMap.delete(wcId);
  });
}

app.setAppUserModelId('com.venkat.git-multi-repo-viewer');

app.whenReady().then(() => {
  ipcMain.handle('workspace:pickFolder', async (e) => {
    const parentWin = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const res = parentWin
      ? await dialog.showOpenDialog(parentWin, {
          properties: ['openDirectory'],
          title: 'Select Workspace Root Folder'
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory'],
          title: 'Select Workspace Root Folder'
        });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle(
    'workspace:openRootInNewWindow',
    async (_e, targetRoot: string) => {
      if (targetRoot) {
        createWindow(targetRoot);
      }
    }
  );

  ipcMain.handle('workspace:getInitialRoot', async (e) => {
    const explicit = windowInitialRootMap.get(e.sender.id);
    if (explicit) {
      return { rootPath: explicit, isExplicit: true };
    }
    const cliArg = app.isPackaged ? process.argv[1] : process.argv[2];
    if (cliArg && cliArg !== '.' && fs.existsSync(cliArg)) {
      return { rootPath: cliArg, isExplicit: true };
    }
    const suggested = 'd:\\Venkat\\Apps';
    if (fs.existsSync(suggested)) {
      return { rootPath: suggested, isExplicit: false };
    }
    return { rootPath: process.cwd(), isExplicit: false };
  });

  ipcMain.handle('workspace:scan', async (_e, rootPath: string) => {
    return scanWorkspace(rootPath);
  });

  ipcMain.handle('workspace:watch', async () => {
    // Periodic 15-second scan runs in renderer; kept as no-op for API compatibility.
  });

  ipcMain.handle(
    'repo:getCommits',
    async (_e, repo: Pick<RepoSummary, 'id' | 'name' | 'path'>, limit?: number) => {
      return getRepoCommits(repo, limit);
    }
  );

  ipcMain.handle(
    'repo:getCommitFiles',
    async (_e, repoPath: string, sha: string) => {
      return getCommitFiles(repoPath, sha);
    }
  );

  ipcMain.handle('repo:listFiles', async (_e, repoPath: string) => {
    return listRepoFiles(repoPath);
  });

  ipcMain.handle('repo:getRefs', async (_e, repoPath: string) => {
    return getRepoRefs(repoPath);
  });

  ipcMain.handle(
    'git:getDiff',
    async (_e, left: CompareSource, right: CompareSource) => {
      return getDiffContent(left, right);
    }
  );

  ipcMain.handle(
    'git:readFile',
    async (_e, repoPath: string, filePath: string) => {
      return readFileContent(repoPath, filePath);
    }
  );

  ipcMain.handle(
    'git:stage',
    async (_e, repoPath: string, paths: string[]) => {
      return stageFiles(repoPath, paths);
    }
  );

  ipcMain.handle(
    'git:unstage',
    async (_e, repoPath: string, paths: string[]) => {
      return unstageFiles(repoPath, paths);
    }
  );

  ipcMain.handle(
    'git:discard',
    async (
      _e,
      repoPath: string,
      paths: string[],
      untrackedPaths: string[]
    ) => {
      return discardFiles(repoPath, paths, untrackedPaths);
    }
  );

  ipcMain.handle(
    'git:commitAcrossRepos',
    async (_e, targets: CommitActionTarget[], message: string) => {
      return commitAcrossRepos(targets, message);
    }
  );

  ipcMain.handle(
    'theme:setSource',
    async (_e, source: 'system' | 'light' | 'dark') => {
      nativeTheme.themeSource = source;
      const bg = nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#f5f6f8';
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.setBackgroundColor(bg);
        }
      }
    }
  );

  ipcMain.handle(
    'shell:showInExplorer',
    async (_e, targetPath: string, isFile = false) => {
      if (!targetPath) return;
      const resolved = path.resolve(targetPath);
      if (isFile) {
        if (fs.existsSync(resolved)) {
          shell.showItemInFolder(resolved);
        } else {
          await shell.openPath(path.dirname(resolved));
        }
      } else {
        await shell.openPath(resolved);
      }
    }
  );

  ipcMain.handle('shell:openTerminal', async (_e, targetPath: string) => {
    if (!targetPath) return;
    const resolvedInput = path.resolve(targetPath);
    const resolvedDir =
      fs.existsSync(resolvedInput) && fs.statSync(resolvedInput).isDirectory()
        ? resolvedInput
        : path.dirname(resolvedInput);

    if (process.platform === 'win32') {
      const child = spawn('wt.exe', ['-d', resolvedDir], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      child.on('error', () => {
        const fallback = spawn(
          'cmd.exe',
          ['/c', 'start', '""', 'cmd.exe', '/K', `cd /d "${resolvedDir}"`],
          { detached: true, stdio: 'ignore', windowsHide: true }
        );
        fallback.unref();
      });
      child.unref();
    } else if (process.platform === 'darwin') {
      const child = spawn('open', ['-a', 'Terminal', resolvedDir], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    } else {
      const child = spawn('x-terminal-emulator', [], {
        cwd: resolvedDir,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    }
  });

  nativeTheme.on('updated', () => {
    const bg = nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#f5f6f8';
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.setBackgroundColor(bg);
      }
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
