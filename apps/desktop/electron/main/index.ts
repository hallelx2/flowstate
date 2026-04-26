import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgent, type RuntimeRunRequest } from './agent-runtime';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const isDev = !app.isPackaged;

/** Track in-flight runs so we can cancel via IPC. */
const inFlight = new Map<string, AbortController>();

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#FFFFFF',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform !== 'darwin'
        ? { color: '#FFFFFF', symbolColor: '#000000', height: 36 }
        : undefined,
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    // DevTools stays closed by default — open with Ctrl+Shift+I / Cmd+Opt+I / F12
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  // ─── System info ──────────────────────────────────────────────────────
  ipcMain.handle('flowstate:platform', () => ({
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    node: process.versions.node,
    electron: process.versions.electron,
  }));

  // ─── Agent runtime IPC ────────────────────────────────────────────────
  // Renderer calls flowstate.runAgent({ runId, prompt, ... }) → main spawns
  // the SDK + streams events back via `agent:event`. Renderer adapts those
  // events into runStore mutations (see lib/sdk-runner.ts).

  ipcMain.handle('agent:run', async (event, req: RuntimeRunRequest) => {
    const controller = new AbortController();
    inFlight.set(req.runId, controller);
    try {
      await runAgent({ ...req, abortSignal: controller.signal }, (ev) => {
        event.sender.send('agent:event', ev);
      });
    } finally {
      inFlight.delete(req.runId);
    }
  });

  ipcMain.handle('agent:cancel', (_event, runId: string) => {
    const ctrl = inFlight.get(runId);
    if (ctrl) {
      ctrl.abort();
      inFlight.delete(runId);
      return true;
    }
    return false;
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
