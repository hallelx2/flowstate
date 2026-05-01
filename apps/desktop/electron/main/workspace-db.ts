/**
 * SQLite-backed workspace store.
 *
 * One database file per install — `flowstate.db` next to settings.json.
 *   Dev:  <projectRoot>/.flowstate/flowstate.db
 *   Prod: <userData>/flowstate.db
 *
 * Tables:
 *   workspaces  — one row per workspace, columns mirror Workspace IR
 *   app_state   — k/v scalar state (currently just `active_workspace_id`)
 *
 * Why SQLite (vs more JSON files): we want a real relational target for
 * runs / tool-events / approvals later, and keeping every persistence
 * layer hand-rolled around fs.rename loses transactional guarantees the
 * moment two writers touch the same file. Starting with workspaces gives
 * us the schema + migration discipline before runs land.
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import { join, resolve, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Workspace, WorkspaceInput } from '@flowstate/core';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const isDev = !app.isPackaged;

function dbPath(): string {
  if (isDev) {
    return resolve(__dirname, '..', '..', '..', '..', '.flowstate', 'flowstate.db');
  }
  return join(app.getPath('userData'), 'flowstate.db');
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const path = dbPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  db = new Database(path);
  // WAL keeps reads non-blocking while writes happen and survives crash
  // mid-write better than the rollback journal default.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  ensureDefaultWorkspace(db);
  return db;
}

/** Close the handle on app quit so WAL checkpoints flush cleanly. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function initSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      agents_dir     TEXT,
      runs_dir       TEXT,
      tools_dir      TEXT,
      model          TEXT,
      provider       TEXT,
      color          TEXT,
      created_at     TEXT NOT NULL,
      last_opened_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_workspaces_last_opened
      ON workspaces (last_opened_at DESC);

    CREATE TABLE IF NOT EXISTS app_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

/**
 * First-run seeding. We always want at least one workspace so the UI never
 * has to render an empty state for a logged-in user — "Default" gets
 * promoted to whatever the user names later.
 */
function ensureDefaultWorkspace(d: Database.Database): void {
  const count = d.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number };
  if (count.n > 0) return;
  const now = new Date().toISOString();
  const id = randomUUID();
  d.prepare(
    `INSERT INTO workspaces
       (id, name, agents_dir, runs_dir, tools_dir, model, provider, color, created_at, last_opened_at)
     VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)`,
  ).run(id, 'Default', 'claude-opus-4-7', 'subscription', '#9b60aa', now, now);
  d.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(
    'active_workspace_id',
    id,
  );
}

interface Row {
  id: string;
  name: string;
  agents_dir: string | null;
  runs_dir: string | null;
  tools_dir: string | null;
  model: string | null;
  provider: string | null;
  color: string | null;
  created_at: string;
  last_opened_at: string;
}

function rowToWorkspace(r: Row): Workspace {
  return {
    id: r.id,
    name: r.name,
    agentsDir: r.agents_dir,
    runsDir: r.runs_dir,
    toolsDir: r.tools_dir,
    model: r.model,
    provider: (r.provider as Workspace['provider']) ?? null,
    color: r.color,
    createdAt: r.created_at,
    lastOpenedAt: r.last_opened_at,
  };
}

export function listWorkspaces(): Workspace[] {
  const rows = getDb()
    .prepare('SELECT * FROM workspaces ORDER BY last_opened_at DESC')
    .all() as Row[];
  return rows.map(rowToWorkspace);
}

export function getWorkspace(id: string): Workspace | null {
  const r = getDb().prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Row | undefined;
  return r ? rowToWorkspace(r) : null;
}

export function getActiveWorkspaceId(): string | null {
  const row = getDb()
    .prepare(`SELECT value FROM app_state WHERE key = 'active_workspace_id'`)
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

export function getActiveWorkspace(): Workspace | null {
  const id = getActiveWorkspaceId();
  if (!id) return null;
  return getWorkspace(id);
}

export function createWorkspace(input: WorkspaceInput): Workspace {
  if (!input.name?.trim()) throw new Error('workspace name is required');
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO workspaces
         (id, name, agents_dir, runs_dir, tools_dir, model, provider, color, created_at, last_opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name.trim(),
      input.agentsDir ?? null,
      input.runsDir ?? null,
      input.toolsDir ?? null,
      input.model ?? null,
      input.provider ?? null,
      input.color ?? null,
      now,
      now,
    );
  const ws = getWorkspace(id);
  if (!ws) throw new Error('workspace insert succeeded but read failed');
  return ws;
}

const PATCH_COLUMNS: Record<keyof WorkspaceInput, string> = {
  name: 'name',
  agentsDir: 'agents_dir',
  runsDir: 'runs_dir',
  toolsDir: 'tools_dir',
  model: 'model',
  provider: 'provider',
  color: 'color',
};

export function updateWorkspace(
  id: string,
  patch: Partial<WorkspaceInput>,
): Workspace | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(PATCH_COLUMNS)) {
    const v = (patch as Record<string, unknown>)[key];
    if (v === undefined) continue;
    fields.push(`${col} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return getWorkspace(id);
  values.push(id);
  getDb()
    .prepare(`UPDATE workspaces SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
  return getWorkspace(id);
}

/**
 * Refuses to delete the last workspace — the UI can never end up in a
 * state where there's no active workspace to render.
 */
export function deleteWorkspace(id: string): boolean {
  const d = getDb();
  const all = listWorkspaces();
  if (all.length <= 1) {
    throw new Error('Cannot delete the last workspace');
  }
  const result = d.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  if (result.changes === 0) return false;

  // Re-point active to the most recently opened survivor if we just
  // deleted the active one.
  const activeId = getActiveWorkspaceId();
  if (activeId === id) {
    const next = listWorkspaces()[0];
    if (next) {
      d.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(
        'active_workspace_id',
        next.id,
      );
    }
  }
  return true;
}

export function switchWorkspace(id: string): Workspace | null {
  const ws = getWorkspace(id);
  if (!ws) return null;
  const now = new Date().toISOString();
  const d = getDb();
  d.prepare('UPDATE workspaces SET last_opened_at = ? WHERE id = ?').run(now, id);
  d.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(
    'active_workspace_id',
    id,
  );
  return getWorkspace(id);
}
