/**
 * Per-run JSONL journals.
 *
 * One file per run at `<runJournalsDir>/<run-id>.jsonl`, append-only,
 * one JSON object per line. The first line is an `init` entry capturing
 * the metadata that lives on the runs row but isn't visible in the
 * runtime event stream (agentId, workspaceId, triggerKind, etc.). Every
 * subsequent line is the runtime event verbatim with a leading `ts`.
 *
 * Why JSONL on disk in addition to SQL:
 *   - Crash-safe replay. Every line lands on disk before the next event
 *     is processed; a process exit mid-run leaves a partial journal that
 *     replay tools can still read up to the last newline.
 *   - Size. Tool-result `output` payloads can be megabytes — bloating SQL
 *     run_steps with raw outputs would balloon the database. We index the
 *     metadata in SQL and keep the heavy bytes in JSONL.
 *   - Auditability. A flat append-only file is the format ops people
 *     reach for first; trivial to grep / pipe / archive.
 *
 * File handles are kept open per run (held in a Map) for write throughput,
 * and closed on terminal status. `closeAll()` runs on app quit so WAL-style
 * lingering opens don't fight the OS at shutdown.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import type { RuntimeEvent } from './agent-runtime';
import { runJournalsDir } from './paths';

/** Initial entry written when a run is registered. Captures non-event metadata. */
export interface JournalInitEntry {
  ts: string;
  type: 'init';
  runId: string;
  agentId: string;
  agentName: string;
  workspaceId: string | null;
  triggerKind: string | null;
  triggerPayload?: unknown;
}

/** Per-event entry — runtime event with a wall-clock stamp prepended. */
export interface JournalEventEntry extends RuntimeEvent {
  ts: string;
}

export type JournalEntry = JournalInitEntry | JournalEventEntry;

// ─── Handle pool ───────────────────────────────────────────────────────────

const handles = new Map<string, number>();

/** Resolve the on-disk path for a run's journal. */
export function journalPathFor(runId: string): string {
  return join(runJournalsDir(), `${runId}.jsonl`);
}

/**
 * Open (or reuse) the journal for a run and write the `init` entry.
 * Returns the absolute path so callers can stash it on the SQL row.
 * Idempotent — a second openJournal for the same id returns the same path
 * without writing another init line.
 */
export function openJournal(entry: Omit<JournalInitEntry, 'ts' | 'type'>): string {
  const path = journalPathFor(entry.runId);
  if (handles.has(entry.runId)) return path;

  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const fd = openSync(path, 'a');
  handles.set(entry.runId, fd);

  const init: JournalInitEntry = {
    ts: new Date().toISOString(),
    type: 'init',
    ...entry,
  };
  writeSync(fd, JSON.stringify(init) + '\n');
  return path;
}

/**
 * Append a runtime event. Lazy-opens the journal if it isn't open — the
 * lazy path is defensive; well-formed callers always call openJournal first.
 */
export function appendJournal(runId: string, event: RuntimeEvent): void {
  const fd = handles.get(runId) ?? lazyOpen(runId);
  const entry: JournalEventEntry = {
    ts: new Date().toISOString(),
    ...event,
  };
  try {
    writeSync(fd, JSON.stringify(entry) + '\n');
  } catch (err) {
    // Most likely cause: handle was closed concurrently. Reopen and retry once.
    handles.delete(runId);
    const retryFd = lazyOpen(runId);
    try {
      writeSync(retryFd, JSON.stringify(entry) + '\n');
    } catch (retryErr) {
      console.error(`[run-journal] failed to write to ${runId}.jsonl:`, retryErr);
    }
    void err;
  }
}

function lazyOpen(runId: string): number {
  const path = journalPathFor(runId);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const fd = openSync(path, 'a');
  handles.set(runId, fd);
  return fd;
}

/** Close the handle for a single run. Idempotent. */
export function closeJournal(runId: string): void {
  const fd = handles.get(runId);
  if (fd === undefined) return;
  try {
    closeSync(fd);
  } catch {
    /* swallow — best-effort close */
  }
  handles.delete(runId);
}

/** Close every open handle. Call from `app.on('before-quit', ...)`. */
export function closeAll(): void {
  for (const [, fd] of handles) {
    try {
      closeSync(fd);
    } catch {
      /* swallow */
    }
  }
  handles.clear();
}
