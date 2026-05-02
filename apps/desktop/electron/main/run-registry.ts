/**
 * Run registry — main-process side.
 *
 * Tracks every run the runtime has started so the Conductor's `list_runs`
 * and `cancel_run` tools have something to read from. The renderer's
 * runStore is still the canonical UI state; this is a parallel index for
 * the orchestrator to query without touching the renderer.
 *
 * Storage: SQLite-backed via `run-store-db.ts`. The full per-step
 * transcript will live in JSONL on disk (M1 task #6); the SQL tables are
 * the indexable summary on top of that. AbortControllers are NOT
 * serializable, so we hold them in an in-memory Map keyed by run id —
 * which means cancelling a run only works for the lifetime of the
 * process that started it. Crashed-then-restarted runs land in an
 * orphan-reconcile sweep on first access (any `running`/`queued` row
 * from a previous session flips to `failed`).
 *
 * The exported API matches the old in-memory version exactly so existing
 * call sites in `index.ts` and `conductor/runtime.ts` keep working.
 */

import type { AgentRun } from '@flowstate/core';
import {
  insertRun,
  setRunStatus,
  listRuns,
  getRun,
  listOrphanedRuns,
} from './run-store-db';

/** Status values accepted by `setStatus` — superset of the old enum. */
type RunStatus = AgentRun['status'];

class RunRegistry {
  /**
   * Per-process AbortControllers, indexed by run id. Cleared on terminal
   * status. Never persisted — a process restart loses cancel power for
   * runs already in flight (which the orphan sweep then marks failed).
   */
  private abortControllers = new Map<string, AbortController>();

  /** First-access lazy init. Idempotent under concurrent calls. */
  private reconciled = false;
  private ensureReconciled(): void {
    if (this.reconciled) return;
    this.reconciled = true;
    try {
      const orphans = listOrphanedRuns();
      for (const o of orphans) setRunStatus(o.id, 'failed');
      if (orphans.length > 0) {
        console.warn(
          `[run-registry] reconciled ${orphans.length} orphaned run(s) from a previous session`,
        );
      }
    } catch (err) {
      // Don't let reconciliation failure block normal use.
      console.error('[run-registry] orphan reconcile failed:', err);
    }
  }

  /**
   * Register a run as it starts. Caller passes the AbortController used
   * to cancel; that lives only in this process. The run row hits SQLite
   * with status='running' immediately.
   */
  register(input: {
    id: string;
    agentId: string;
    agentName: string;
    abortController?: AbortController;
    workspaceId?: string | null;
    triggerKind?: string | null;
    triggerPayload?: unknown;
  }): void {
    this.ensureReconciled();
    insertRun({
      id: input.id,
      agentId: input.agentId,
      agentName: input.agentName,
      status: 'running',
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      ...(input.triggerKind !== undefined ? { triggerKind: input.triggerKind } : {}),
      ...(input.triggerPayload !== undefined ? { triggerPayload: input.triggerPayload } : {}),
    });
    if (input.abortController) {
      this.abortControllers.set(input.id, input.abortController);
    }
  }

  /** Update status when the runtime emits started / completed / failed / cancelled. */
  setStatus(id: string, status: RunStatus): void {
    this.ensureReconciled();
    setRunStatus(id, status);
    // On terminal states, drop the controller — keeps the map bounded.
    if (status !== 'running' && status !== 'queued' && status !== 'paused') {
      this.abortControllers.delete(id);
    }
  }

  /**
   * Snapshot — used by the Conductor's `list_runs` tool. Returns the
   * thin projection callers expect (id / agentName / status / startedAt
   * / endedAt). Defaults to the most recent 100 across all workspaces;
   * matches the old in-memory cap so consumers see the same shape.
   */
  list(): Array<{
    id: string;
    agentName: string;
    status: string;
    startedAt: string;
    endedAt?: string;
  }> {
    this.ensureReconciled();
    return listRuns({ limit: 100 }).map((r) => ({
      id: r.id,
      agentName: r.agentName,
      status: r.status,
      startedAt: r.startedAt,
      ...(r.endedAt ? { endedAt: r.endedAt } : {}),
    }));
  }

  /**
   * Abort an in-flight run. Returns true if we either aborted in-process
   * or marked a still-running DB row as cancelled (best-effort for runs
   * we've inherited from a previous process).
   */
  cancel(id: string): boolean {
    this.ensureReconciled();
    const ctrl = this.abortControllers.get(id);
    if (ctrl) {
      ctrl.abort();
      setRunStatus(id, 'cancelled');
      this.abortControllers.delete(id);
      return true;
    }
    // No controller — fall back to a DB-only flip if the row is still active.
    const row = getRun(id);
    if (row && (row.status === 'running' || row.status === 'queued' || row.status === 'paused')) {
      setRunStatus(id, 'cancelled');
      return true;
    }
    return false;
  }
}

export const runStoreMain = new RunRegistry();
