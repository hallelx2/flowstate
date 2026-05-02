/**
 * Watches the agents directory for live-reload notifications.
 *
 * In dev that's `apps/desktop/src/agents/` (the bundled examples) and
 * in prod it's `~/.flowstate/agents/` (the user's installed agents).
 * `paths.agentsRoot()` resolves to the right one for the current build.
 *
 * On any add / change / unlink under the watched root, we debounce a
 * batch (FS often fires 2-3 events for a single save) and broadcast a
 * one-way `agents:changed` IPC message to every BrowserWindow. The
 * payload is a list of relative paths affected since the last fire so
 * the renderer can do a targeted reload instead of re-globbing the
 * whole tree.
 *
 * The watcher is the substrate for several upstream features:
 *   - M1: live-reload of in-app agent edits (no restart needed).
 *   - M2: trigger registry hooks into agent saves to register/unregister
 *     webhook / cron / watch listeners.
 *   - M3: agent-marketplace install lands a new file under the watched
 *     root, so the watcher is what surfaces newly-installed agents to
 *     the running renderer.
 *
 * Files outside the agents root (e.g. settings.json, MCP server defs)
 * each have their own watcher set elsewhere.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import { BrowserWindow } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { relative } from 'node:path';

import { agentsRoot } from './paths';

/** Event payload broadcast to renderers as `agents:changed`. */
export interface AgentsChangedEvent {
  /** Relative paths under agentsRoot() that changed since last fire. */
  paths: string[];
  /** Coarse classification — convenient for renderer logging. */
  kinds: Array<'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'>;
  /** Wall-clock stamp when the debounced fire ran. */
  ts: string;
}

/** ms — chokidar fires multiple events per save on some platforms. */
const DEBOUNCE_MS = 100;

let watcher: FSWatcher | null = null;
let pending: { paths: Set<string>; kinds: Set<AgentsChangedEvent['kinds'][number]> } | null = null;
let debounceTimer: NodeJS.Timeout | null = null;

/**
 * Start watching. Idempotent — calling twice is a no-op. Creates the
 * watched directory if it doesn't exist (so the watcher attaches even
 * for fresh installs with no agents yet).
 */
export function startAgentsWatcher(): void {
  if (watcher) return;

  const root = agentsRoot();
  if (!existsSync(root)) {
    try {
      mkdirSync(root, { recursive: true });
    } catch (err) {
      console.error(`[agents-watcher] failed to create ${root}:`, err);
      return;
    }
  }

  watcher = chokidar.watch(root, {
    // Don't fire for the existing tree on startup — only changes.
    ignoreInitial: true,
    // Cross-platform stability: poll on network shares, native otherwise.
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 },
    // Editor swap files / hidden artifacts shouldn't trigger reloads.
    ignored: [/(^|[/\\])\..*\.swp$/, /(^|[/\\])~\$/, /(^|[/\\])\.DS_Store$/],
  });

  for (const kind of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
    watcher.on(kind, (path) => {
      const rel = relative(root, path);
      if (!pending) pending = { paths: new Set(), kinds: new Set() };
      pending.paths.add(rel);
      pending.kinds.add(kind);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flushPending, DEBOUNCE_MS);
    });
  }

  watcher.on('error', (err) => {
    console.error('[agents-watcher] watcher error:', err);
  });
}

function flushPending(): void {
  if (!pending) return;
  const payload: AgentsChangedEvent = {
    paths: Array.from(pending.paths),
    kinds: Array.from(pending.kinds),
    ts: new Date().toISOString(),
  };
  pending = null;
  debounceTimer = null;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('agents:changed', payload);
  }
}

/** Stop watching. Idempotent. Call from `app.before-quit`. */
export async function stopAgentsWatcher(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (watcher) {
    try {
      await watcher.close();
    } catch {
      /* swallow */
    }
    watcher = null;
  }
  pending = null;
}
