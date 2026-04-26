import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { runAgent, type RuntimeRunRequest } from './agent-runtime';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const isDev = !app.isPackaged;

/** Track in-flight runs so we can cancel via IPC. */
const inFlight = new Map<string, AbortController>();

/**
 * Where agent files live on disk.
 *
 * Dev: the source directory `apps/desktop/src/agents/` so writes round-trip
 *      through vite HMR (you'll see the change reflect immediately).
 * Prod: <userData>/agents/ — the canonical user directory once packaged.
 */
function agentsRoot(): string {
  if (isDev) {
    // out/main/index.js -> apps/desktop/src/agents
    return resolve(__dirname, '..', '..', 'src', 'agents');
  }
  return join(app.getPath('userData'), 'agents');
}

/** Resolve a vite-style relative path (./foo/bar.md) into an absolute fs path,
 *  rejecting any attempt to break out of the agents root via `..`. */
function resolveAgentPath(relPath: string): string {
  // Strip leading ./ that vite glob keys carry
  const cleaned = relPath.replace(/^\.\//, '');
  const abs = normalize(join(agentsRoot(), cleaned));
  const root = agentsRoot();
  if (!abs.startsWith(root + sep) && abs !== root) {
    throw new Error(`Path "${relPath}" escapes the agents root`);
  }
  return abs;
}

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

  // ─── Agent file persistence ───────────────────────────────────────────
  // Dev: writes round-trip through vite HMR (you see the change reflect
  // immediately). Prod: writes go to <userData>/agents/.

  ipcMain.handle('agent:read', async (_e, relPath: string): Promise<string> => {
    const abs = resolveAgentPath(relPath);
    return readFile(abs, 'utf8');
  });

  ipcMain.handle(
    'agent:write',
    async (_e, payload: { relPath: string; content: string }): Promise<{ path: string }> => {
      const abs = resolveAgentPath(payload.relPath);
      // Ensure parent directories exist (e.g. ./refund-handler/steps/05-new.md)
      const parent = abs.substring(0, abs.lastIndexOf(sep));
      if (!existsSync(parent)) await mkdir(parent, { recursive: true });
      await writeFile(abs, payload.content, 'utf8');
      return { path: payload.relPath };
    },
  );

  ipcMain.handle('agent:root', (): string => agentsRoot());

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
