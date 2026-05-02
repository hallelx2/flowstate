/**
 * Single source of truth for on-disk locations.
 *
 * Both the IPC handlers in index.ts and the Conductor's in-process tools
 * touch the same paths — keeping the resolution here avoids drift between
 * the two callers and makes dev / prod overrides easy to reason about.
 */

import { app } from 'electron';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const isDev = !app.isPackaged;

/** Where agent .md / .yaml files live. */
export function agentsRoot(): string {
  if (isDev) {
    return resolve(__dirname, '..', '..', 'src', 'agents');
  }
  return join(app.getPath('userData'), 'agents');
}

/** Where the encrypted secrets keychain lives. */
export function secretsPath(): string {
  if (isDev) {
    return resolve(__dirname, '..', '..', '..', '..', '.flowstate', 'secrets.json');
  }
  return join(app.getPath('userData'), 'secrets.json');
}

/** Where settings.json lives. */
export function settingsPath(): string {
  if (isDev) {
    return resolve(__dirname, '..', '..', '..', '..', '.flowstate', 'settings.json');
  }
  return join(app.getPath('userData'), 'settings.json');
}

/** Where installed MCP server defs live (one .json per server). */
export function installedMcpDir(): string {
  if (isDev) {
    return resolve(__dirname, '..', '..', '..', '..', '.flowstate', 'tools', 'mcp');
  }
  return join(app.getPath('userData'), 'tools', 'mcp');
}

/** Disk-backed cache for the marketplace registry fetch-all result. */
export function marketplaceCacheDir(): string {
  if (isDev) {
    return resolve(__dirname, '..', '..', '..', '..', '.flowstate', 'mcp-cache');
  }
  return join(app.getPath('userData'), 'mcp-cache');
}

/** Per-window Conductor session id index — JSONL keyed by workspaceId. */
export function conductorSessionsDir(): string {
  if (isDev) {
    return resolve(__dirname, '..', '..', '..', '..', '.flowstate', 'conductor-sessions');
  }
  return join(app.getPath('userData'), 'conductor-sessions');
}

/** Audit log of every Conductor tool call. */
export function conductorAuditDir(): string {
  if (isDev) {
    return resolve(__dirname, '..', '..', '..', '..', '.flowstate', 'conductor-audit');
  }
  return join(app.getPath('userData'), 'conductor-audit');
}

/** Pre-compaction transcript archive — preserves full history before SDK truncates. */
export function conductorArchiveDir(): string {
  if (isDev) {
    return resolve(__dirname, '..', '..', '..', '..', '.flowstate', 'conductor-archive');
  }
  return join(app.getPath('userData'), 'conductor-archive');
}

/** Per-run JSONL journals — one file per run, append-only. */
export function runJournalsDir(): string {
  if (isDev) {
    return resolve(__dirname, '..', '..', '..', '..', '.flowstate', 'runs');
  }
  return join(app.getPath('userData'), 'runs');
}
