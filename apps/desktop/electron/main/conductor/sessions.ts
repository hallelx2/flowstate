/**
 * Conductor session-id index.
 *
 * The Agent SDK persists its own conversation transcripts at
 * ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl. We just need to
 * remember which session id belongs to which workspace so that, on
 * relaunch, the home composer resumes the right thread.
 *
 * On-disk shape (one JSON file under conductorSessionsDir()):
 *   {
 *     <workspaceId>: {
 *       activeSessionId: string,
 *       threads: { id: string, title?: string, createdAt: string }[]
 *     },
 *     ...
 *   }
 *
 * Multi-thread is forward-compat — Phase 1 always operates on
 * `activeSessionId`. Forking lands in a later pass.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { conductorSessionsDir } from '../paths';

const INDEX_FILENAME = 'index.json';

interface ThreadEntry {
  id: string;
  title?: string;
  createdAt: string;
}

interface WorkspaceEntry {
  activeSessionId: string | null;
  threads: ThreadEntry[];
}

type SessionsIndex = Record<string, WorkspaceEntry>;

function indexPath(): string {
  return join(conductorSessionsDir(), INDEX_FILENAME);
}

async function readIndex(): Promise<SessionsIndex> {
  const path = indexPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, 'utf8')) as SessionsIndex;
  } catch {
    return {};
  }
}

async function writeIndex(idx: SessionsIndex): Promise<void> {
  const path = indexPath();
  const dir = dirname(path);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(idx, null, 2) + '\n', 'utf8');
  await rename(tmp, path);
}

/** Get the active session id for a workspace, or null if none. */
export async function getActiveSession(workspaceId: string): Promise<string | null> {
  const idx = await readIndex();
  return idx[workspaceId]?.activeSessionId ?? null;
}

/** List all threads for a workspace, most-recent first. */
export async function listThreads(workspaceId: string): Promise<ThreadEntry[]> {
  const idx = await readIndex();
  return idx[workspaceId]?.threads ?? [];
}

/**
 * Record a session id for a workspace. Creates a thread entry if the id
 * is new; otherwise just updates the active marker.
 */
export async function recordSession(
  workspaceId: string,
  sessionId: string,
  title?: string,
): Promise<void> {
  const idx = await readIndex();
  const entry: WorkspaceEntry = idx[workspaceId] ?? { activeSessionId: null, threads: [] };
  const existing = entry.threads.find((t) => t.id === sessionId);
  if (!existing) {
    entry.threads.unshift({
      id: sessionId,
      title,
      createdAt: new Date().toISOString(),
    });
  } else if (title && !existing.title) {
    existing.title = title;
  }
  entry.activeSessionId = sessionId;
  idx[workspaceId] = entry;
  await writeIndex(idx);
}

/** Switch the active thread for a workspace. */
export async function setActiveThread(
  workspaceId: string,
  sessionId: string,
): Promise<void> {
  const idx = await readIndex();
  const entry = idx[workspaceId];
  if (!entry) return;
  if (!entry.threads.some((t) => t.id === sessionId)) return;
  entry.activeSessionId = sessionId;
  idx[workspaceId] = entry;
  await writeIndex(idx);
}

/** Forget a thread (e.g. the user discarded it). */
export async function deleteThread(
  workspaceId: string,
  sessionId: string,
): Promise<void> {
  const idx = await readIndex();
  const entry = idx[workspaceId];
  if (!entry) return;
  entry.threads = entry.threads.filter((t) => t.id !== sessionId);
  if (entry.activeSessionId === sessionId) {
    entry.activeSessionId = entry.threads[0]?.id ?? null;
  }
  idx[workspaceId] = entry;
  await writeIndex(idx);
}
