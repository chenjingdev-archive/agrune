import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { resolveArtifactFile } from './main/artifact-open';
import { StudioController, resolveDefaultWorkspaceRoot } from './main/studio-controller';
import type {
  BrowserHistoryAction,
  OpenArtifactRequest,
  RunScenarioRequest,
  SaveScenarioRequest,
} from './shared/contracts';

if (started) app.quit();

let mainWindow: BrowserWindow | null = null;
let controller: StudioController | null = null;

if (!app.isPackaged && process.env.AGRUNE_STUDIO_E2E === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9229');
}

function configurePlaywrightBrowserPath(): void {
  const browserPath = app.isPackaged
    ? path.join(process.resourcesPath, '.local-browsers')
    : path.join(app.getAppPath(), 'node_modules', 'playwright-core', '.local-browsers');
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
}

function emit(channel: string, value: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
}

function getController(): StudioController {
  if (!controller) throw new Error('Studio controller is not ready');
  return controller;
}

function defaultWorkspaceRoot(): string {
  return resolveDefaultWorkspaceRoot({
    isPackaged: app.isPackaged,
    requested: process.env.AGRUNE_STUDIO_WORKSPACE,
    appPath: app.getAppPath(),
    homePath: app.getPath('home'),
    userDataPath: app.getPath('userData'),
    pathExists: existsSync,
  });
}

function isOpenArtifactRequest(value: unknown): value is OpenArtifactRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<OpenArtifactRequest>;
  return typeof candidate.path === 'string' && (candidate.mode === 'open' || candidate.mode === 'reveal');
}

function registerIpc(): void {
  ipcMain.handle('studio:get-state', () => getController().getState());
  ipcMain.handle('studio:choose-workspace', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Open Agrune workspace',
      properties: ['openDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    return result.canceled || !selected ? getController().getState() : getController().openWorkspace(selected);
  });
  ipcMain.handle('studio:open-workspace', (_event, workspacePath: string) => getController().openWorkspace(workspacePath));
  ipcMain.handle('studio:navigate', (_event, url: string) => getController().navigate(url));
  ipcMain.handle('studio:history', (_event, action: BrowserHistoryAction) => getController().history(action));
  ipcMain.handle('studio:select-scenario', (_event, scenarioKey: string) => getController().selectScenario(scenarioKey));
  ipcMain.handle('studio:save-scenario', (_event, request: SaveScenarioRequest) => getController().saveScenario(request));
  ipcMain.handle('studio:run', (_event, request: RunScenarioRequest) => getController().runScenario(request));
  ipcMain.handle('studio:pause', () => getController().pauseRun());
  ipcMain.handle('studio:resume', () => getController().resumeRun());
  ipcMain.handle('studio:step', (_event, request: RunScenarioRequest) => getController().stepRun(request));
  ipcMain.handle('studio:stop', () => getController().stopRun());
  ipcMain.handle('studio:show-browser', () => getController().showBrowser());
  ipcMain.handle('studio:highlight-target', (_event, targetRef: string) => getController().highlightTarget(targetRef));
  ipcMain.handle('studio:open-artifact', async (_event, request: unknown) => {
    if (!isOpenArtifactRequest(request)) throw new Error('Invalid artifact open request');

    const before = getController().getState().workspace;
    const artifactPath = await resolveArtifactFile({
      workspaceRoot: before.path,
      artifactDir: before.artifactDir,
      candidatePath: request.path,
    });

    // Do not open a file if a concurrent workspace switch made the validation
    // result stale while real paths were being resolved.
    const after = getController().getState().workspace;
    if (after.path !== before.path || after.artifactDir !== before.artifactDir) {
      throw new Error('Artifact cannot be opened because the workspace changed');
    }

    if (request.mode === 'reveal') {
      shell.showItemInFolder(artifactPath);
      return;
    }

    const errorMessage = await shell.openPath(artifactPath);
    if (errorMessage) throw new Error(`Artifact could not be opened: ${errorMessage}`);
  });
  ipcMain.handle('studio:refresh', () => getController().refresh());
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#10120f',
    title: 'Agrune Studio',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = MAIN_WINDOW_VITE_DEV_SERVER_URL || `file://${path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)}`;
    if (!url.startsWith(allowed)) event.preventDefault();
  });

  controller = new StudioController((state) => emit('studio:state', state), {
    defaultWorkspaceRoot: defaultWorkspaceRoot(),
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  await controller.initialize();
}

configurePlaywrightBrowserPath();
registerIpc();

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('before-quit', () => {
  void controller?.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
