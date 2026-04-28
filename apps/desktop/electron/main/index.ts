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
 * Where installed MCP server defs live.
 *
 * One JSON file per server (`<id>.json`) so users can hand-edit a single
 * entry without deserializing the whole catalogue. Files written here are
 * picked up by the runtime registry on next agent run.
 */
/**
 * Disk-backed cache for the registry fetch-all result. Two reasons:
 *
 *   1. Pulling the whole official registry is ~30 paginated round-trips.
 *      Doing that on every Marketplace tab open is wasteful (and slow on
 *      cold connections).
 *   2. Offline browsing — once cached, users can scroll the catalogue
 *      and search across it even without network.
 *
 * TTL is 6h; the renderer can force a refresh via `force: true`.
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

function marketplaceCacheDir(): string {
  if (isDev) {
    return resolve(__dirname, '..', '..', '..', '..', '.flowstate', 'mcp-cache');
  }
  return join(app.getPath('userData'), 'mcp-cache');
}

function marketplaceCachePath(source: MarketplaceSourceId): string {
  return join(marketplaceCacheDir(), `${source}.json`);
}

function installedMcpDir(): string {
  if (isDev) {
    return resolve(__dirname, '..', '..', '..', '..', '.flowstate', 'tools', 'mcp');
  }
  return join(app.getPath('userData'), 'tools', 'mcp');
}

/**
 * Where the encrypted-at-rest secrets keychain lives. Stored separately
 * from settings.json because the values are sensitive — kept out of git
 * even in dev (added to .gitignore).
 *
 * Format: { "<NAME>": "<base64-of-electron-safeStorage-cipher>" }
 * Falls back to plaintext on platforms that don't support safeStorage,
 * with a console warning. The renderer never sees decrypted values.
 */
function secretsPath(): string {
  if (isDev) {
    return resolve(__dirname, '..', '..', '..', '..', '.flowstate', 'secrets.json');
  }
  return join(app.getPath('userData'), 'secrets.json');
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
