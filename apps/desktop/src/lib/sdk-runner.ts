import type { RunStep } from '@flowstate/core';
import { runStore, type Run } from './run-store';

/**
 * Renderer-side adapter for the main-process Claude Agent SDK runtime.
 *
 * Lifecycle:
 *   1. Caller invokes `startSdkRun({ prompt, agentName, ... })`
 *   2. We create a Run in the runStore (queued)
 *   3. We subscribe to streaming agent events from the main process
 *   4. We translate agent events → runStore mutations (steps, totals, status)
 *   5. The cleanup unsub fires when the run terminates
 *
 * STATUS: wired but not yet the default code path. The home composer +
 * agent Run button currently use lib/mock-runner.ts so the demo works
 * without Claude Code authentication. Swap by replacing those callers
 * with `startSdkRun(...)` once the user has a valid auth source.
 */

interface StartOpts {
  agentId: string | null;
  agentName: string;
  prompt: string;
  /** System prompt — for saved agents this is built from the agent's body + sections. */
  agentSystemPrompt?: string;
  allowedTools?: string[];
  model?: string;
}

export function startSdkRun(opts: StartOpts): Run {
  const run = runStore.create({
    agentId: opts.agentId,
    agentName: opts.agentName,
    prompt: opts.prompt,
  });

  // Track which step IDs we've already created so updates land on the right object
  const knownSteps = new Set<string>();

  const unsub = window.flowstate.onAgentEvent((ev) => {
    if (ev.runId !== run.id) return;

    if (ev.type === 'started') {
      runStore.update(run.id, { status: 'running' });
      return;
    }

    if (ev.type === 'step' && ev.step) {
      const step: RunStep = {
        id: ev.step.id,
        kind: ev.step.kind,
        status: ev.step.status,
        label: ev.step.label,
        detail: ev.step.detail,
        toolId: ev.step.toolId,
        toolAction: ev.step.toolAction,
        inputs: ev.step.inputs,
        output: ev.step.output,
        startedAt: ev.step.startedAt,
        endedAt: ev.step.endedAt,
        tokens: ev.step.tokens,
        costUsd: ev.step.costUsd,
      };
      if (knownSteps.has(step.id)) {
        runStore.updateStep(run.id, step.id, step);
      } else {
        knownSteps.add(step.id);
        runStore.appendStep(run.id, step);
      }
      return;
    }

    if (ev.type === 'completed') {
      runStore.update(run.id, {
        status: 'completed',
        endedAt: new Date().toISOString(),
        totals: ev.totals ?? run.totals,
      });
      unsub();
      return;
    }

    if (ev.type === 'failed') {
      runStore.update(run.id, {
        status: 'failed',
        endedAt: new Date().toISOString(),
        totals: ev.totals ?? run.totals,
      });
      unsub();
    }
  });

  // Fire and forget — the IPC promise resolves when the run terminates
  // but we surface progress through the event stream instead.
  void window.flowstate
    .runAgent({
      runId: run.id,
      prompt: opts.prompt,
      agentSystemPrompt: opts.agentSystemPrompt,
      allowedTools: opts.allowedTools,
      model: opts.model,
    })
    .catch((err) => {
      runStore.update(run.id, {
        status: 'failed',
        endedAt: new Date().toISOString(),
      });
      console.error('SDK run failed', err);
      unsub();
    });

  return run;
}

export function cancelSdkRun(runId: string): Promise<boolean> {
  return window.flowstate.cancelAgent(runId);
}
