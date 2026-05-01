import { app, BrowserWindow, safeStorage, shell, ipcMain } from 'electron';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import {
  STARTER_CLI_FAMILIES,
  SettingsSchema,
  checkPermissions,
  dedupeById,
  fetchMarketplace,
  fetchMarketplaceAll,
  findCliFamily,
  mergeSettings,
  sortByQuality,
  type FetchResult,
  type MarketplaceSourceId,
  type McpServerDef,
  type RegistryFetcher,
  type Settings,
  type Workspace,
  type WorkspaceInput,
} from '@flowstate/core';
import { runAgent, type RuntimeRunRequest } from './agent-runtime';
import {
  bashAllowPatternsFromTools,
  loadInstalledMcpDefs,
  readApiKey,
  resolveAgentMcpServers,
  type RunAgentRequest,
} from './agent-orchestrator';
import {
  ConductorRuntime,
  type ConductorEvent,
  type ConductorRendererBridge,
} from './conductor/runtime';
import { listThreads, deleteThread, setActiveThread } from './conductor/sessions';
import { runStoreMain } from './run-registry';
import {
  closeDb,
  createWorkspace,
  deleteWorkspace,
  getActiveWorkspace,
  listWorkspaces,
  switchWorkspace,
  updateWorkspace,
} from './workspace-db';

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

// Filesystem paths live in ./paths so the IPC handlers here and the
// Conductor's in-process tools touch the exact same locations.
import {
  agentsRoot,
  installedMcpDir,
  marketplaceCacheDir,
  secretsPath,
  settingsPath,
} from './paths';

/**
 * Disk-backed cache for the marketplace registry fetch-all result.
 * Pulling the whole registry is ~30 paginated round-trips, and offline
 * browsing is a usability win — TTL is 6h; renderer can force a refresh.
 */
const MARKETPLACE_TTL_MS = 6 * 60 * 60 * 1000;

/** Bump when McpServerDef gains/loses fields so older cache files get invalidated. */
const MARKETPLACE_CACHE_SCHEMA = 3;

interface MarketplaceCacheFile {
  schema?: number;
  source: MarketplaceSourceId;
  fetchedAt: string;
  servers: McpServerDef[];
}

