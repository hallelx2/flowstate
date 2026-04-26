import type { RunStep } from '@flowstate/core';
import { runStore, type Run } from './run-store';
import { startMockRun } from './mock-runner';

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
 * Auth-failure fallback: if the SDK throws on startup (no Claude auth on
 * this machine, no API key, etc.), we fall back to the mock runner so the
 * UI still demonstrates a believable trace. A toast surfaces the reason.
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
      console.warn('[sdk-runner] SDK invocation failed, falling back to mock', err);
      unsub();

      // If the SDK call never produced any steps, the run looks "stuck queued".
      // Mark the original run as failed with the SDK error...
      const current = runStore.get(run.id);
      if (current && current.steps.length === 0) {
        runStore.update(run.id, {
          status: 'failed',
          endedAt: new Date().toISOString(),
        });
        // ...and start a fresh mock run so the user still sees something work.
        startMockRun({
          agentId: opts.agentId,
          agentName: `${opts.agentName} (mock fallback)`,
          prompt: opts.prompt,
        });
      } else {
        runStore.update(run.id, {
          status: 'failed',
          endedAt: new Date().toISOString(),
        });
      }
    });

  return run;
}

export function cancelSdkRun(runId: string): Promise<boolean> {
  return window.flowstate.cancelAgent(runId);
}
