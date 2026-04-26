import { useSyncExternalStore } from 'react';
import type { RunStep } from '@flowstate/core';

/**
 * Simple in-memory run store (singleton + useSyncExternalStore).
 * Real implementation will move to main-process state with IPC streaming;
 * this keeps the UI honest while we wire that up.
 */

export interface Run {
  id: string;
  /** null for ad-hoc runs (composer-driven) */
  agentId: string | null;
  agentName: string;
  /** The prompt for ad-hoc runs, or the trigger payload for agent-driven runs */
  prompt?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  steps: RunStep[];
  totals: {
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    durationMs: number;
  };
}

type Listener = () => void;

class RunStore {
  private runs: Run[] = [];
  private listeners = new Set<Listener>();
  private cachedSnapshot: Run[] = [];

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  /** useSyncExternalStore requires a stable reference between unchanged calls. */
  getSnapshot = (): Run[] => this.cachedSnapshot;

  create(input: {
    agentId: string | null;
    agentName: string;
    prompt?: string;
  }): Run {
    const run: Run = {
      id: makeId(),
      agentId: input.agentId,
      agentName: input.agentName,
      prompt: input.prompt,
      status: 'queued',
      startedAt: new Date().toISOString(),
      steps: [],
      totals: { tokensIn: 0, tokensOut: 0, costUsd: 0, durationMs: 0 },
    };
    this.runs = [run, ...this.runs];
    this.refresh();
    return run;
  }

  update(id: string, patch: Partial<Omit<Run, 'id' | 'steps'>>): void {
    this.runs = this.runs.map((r) => (r.id === id ? { ...r, ...patch } : r));
    this.refresh();
  }

  appendStep(id: string, step: RunStep): void {
    this.runs = this.runs.map((r) =>
      r.id === id ? { ...r, steps: [...r.steps, step] } : r,
    );
    this.refresh();
  }

  updateStep(runId: string, stepId: string, patch: Partial<RunStep>): void {
    this.runs = this.runs.map((r) =>
      r.id !== runId
        ? r
        : {
            ...r,
            steps: r.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
          },
    );
    this.refresh();
  }

  get(id: string): Run | undefined {
    return this.runs.find((r) => r.id === id);
  }

  private refresh(): void {
    this.cachedSnapshot = [...this.runs];
    for (const cb of this.listeners) cb();
  }
}

export const runStore = new RunStore();

export function useRuns(): Run[] {
  return useSyncExternalStore(runStore.subscribe, runStore.getSnapshot);
}

export function useRun(id: string | null | undefined): Run | undefined {
  const runs = useRuns();
  return id ? runs.find((r) => r.id === id) : undefined;
}

function makeId(): string {
  return 'run_' + Math.random().toString(36).slice(2, 10);
}
