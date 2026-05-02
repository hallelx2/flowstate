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

import type { AgentRun, RunStep } from '@flowstate/core';
import {
  insertRun,
  setRunStatus,
  setRunTotals,
  appendStep,
  updateStep,
  listRuns,
  getRun,
  listOrphanedRuns,
} from './run-store-db';
import {
  appendJournal,
  closeJournal,
  openJournal,
} from './run-journal';
import type { RuntimeEvent } from './agent-runtime';

/** Status values accepted by `setStatus` — superset of the old enum. */
type RunStatus = AgentRun['status'];

class RunRegistry {
  /**
   * Per-process AbortControllers, indexed by run id. Cleared on terminal
   * status. Never persisted — a process restart loses cancel power for
   * runs already in flight (which the orphan sweep then marks failed).
   */
  private abortControllers = new Map<string, AbortController>();

  /**
   * Step IDs already inserted into run_steps, per run. The runtime emits
   * the same step id twice when a tool runs to completion (a `tool_call`
   * step in `running` state, then a `tool_result` step in `completed`
   * state, both keyed by the SDK's tool_use_id). First sighting → INSERT;
   * subsequent sightings → UPDATE. Set is dropped when the run terminates.
   */
  private knownSteps = new Map<string, Set<string>>();

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
   * with status='running' immediately, and a JSONL journal is opened
   * with an `init` line capturing the metadata that's not in the
   * runtime event stream.
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

    const journalPath = openJournal({
      runId: input.id,
      agentId: input.agentId,
      agentName: input.agentName,
      workspaceId: input.workspaceId ?? null,
      triggerKind: input.triggerKind ?? null,
      ...(input.triggerPayload !== undefined ? { triggerPayload: input.triggerPayload } : {}),
    });

    insertRun({
      id: input.id,
      agentId: input.agentId,
      agentName: input.agentName,
      status: 'running',
      journalPath,
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      ...(input.triggerKind !== undefined ? { triggerKind: input.triggerKind } : {}),
      ...(input.triggerPayload !== undefined ? { triggerPayload: input.triggerPayload } : {}),
    });
    if (input.abortController) {
      this.abortControllers.set(input.id, input.abortController);
    }
    this.knownSteps.set(input.id, new Set());
  }

  /**
   * The unified "persist this event" entrypoint — call this for every
   * RuntimeEvent emitted by the agent-runtime. Writes a line to the
   * JSONL journal AND mirrors the relevant fields into SQL:
   *
   *   - `started`     → no-op (run already inserted by `register`)
   *   - `step`        → INSERT into run_steps on first sighting of step.id,
   *                     UPDATE on subsequent sightings (tool_call → tool_result)
   *   - `completed`   → setRunTotals + setRunStatus('completed'), close journal
   *   - `failed`      → setRunTotals + setRunStatus('failed'), close journal
   *
   * Call sites: anywhere a run is being driven through `runAgent`. Both
   * the renderer-driven `agent:run` IPC handler and the Conductor's
   * inner-run dispatch funnel through here.
   */
  recordEvent(runId: string, event: RuntimeEvent): void {
    this.ensureReconciled();

    // 1. Journal the event verbatim — first, before SQL, so a crash
    //    between the two leaves the journal as the source of truth.
    appendJournal(runId, event);

    // 2. Mirror to SQL based on event type.
    if (event.type === 'step' && event.step) {
      const s = event.step;
      const seen = this.knownSteps.get(runId);
      if (seen && seen.has(s.id)) {
        updateStep(s.id, {
          status: s.status,
          ...(s.detail !== undefined ? { detail: s.detail } : {}),
          ...(s.output !== undefined ? { output: s.output } : {}),
          ...(s.endedAt !== undefined ? { endedAt: s.endedAt } : {}),
          ...(s.tokens !== undefined ? { tokens: s.tokens } : {}),
          ...(s.costUsd !== undefined ? { costUsd: s.costUsd } : {}),
        });
      } else {
        appendStep({
          runId,
          id: s.id,
          kind: s.kind as RunStep['kind'],
          status: s.status,
          label: s.label,
          ...(s.detail !== undefined ? { detail: s.detail } : {}),
          ...(s.toolId !== undefined ? { toolId: s.toolId } : {}),
          ...(s.toolAction !== undefined ? { toolAction: s.toolAction } : {}),
          ...(s.inputs !== undefined ? { inputs: s.inputs } : {}),
          ...(s.output !== undefined ? { output: s.output } : {}),
          startedAt: s.startedAt,
          ...(s.endedAt !== undefined ? { endedAt: s.endedAt } : {}),
          ...(s.tokens !== undefined ? { tokens: s.tokens } : {}),
          ...(s.costUsd !== undefined ? { costUsd: s.costUsd } : {}),
        });
        if (seen) seen.add(s.id);
      }
    } else if (event.type === 'completed' || event.type === 'failed') {
      if (event.totals) setRunTotals(runId, event.totals);
      setRunStatus(runId, event.type === 'completed' ? 'completed' : 'failed');
      this.abortControllers.delete(runId);
      this.knownSteps.delete(runId);
      closeJournal(runId);
    }
    // 'started' — register already inserted at status='running', nothing to do.
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
   *
   * Cleans up step tracking and closes the journal handle — the runtime's
   * trailing 'failed' event (if any) will lazy-reopen, but typically cancel
   * is the last thing that happens to a run.
   */
  cancel(id: string): boolean {
    this.ensureReconciled();
    const ctrl = this.abortControllers.get(id);
    if (ctrl) {
      ctrl.abort();
      setRunStatus(id, 'cancelled');
      this.abortControllers.delete(id);
      this.knownSteps.delete(id);
      closeJournal(id);
      return true;
    }
    // No controller — fall back to a DB-only flip if the row is still active.
    const row = getRun(id);
    if (row && (row.status === 'running' || row.status === 'queued' || row.status === 'paused')) {
      setRunStatus(id, 'cancelled');
      closeJournal(id);
      return true;
    }
    return false;
  }
}

export const runStoreMain = new RunRegistry();