function marketplaceCachePath(source: MarketplaceSourceId): string {
  return join(marketplaceCacheDir(), `${source}.json`);
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

/**
 * Resolve the OS window icon. Electron only accepts raster (.png/.ico),
 * not SVG, so we look for a flowstate-shipped icon next to the app.
 *
 * Lookup order — first match wins, all paths optional:
 *   1. resources/icon.{ico,png}  (production package extra-resources)
 *   2. public/icon.{ico,png}     (dev bundle from Vite's static dir)
 *
 * Falls through to `undefined` (Electron default) if none exist — that's
 * the behaviour you'd see today before any raster icon is added.
 */
function resolveWindowIcon(): string | undefined {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    // ICO is the canonical Windows icon format; PNG works too on modern Electron.
    candidates.push(
      join(process.resourcesPath ?? '', 'icon.ico'),
      resolve(__dirname, '..', '..', 'resources', 'icon.ico'),
      resolve(__dirname, '..', '..', 'public', 'icon.ico'),
      resolve(__dirname, '..', '..', 'public', 'icon.png'),
    );
  } else {
    candidates.push(
      join(process.resourcesPath ?? '', 'icon.png'),
      resolve(__dirname, '..', '..', 'resources', 'icon.png'),
      resolve(__dirname, '..', '..', 'public', 'icon.png'),
    );
  }
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

function createMainWindow(): BrowserWindow {
  const icon = resolveWindowIcon();
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#FFFFFF',
    ...(icon ? { icon } : {}),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform !== 'darwin'
        ? { color: '#FFFFFF', symbolColor: '#000000', height: 36 }
        : undefined,
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      // electron-vite outputs ESM (.mjs) for the preload bundle. Pointing at
      // .js silently fails to load the preload, which leaves window.flowstate
      // undefined in the renderer — every IPC call then fails.
      preload: join(__dirname, '../preload/index.mjs'),
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

// AppUserModelId — without this, Windows shows our taskbar entry as
// "Electron" (the dev binary's own model id). Setting our own id makes
// the taskbar pin survive across launches AND lets the OS associate the
// jump list, notifications, and icon with flowstate specifically.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.flowstate.desktop');
}

// ─── Conductor state (one runtime per BrowserWindow webContents id) ─────
// The Conductor is intentionally per-window so multiple windows can each
// have their own resumable thread; in practice the app uses one window.

interface ConductorPending {
  approvals: Map<string, (decision: { approved: boolean; reason?: string }) => void>;
  userInputs: Map<string, (answer: string) => void>;
  userInputErrors: Map<string, (err: Error) => void>;
}
const conductors = new Map<number, ConductorRuntime>();
/** Promise tracker for in-flight `conductor:start` calls — dedupes concurrent starts. */
const conductorStarting = new Map<number, Promise<{ ok: true }>>();
const conductorPending = new Map<number, ConductorPending>();

function pendingForWebContents(id: number): ConductorPending {
  let p = conductorPending.get(id);
  if (!p) {
    p = {
      approvals: new Map(),
      userInputs: new Map(),
      userInputErrors: new Map(),
    };
    conductorPending.set(id, p);
  }
  return p;
}

/**
 * Tear down everything tied to a webContents id. Pending approval +
 * userInput promises are rejected so the SDK doesn't hang forever waiting
 * on a closed window. Called on `webContents.destroyed` and on uninstall.
 */
async function destroyConductor(wcId: number): Promise<void> {
  const runtime = conductors.get(wcId);
  conductors.delete(wcId);
  conductorStarting.delete(wcId);
  const pending = conductorPending.get(wcId);
  conductorPending.delete(wcId);
  if (pending) {
    for (const resolver of pending.approvals.values()) {
      resolver({ approved: false, reason: 'window closed' });
    }
    for (const resolver of pending.userInputs.values()) {
      resolver(''); // best-effort — let the tool surface "" as a no-input
    }
    for (const reject of pending.userInputErrors.values()) {
      reject(new Error('window closed'));
    }
    pending.approvals.clear();
    pending.userInputs.clear();
    pending.userInputErrors.clear();
  }
  if (runtime) {
    try {
      await runtime.close();
    } catch {
      // Closing a half-started runtime can throw — swallow.
    }
  }
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

  ipcMain.handle('agent:run', async (event, req: RunAgentRequest) => {
    const controller = new AbortController();
    inFlight.set(req.runId, controller);

    // Inject the user's stored API key into env BEFORE the SDK reads it.
    // The SDK's auth resolution order checks ANTHROPIC_API_KEY first, so
    // this lets the keychain take precedence over whatever was inherited
    // from the launching shell. We restore on completion.
    const previousApiKey = process.env['ANTHROPIC_API_KEY'];
    const userApiKey = await readApiKey();
    if (userApiKey) process.env['ANTHROPIC_API_KEY'] = userApiKey;

    // Resolve mcp:* refs to SDK config, injecting secrets from keychain.
    const mcp = await resolveAgentMcpServers(req.agentTools ?? []);
    if (mcp.missingSecrets.length > 0) {
      console.warn(
        `[agent:run] missing secrets — agent may fail at tool-use time:`,
        mcp.missingSecrets,
      );
    }
    const bashAllowPatterns = bashAllowPatternsFromTools(req.agentTools ?? []);

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
        bashAllowPatterns,
      );
      if (decision.decision === 'deny') {
        return {
          behavior: 'deny',
          message: decision.reason ?? 'Denied by agent policy',
        };
      }

      // Layer 2: HITL banner. Ask when policy says ask, OR when the agent
      // is in permissionMode 'default' (SDK's normal prompt flow). The
      // 'acceptEdits' / 'plan' / 'bypassPermissions' modes are explicit
      // opt-outs from the per-call prompt — the gate's allow above already
      // verified the call is policy-safe, so let it through.
      const mode = req.guardrails?.permissionMode ?? 'default';
      const mustAsk = decision.decision === 'requires_approval' || mode === 'default';

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
      const runtimeReq: RuntimeRunRequest = {
        runId: req.runId,
        prompt: req.prompt,
        agentSystemPrompt: req.agentSystemPrompt,
        allowedTools: req.allowedTools,
        cwd: req.cwd,
        model: req.model,
        permissions: req.permissions,
        guardrails: req.guardrails,
        budget: req.budget,
        bashAllowPatterns,
        mcpServers: mcp.sdkServers,
        abortSignal: controller.signal,
        canUseTool,
      };
      await runAgent(runtimeReq, (ev) => {
        event.sender.send('agent:event', ev);
      });
    } finally {
      inFlight.delete(req.runId);
      // Restore env so subsequent runs see the original shell-inherited value.
      if (previousApiKey == null) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = previousApiKey;
    }
  });

  // ─── Self-test: smoke-test the SDK reachability ────────────────────────
  // Renderer calls this from Settings → "Test connection". We send a tiny
  // prompt with no tools so it returns in seconds. Result tells the UI
  // whether auth is set + the SDK is reachable, without spinning up MCP
  // servers or running anything destructive.
  ipcMain.handle(
    'agent:selftest',
    async (): Promise<{
      ok: boolean;
      message: string;
      apiKeySource?: 'keychain' | 'env' | 'none';
      tokensIn?: number;
      tokensOut?: number;
      durationMs?: number;
    }> => {
      const previous = process.env['ANTHROPIC_API_KEY'];
      const stored = await readApiKey();
      let apiKeySource: 'keychain' | 'env' | 'none' = 'none';
      if (stored) {
        process.env['ANTHROPIC_API_KEY'] = stored;
        apiKeySource = 'keychain';
      } else if (previous) {
        apiKeySource = 'env';
      }

      const startedAt = Date.now();
      let tokensIn = 0;
      let tokensOut = 0;

      try {
        await runAgent(
          {
            runId: `selftest_${Date.now()}`,
            prompt: 'Reply with the single word "ok".',
            allowedTools: [],
            guardrails: { maxTurns: 1, disallowedTools: ['Bash', 'Write', 'Edit', 'Read'] },
            budget: { runtimeMs: 30_000 },
          },
          (ev) => {
            if (ev.type === 'step' && ev.step?.tokens) {
              tokensIn += ev.step.tokens.input;
              tokensOut += ev.step.tokens.output;
            }
          },
        );
        return {
          ok: true,
          message: 'SDK reachable, auth ok.',
          apiKeySource,
          tokensIn,
          tokensOut,
          durationMs: Date.now() - startedAt,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          message,
          apiKeySource,
          durationMs: Date.now() - startedAt,
        };
      } finally {
        if (previous == null) delete process.env['ANTHROPIC_API_KEY'];
        else process.env['ANTHROPIC_API_KEY'] = previous;
      }
    },
  );

  ipcMain.handle('agent:cancel', (_event, runId: string) => {
    const ctrl = inFlight.get(runId);
    if (ctrl) {
      ctrl.abort();
      inFlight.delete(runId);
      runStoreMain.setStatus(runId, 'cancelled');
      return true;
    }
    return false;
  });

  // ─── Conductor IPC ────────────────────────────────────────────────────
  // The Conductor is one long-lived `query()` per BrowserWindow. The
  // renderer talks to it through `conductor:send` (push a user turn) and
  // subscribes to `conductor:event` (one-way stream).

  ipcMain.handle('conductor:start', async (event): Promise<{ ok: true }> => {
    const wcId = event.sender.id;
    // Idempotent under concurrent calls: if a start is already in flight,
    // every caller awaits the same promise instead of racing into a
    // double-construction.
    if (conductors.has(wcId)) return { ok: true };
    const startInFlight = conductorStarting.get(wcId);
    if (startInFlight) return startInFlight;

    const startPromise = (async () => {
      // Workspace state must be fresh per call, not closed-over from
      // start(). The renderer can switch workspaces while the runtime is
      // alive; the bridge below re-resolves on every read.
      const wsForBootstrap = getActiveWorkspace();
      const workspaceId = wsForBootstrap?.id ?? 'default';

      const bridge: ConductorRendererBridge = {
        emit: (ev: ConductorEvent) => {
          if (event.sender.isDestroyed()) return;
          event.sender.send('conductor:event', ev);
        },
        requestApproval: (req) =>
          new Promise((resolve) => {
            const id =
              req.toolUseId ?? `appr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            pendingForWebContents(wcId).approvals.set(id, resolve);
            if (event.sender.isDestroyed()) {
              resolve({ approved: false, reason: 'window closed' });
              return;
            }
            event.sender.send('conductor:approval-request', {
              id,
              toolName: req.toolName,
              input: req.input,
            });
          }),
        requestUserInput: (prompt) =>
          new Promise((resolve, reject) => {
            const id = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const p = pendingForWebContents(wcId);
            p.userInputs.set(id, resolve);
            p.userInputErrors.set(id, reject);
            if (event.sender.isDestroyed()) {
              reject(new Error('window closed'));
              return;
            }
            event.sender.send('conductor:user-input-request', {
              id,
              question: prompt.question,
              placeholder: prompt.placeholder,
              secret: prompt.secret === true,
            });
          }),
        workspaceSnapshot: async () => {
          // Re-resolve every prompt — workspace switches during the
          // session must propagate. Same for the secret + run lists.
          const ws = getActiveWorkspace();
          const installedMcp = await loadInstalledMcpDefs();
          const populatedSecrets = await listSecretNames();
          return {
            workspaceName: ws?.name ?? null,
            cwd: ws?.agentsDir ?? null,
            installedMcpIds: installedMcp.map((d) => d.id),
            // CLI probes are expensive (3s timeout × N families) — leave
            // empty here; the probe_cli_family tool fetches on demand.
            cliFamiliesInstalled: [],
            populatedSecrets,
            recentRuns: runStoreMain.list().slice(0, 5).map((r) => ({
              id: r.id,
              agentName: r.agentName,
              status: r.status,
            })),
          };
        },
        activeWorkspace: () => {
          const ws = getActiveWorkspace();
          return ws
            ? { id: ws.id, name: ws.name, cwd: ws.agentsDir ?? undefined }
            : null;
        },
        listRuns: () => runStoreMain.list(),
        cancelRun: (id) => {
          // cancelRun in the registry aborts the controller; also fire
          // the inFlight map's controller (legacy agent:run path).
          const ctrl = inFlight.get(id);
          if (ctrl) {
            ctrl.abort();
            inFlight.delete(id);
          }
          return runStoreMain.cancel(id);
        },
        forwardInnerRunEvents: (runId, ev) => {
          if (event.sender.isDestroyed()) return;
          // Mirror to the regular agent:event stream so the existing
          // sdk-runner / runStore wiring picks it up unchanged.
          event.sender.send('agent:event', ev);
          const e = ev as { type?: string };
          if (e.type === 'started') runStoreMain.setStatus(runId, 'running');
          else if (e.type === 'completed') runStoreMain.setStatus(runId, 'completed');
          else if (e.type === 'failed') runStoreMain.setStatus(runId, 'failed');
        },
      };

      const runtime = new ConductorRuntime(workspaceId, bridge);
      conductors.set(wcId, runtime);
      await runtime.start();

      // Tear down on window close so we don't leak runtimes + pending promises.
      event.sender.once('destroyed', () => {
        void destroyConductor(wcId);
      });

      return { ok: true } as const;
    })();

    conductorStarting.set(wcId, startPromise);
    try {
      return await startPromise;
    } finally {
      conductorStarting.delete(wcId);
    }
  });

  ipcMain.handle(
    'conductor:send',
    (event, payload: { text: string }): { turnId: string } => {
      const runtime = conductors.get(event.sender.id);
      if (!runtime) throw new Error('Conductor not started for this window');
      const turnId = runtime.send(payload.text);
      return { turnId };
    },
  );

  ipcMain.handle('conductor:interrupt', async (event): Promise<boolean> => {
    const runtime = conductors.get(event.sender.id);
    if (!runtime) return false;
    await runtime.interrupt();
    return true;
  });

  ipcMain.handle(
    'conductor:set-permission-mode',
    async (event, mode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'): Promise<boolean> => {
      const runtime = conductors.get(event.sender.id);
      if (!runtime) return false;
      await runtime.setPermissionMode(mode);
      return true;
    },
  );

  ipcMain.handle(
    'conductor:approval-response',
    (event, payload: { id: string; approved: boolean; reason?: string }): boolean => {
      const p = pendingForWebContents(event.sender.id);
      const resolver = p.approvals.get(payload.id);
      if (!resolver) return false;
      resolver({ approved: payload.approved, reason: payload.reason });
      p.approvals.delete(payload.id);
      return true;
    },
  );

  ipcMain.handle(
    'conductor:user-input-response',
    (event, payload: { id: string; answer?: string; cancelled?: boolean }): boolean => {
      const p = pendingForWebContents(event.sender.id);
      if (payload.cancelled) {
        const reject = p.userInputErrors.get(payload.id);
        if (reject) reject(new Error('cancelled'));
      } else {
        const resolve = p.userInputs.get(payload.id);
        if (resolve) resolve(payload.answer ?? '');
      }
      p.userInputs.delete(payload.id);
      p.userInputErrors.delete(payload.id);
      return true;
    },
  );

  ipcMain.handle('conductor:list-threads', async () => {
    const ws = getActiveWorkspace();
    if (!ws) return [];
    return listThreads(ws.id);
  });

  ipcMain.handle('conductor:set-active-thread', async (_event, sessionId: string) => {
    const ws = getActiveWorkspace();
    if (!ws) return false;
    await setActiveThread(ws.id, sessionId);
    return true;
  });

  ipcMain.handle('conductor:delete-thread', async (_event, sessionId: string) => {
    const ws = getActiveWorkspace();
    if (!ws) return false;
    await deleteThread(ws.id, sessionId);
    return true;
  });

  // Helper: list secret names without going through the (renderer-only) IPC.
  async function listSecretNames(): Promise<string[]> {
    const path = secretsPath();
    if (!existsSync(path)) return [];
    try {
      const raw = await readFile(path, 'utf8');
      return Object.keys(JSON.parse(raw) as Record<string, string>);
    } catch {
      return [];
    }
  }

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

  // ─── Workspaces (SQLite-backed) ───────────────────────────────────────
  // The title-bar workspace switcher reads/writes through these. The DB
  // file lives next to settings.json (see workspace-db.ts). On first
  // launch a "Default" workspace is seeded so the UI always has a row
  // to render.

  ipcMain.handle('workspace:list', (): Workspace[] => listWorkspaces());

  ipcMain.handle('workspace:active', (): Workspace | null => getActiveWorkspace());

  ipcMain.handle(
    'workspace:create',
    (_e, input: WorkspaceInput): Workspace => createWorkspace(input),
  );

  ipcMain.handle(
    'workspace:update',
    (_e, payload: { id: string; patch: Partial<WorkspaceInput> }): Workspace | null =>
      updateWorkspace(payload.id, payload.patch),
  );

  ipcMain.handle(
    'workspace:switch',
    (_e, id: string): Workspace | null => switchWorkspace(id),
  );

  ipcMain.handle('workspace:delete', (_e, id: string): boolean => deleteWorkspace(id));

  // ─── MCP marketplace ──────────────────────────────────────────────────
  // Renderer asks main to fetch from the public registry (renderer can't
  // hit arbitrary network from a sandboxed BrowserWindow without CORS).
  // Installs land on disk under <userData>/tools/mcp/<id>.json so the
  // runtime registry picks them up automatically on next run.

  /** Adapter that hands core's pure marketplace fetcher a real fetch impl. */
  const httpFetcher: RegistryFetcher = async (url) => {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      return { ok: r.ok, json: () => r.json() };
    } catch (err) {
      console.warn('[marketplace] fetch failed', url, err);
      return null;
    }
  };

  ipcMain.handle(
    'marketplace:search',
    async (
      _e,
      params: {
        source?: MarketplaceSourceId;
        search?: string;
        cursor?: string;
        limit?: number;
      },
    ): Promise<FetchResult> => {
      const source = params.source ?? 'official';
      const result = await fetchMarketplace(source, httpFetcher, {
        search: params.search,
        cursor: params.cursor,
        limit: params.limit ?? 30,
      });
      console.log(
        `[marketplace] source=${source} q="${params.search ?? ''}" → ${
          result?.servers.length ?? 'NULL'
        } servers, ${result?.warnings.length ?? 0} warnings`,
      );
      if (result?.warnings && result.warnings.length > 0 && result.servers.length === 0) {
        // First few warnings make it easy to spot a normalizer regression.
        console.warn('[marketplace] all entries skipped — sample warnings:', result.warnings.slice(0, 3));
      }
      // Empty fallback so the renderer can render "no results / offline" instead of throwing.
      return (
        result ?? { source, servers: [], fetchedAt: new Date().toISOString(), warnings: ['network-failed'] }
      );
    },
  );

  ipcMain.handle('marketplace:list-installed', async (): Promise<McpServerDef[]> => {
    const dir = installedMcpDir();
    if (!existsSync(dir)) return [];
    const out: McpServerDef[] = [];
    const entries = await readdir(dir);
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(dir, name), 'utf8');
        out.push(JSON.parse(raw) as McpServerDef);
      } catch (err) {
        console.warn('[marketplace] skipping malformed install', name, err);
      }
    }
    return out;
  });

  ipcMain.handle(
    'marketplace:install',
    async (_e, def: McpServerDef): Promise<{ id: string; path: string }> => {
      if (!def?.id) throw new Error('install: server def missing id');
      const dir = installedMcpDir();
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      const path = join(dir, `${def.id}.json`);
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(def, null, 2) + '\n', 'utf8');
      await rename(tmp, path);
      return { id: def.id, path };
    },
  );

  ipcMain.handle('marketplace:uninstall', async (_e, id: string): Promise<boolean> => {
    const path = join(installedMcpDir(), `${id}.json`);
    if (!existsSync(path)) return false;
    await unlink(path);
    return true;
  });

  // ─── marketplace:fetch-all ────────────────────────────────────────────
  // Pulls every page from the registry under the hood, dedupes by id,
  // sorts A→Z, and caches the result on disk for 6h. While fetching,
  // emits `marketplace:progress` events so the renderer can show a
  // "Loaded N servers across P pages" indicator.

  ipcMain.handle(
    'marketplace:fetch-all',
    async (
      event,
      params: { source?: MarketplaceSourceId; force?: boolean },
    ): Promise<{
      source: MarketplaceSourceId;
      servers: McpServerDef[];
      fetchedAt: string;
      fromCache: boolean;
    }> => {
      const source = params.source ?? 'official';
      const cachePath = marketplaceCachePath(source);

      // 1. Try the disk cache first (unless force-refresh). Cache files
      //    written by an older McpServerDef shape get auto-invalidated via
      //    the schema check so quality/featured/verified fields populate
      //    on the next open.
      if (!params.force && existsSync(cachePath)) {
        try {
          const raw = await readFile(cachePath, 'utf8');
          const parsed = JSON.parse(raw) as MarketplaceCacheFile;
          const ageMs = Date.now() - new Date(parsed.fetchedAt).getTime();
          const schemaOk = parsed.schema === MARKETPLACE_CACHE_SCHEMA;
          if (
            schemaOk &&
            ageMs >= 0 &&
            ageMs < MARKETPLACE_TTL_MS &&
            Array.isArray(parsed.servers)
          ) {
            console.log(
              `[marketplace] cache hit for ${source} (${parsed.servers.length} servers, age ${(ageMs / 60000).toFixed(0)}m)`,
            );
            return {
              source,
              servers: parsed.servers,
              fetchedAt: parsed.fetchedAt,
              fromCache: true,
            };
          }
          if (!schemaOk) {
            console.log(`[marketplace] cache schema bump — refetching ${source}`);
          }
        } catch (err) {
          console.warn('[marketplace] cache read failed; refetching', err);
        }
      }

      // 2. Cold path — paginate through the live registry.
      console.log(`[marketplace] fetch-all live for ${source}`);
      const result = await fetchMarketplaceAll(
        source,
        httpFetcher,
        {},
        60,
        (loaded, page) => {
          event.sender.send('marketplace:progress', { source, loaded, page });
        },
      );

      // Default sort = quality-first, so the highest-signal servers
      // are what users see on the first page even before they touch
      // the sort dropdown. The renderer can re-sort client-side after.
      const servers = sortByQuality(dedupeById(result?.servers ?? []));
      const fetchedAt = result?.fetchedAt ?? new Date().toISOString();

      // 3. Persist to disk so the next open is instant.
      if (servers.length > 0) {
        try {
          if (!existsSync(marketplaceCacheDir())) {
            await mkdir(marketplaceCacheDir(), { recursive: true });
          }
          const file: MarketplaceCacheFile = {
            schema: MARKETPLACE_CACHE_SCHEMA,
            source,
            fetchedAt,
            servers,
          };
          const tmp = `${cachePath}.${process.pid}.tmp`;
          await writeFile(tmp, JSON.stringify(file), 'utf8');
          await rename(tmp, cachePath);
          console.log(`[marketplace] cached ${servers.length} ${source} servers to disk`);
        } catch (err) {
          console.warn('[marketplace] cache write failed', err);
        }
      }

      return { source, servers, fetchedAt, fromCache: false };
    },
  );

  // ─── Secrets keychain ─────────────────────────────────────────────────
  // Encrypted-at-rest via Electron safeStorage where supported. The
  // renderer can list NAMES (so the marketplace UI can show a green
  // checkmark when a server's required secrets are populated) but
  // never gets to read VALUES — those are only injected into MCP server
  // env at run time.

  type SecretsFile = Record<string, string>;

  async function readSecretsFile(): Promise<SecretsFile> {
    const path = secretsPath();
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(await readFile(path, 'utf8')) as SecretsFile;
    } catch {
      return {};
    }
  }

  async function writeSecretsFile(data: SecretsFile): Promise<void> {
    const path = secretsPath();
    const dir = dirname(path);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    await rename(tmp, path);
  }

  ipcMain.handle('secrets:list', async (): Promise<string[]> => {
    return Object.keys(await readSecretsFile());
  });

  ipcMain.handle(
    'secrets:set',
    async (_e, payload: { name: string; value: string }): Promise<boolean> => {
      const current = await readSecretsFile();
      const v = payload.value;
      // Encrypt where possible — fall back to plain b64 with a warning.
      let stored: string;
      if (safeStorage.isEncryptionAvailable()) {
        stored = `enc:${safeStorage.encryptString(v).toString('base64')}`;
      } else {
        console.warn('[secrets] encryption unavailable on this OS — storing plaintext');
        stored = `plain:${Buffer.from(v, 'utf8').toString('base64')}`;
      }
      current[payload.name] = stored;
      await writeSecretsFile(current);
      return true;
    },
  );

  ipcMain.handle('secrets:delete', async (_e, name: string): Promise<boolean> => {
    const current = await readSecretsFile();
    if (!(name in current)) return false;
    delete current[name];
    await writeSecretsFile(current);
    return true;
  });

  // ─── CLI tool family probes ───────────────────────────────────────────
  // Marketplace UI for CLI tools needs to know what's actually installed
  // on this machine. We shell out to the family's `versionProbe` with a
  // 3s timeout — anything slower is treated as not installed (better
  // than hanging the UI on a misbehaving binary).

  /**
   * Run a probe command with a hard timeout. Returns whether it succeeded
   * (exit 0) plus the trimmed stdout. Stderr is folded into `error` on
   * failure. Never throws.
   */
  async function runProbe(
    command: string,
    timeoutMs = 3000,
  ): Promise<{ ok: boolean; stdout?: string; error?: string }> {
    try {
      const { stdout } = await execAsync(command, {
        timeout: timeoutMs,
        windowsHide: true,
      });
      return { ok: true, stdout: stdout.toString().trim().slice(0, 500) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg.slice(0, 500) };
    }
  }

  // The CLI catalog ships in core. Looked up by id at request time so
  // future hot-reloaded catalogs (community additions in
  // `~/.flowstate/tools/cli/`) can take effect without restart.

  ipcMain.handle('cli:probe', async (_e, familyId: string) => {
    const family = findCliFamily(familyId);
    if (!family) return { installed: false, error: `unknown family "${familyId}"` };
    const r = await runProbe(family.versionProbe);
    return { installed: r.ok, version: r.stdout, error: r.error };
  });

  ipcMain.handle('cli:probe-all', async () => {
    const results: Record<string, { installed: boolean; version?: string }> = {};
    await Promise.all(
      STARTER_CLI_FAMILIES.map(async (family) => {
        const r = await runProbe(family.versionProbe);
        results[family.id] = { installed: r.ok, version: r.stdout };
      }),
    );
    return results;
  });

  ipcMain.handle('cli:auth-probe', async (_e, familyId: string) => {
    const family = findCliFamily(familyId);
    if (!family) return null;
    if (family.auth.kind === 'none') return { authenticated: true };
    if (!family.auth.probe) return null;
    const r = await runProbe(family.auth.probe, 5000);
    return { authenticated: r.ok, output: r.stdout };
  });

  /**
   * Spawn the auth command in a NEW terminal window so the user can
   * complete the interactive flow. Doesn't block the main process; we
   * return immediately and let the renderer poll cli:auth-probe to
   * detect completion. Per-OS spawn approach:
   *
   *   macOS    open -a Terminal -- <cmd>
   *   Windows  start cmd /k <cmd>
   *   Linux    x-terminal-emulator -e <cmd> (best effort)
   */
  ipcMain.handle('cli:run-auth', async (_e, familyId: string): Promise<boolean> => {
    const family = findCliFamily(familyId);
    if (!family || family.auth.kind !== 'command') return false;
    const cmd = family.auth.command;
    try {
      if (process.platform === 'darwin') {
        spawn('osascript', [
          '-e',
          `tell application "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"`,
        ], { detached: true, stdio: 'ignore' }).unref();
      } else if (process.platform === 'win32') {
        spawn('cmd.exe', ['/c', 'start', 'cmd', '/k', cmd], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        }).unref();
      } else {
        // Linux — best-effort. We invoke through `sh -c` so the chosen
        // terminal emulator can be replaced via $TERMINAL without us
        // needing to detect every distro's default.
        const term = process.env['TERMINAL'] ?? 'x-terminal-emulator';
        spawn(term, ['-e', cmd], { detached: true, stdio: 'ignore' }).unref();
      }
      return true;
    } catch (err) {
      console.warn('[cli] run-auth spawn failed', err);
      return false;
    }
  });

  /** Generic open-external bridge for install pages, docs, etc. */
  ipcMain.handle('flowstate:open-external', async (_e, url: string): Promise<void> => {
    // Whitelist http/https/mailto so we don't accidentally exec a file URL.
    if (!/^(https?|mailto):/i.test(url)) {
      throw new Error(`Refused to open non-http URL: ${url}`);
    }
    await shell.openExternal(url);
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Flush WAL + release the file handle so the next launch sees a clean db.
  closeDb();
});
