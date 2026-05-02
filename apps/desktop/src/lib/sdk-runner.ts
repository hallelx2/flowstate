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
  /**
   * Agent's `tools:` declarations (e.g. `mcp:github`, `cli:gh.pr.create`).
   * Main resolves these server-side: MCP servers are built from the
   * installed registry with decrypted secrets injected, and `cli:*` refs
   * become a bash allowlist. The renderer never handles decrypted secrets.
   */
  agentTools?: string[];
  /** Agent's declared permissions — enforced inside canUseTool in main. */
  permissions?: {
    network?: string[];
    fs?: { read?: string[]; write?: string[] };
    env?: string[];
    approvalRequired?: string[];
  };
  /** Agent's declared guardrails — mapped to SDK query() options. */
  guardrails?: {
    permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
    maxTurns?: number;
    allowedTools?: string[];
    disallowedTools?: string[];
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number;
  };
  /** Hard caps — main aborts the SDK iterator when any limit is exceeded. */
  budget?: {
    tokens?: number;
    usd?: number;
    runtimeMs?: number;
  };
}

export function startSdkRun(opts: StartOpts): Run {
  const run = runStore.create({
    agentId: opts.agentId,
    agentName: opts.agentName,
    prompt: opts.prompt,
  });

  // Track which step IDs we've already created so updates land on the right object
  const knownSteps = new Set<string>();

  // ─── HITL: forward SDK approval requests to the runStore + back ──────
  // When the SDK wants to invoke a tool, the main process emits an
  // approval-request event. We translate it into a runStore.requestApproval
  // call (which surfaces the banner UI), wait for the user, then send the
  // decision back through respondToApproval — which resolves the Promise
  // the SDK is awaiting in the main process.
  const unsubApproval = window.flowstate.onApprovalRequest(async (req) => {
    if (req.runId !== run.id) return;
    const stepId = req.toolUseID;
    const approved = await runStore.requestApproval(run.id, {
      stepId,
      toolId: req.toolName,
      inputs: req.input,
      message:
        req.title ??
        `Claude wants to use ${req.displayName ?? req.toolName}.${
          req.description ? ` ${req.description}` : ''
        }`,
      requestedAt: new Date().toISOString(),
    });
    await window.flowstate.respondToApproval({
      toolUseID: req.toolUseID,
      approved,
      message: approved ? undefined : 'Denied by user',
    });
  });

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
      unsubApproval();
      return;
    }

    if (ev.type === 'failed') {
      runStore.update(run.id, {
        status: 'failed',
        endedAt: new Date().toISOString(),
        totals: ev.totals ?? run.totals,
      });
      unsub();
      unsubApproval();
    }
  });

  // Fire and forget — the IPC promise resolves when the run terminates
  // but we surface progress through the event stream instead.
  void window.flowstate
    .runAgent({
      runId: run.id,
      agentId: opts.agentId,
      agentName: opts.agentName,
      prompt: opts.prompt,
      agentSystemPrompt: opts.agentSystemPrompt,
      allowedTools: opts.allowedTools,
      model: opts.model,
      agentTools: opts.agentTools,
      permissions: opts.permissions,
      guardrails: opts.guardrails,
      budget: opts.budget,
    })
    .catch((err) => {
      console.warn('[sdk-runner] SDK invocation failed, falling back to mock', err);
      unsub();
      unsubApproval();

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
