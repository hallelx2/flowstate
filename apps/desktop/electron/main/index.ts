import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import {
  SettingsSchema,
  checkPermissions,
  mergeSettings,
  type Settings,
} from '@flowstate/core';
import { runAgent, type RuntimeRunRequest } from './agent-runtime';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const isDev = !app.isPackaged;

/** Track in-flight runs so we can cancel via IPC. */
const inFlight = new Map<string, AbortController>();

/**
 * Pending permission requests, keyed by toolUseID. The SDK's canUseTool
 * callback returns a Promise; we hold its resolver here while we round-trip
 * through the renderer for human approval.
 */
const pendingApprovals = new Map<string, (result: PermissionResult) => void>();

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

/**
 * Where settings.json lives.
 *
 * Dev: the project's `.flowstate/settings.json` so config changes round-trip
 *      through git and stay reviewable while developing.
 * Prod: <userData>/settings.json — standard OS app-data location.
 */
function settingsPath(): string {
  if (isDev) {
    // out/main/index.js -> .flowstate/settings.json
    return resolve(__dirname, '..', '..', '..', '..', '.flowstate', 'settings.json');
  }
  return join(app.getPath('userData'), 'settings.json');
}

/**
 * Read + validate settings.json. Returns an empty object if the file
 * doesn't exist or fails to parse — the caller (renderer settings store)
 * fills in defaults via withDefaults().
 */
async function readSettingsFile(): Promise<Settings> {
  const path = settingsPath();
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, 'utf8');
    const json = JSON.parse(raw) as unknown;
    const parsed = SettingsSchema.safeParse(json);
    if (parsed.success) return parsed.data;
    console.warn('[settings] schema validation failed; ignoring file', parsed.error.issues);
    return {};
  } catch (err) {
    console.warn('[settings] failed to read', err);
    return {};
  }
}

/**
 * Atomic write — write to a temp file in the same directory, then rename.
 * Stops a half-written settings.json from being read on the next launch.
 */
async function writeSettingsFile(settings: Settings): Promise<void> {
  const path = settingsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  await rename(tmp, path);
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

    // Build a canUseTool callback with two layers:
    //   1. Pure permission gate (denies hard-violations without prompting)
    //   2. HITL banner (asks the human when policy says ask)
    const canUseTool: NonNullable<RuntimeRunRequest['canUseTool']> = async (
      toolName,
      input,
      options,
    ) => {
      // Layer 1: declared permission gate (incl. bash command allowlist)
      const decision = checkPermissions(
        toolName,
        input,
        req.permissions,
        req.guardrails,
        req.bashAllowPatterns,
      );
      if (decision.decision === 'deny') {
        return {
          behavior: 'deny',
          message: decision.reason ?? 'Denied by agent policy',
        };
      }

      // Layer 2: HITL banner. Either policy explicitly requires approval,
      // or permissionMode is "default" (the SDK's normal prompt flow).
      // permissionMode 'bypassPermissions' skips the banner UNLESS the
      // tool was on the approvalRequired list.
      const mustAsk =
        decision.decision === 'requires_approval' ||
        req.guardrails?.permissionMode !== 'bypassPermissions';

      if (!mustAsk) {
        return { behavior: 'allow' };
      }

      return new Promise<PermissionResult>((resolveResult) => {
        pendingApprovals.set(options.toolUseID, resolveResult);
        event.sender.send('agent:approval-request', {
          runId: req.runId,
          toolUseID: options.toolUseID,
          toolName,
          input,
          title: options.title,
          displayName: options.displayName,
          description: options.description,
          decisionReason: options.decisionReason ?? decision.reason,
          blockedPath: options.blockedPath,
        });
      });
    };

    try {
      await runAgent({ ...req, abortSignal: controller.signal, canUseTool }, (ev) => {
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

  /**
   * The renderer calls this when the user clicks Approve / Deny on the
   * approval banner. We resolve the SDK's pending Promise with the
   * appropriate PermissionResult shape.
   */
  ipcMain.handle(
    'agent:approval-response',
    (
      _event,
      payload: { toolUseID: string; approved: boolean; message?: string },
    ): boolean => {
      const resolver = pendingApprovals.get(payload.toolUseID);
      if (!resolver) return false;
      resolver(
        payload.approved
          ? { behavior: 'allow' }
          : { behavior: 'deny', message: payload.message ?? 'Denied by user' },
      );
      pendingApprovals.delete(payload.toolUseID);
      return true;
    },
  );

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

  // ─── Settings persistence ─────────────────────────────────────────────
  // Renderer reads once on boot via `settings:read` (returns the parsed
  // file or {} if absent). Subsequent updates patch through `settings:write`
  // — the main process merges with the on-disk version so concurrent writes
  // from different windows don't clobber each other.

  ipcMain.handle('settings:read', async (): Promise<Settings> => readSettingsFile());

  ipcMain.handle(
    'settings:write',
    async (_e, patch: Partial<Settings>): Promise<Settings> => {
      const current = await readSettingsFile();
      const next = mergeSettings(current, patch);
      const validated = SettingsSchema.safeParse(next);
      if (!validated.success) {
        const msg = validated.error.issues.map((i) => i.message).join('; ');
        throw new Error(`Settings validation failed: ${msg}`);
      }
      await writeSettingsFile(validated.data);
      return validated.data;
    },
  );

  ipcMain.handle('settings:path', (): string => settingsPath());

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
