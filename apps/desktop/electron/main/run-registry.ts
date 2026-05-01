/**
 * In-memory run registry — main-process side.
 *
 * Tracks every run the runtime has started so the Conductor's list_runs
 * and cancel_run tools have something to read from. The renderer's
 * runStore is still the canonical UI state; this is a parallel index for
 * the orchestrator to query without touching the renderer.
 *
 * Kept intentionally minimal — Phase 4 of the plan replaces this with a
 * SQLite-backed store and live-tail query.
 */

interface RunRecord {
  id: string;
  agentName: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  abortController?: AbortController;
}

class RunRegistry {
  private runs: RunRecord[] = [];

  /** Register a run as it starts. Caller passes the AbortController used to cancel. */
  register(input: {
    id: string;
    agentName: string;
    abortController?: AbortController;
  }): void {
    const record: RunRecord = {
      id: input.id,
      agentName: input.agentName,
      status: 'running',
      startedAt: new Date().toISOString(),
      abortController: input.abortController,
    };
    this.runs = [record, ...this.runs].slice(0, 100); // bound memory
  }

  /** Update status when the runtime emits completed / failed. */
  setStatus(id: string, status: RunRecord['status']): void {
    const run = this.runs.find((r) => r.id === id);
    if (!run) return;
    run.status = status;
    if (status !== 'running' && status !== 'queued') {
      run.endedAt = new Date().toISOString();
    }
  }

  /** Snapshot — used by the Conductor's list_runs tool. */
  list(): Array<{
    id: string;
    agentName: string;
    status: string;
    startedAt: string;
    endedAt?: string;
  }> {
    return this.runs.map((r) => ({
      id: r.id,
      agentName: r.agentName,
      status: r.status,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
    }));
  }

  /** Abort an in-flight run. Returns true if the run was found + cancellable. */
  cancel(id: string): boolean {
    const run = this.runs.find((r) => r.id === id);
    if (!run || !run.abortController) return false;
    run.abortController.abort();
    run.status = 'cancelled';
    run.endedAt = new Date().toISOString();
    return true;
  }
}

export const runStoreMain = new RunRegistry();
