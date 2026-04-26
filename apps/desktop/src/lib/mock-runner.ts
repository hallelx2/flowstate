import type { RunStep } from '@flowstate/core';
import { runStore, type Run } from './run-store';

/**
 * Mock agent runner — generates a realistic-looking trace of steps for any
 * agent or ad-hoc prompt. Replaced by the real Claude Agent SDK runtime
 * (see runtime/agent-runner in the main process) once that's wired through IPC.
 *
 * The shape of the events emitted here matches what the real runner will
 * produce, so the UI doesn't need to change when we swap implementations.
 */

interface PlannedStep {
  kind: RunStep['kind'];
  label: string;
  detail?: string;
  toolId?: string;
  toolAction?: string;
  /** ms — how long the "running" state lasts before it completes */
  duration: number;
  tokens?: number;
  costUsd?: number;
}

const ADHOC_PLAN: PlannedStep[] = [
  { kind: 'thinking', label: 'Reading the request', detail: 'Parsing intent + identifying needed capabilities', duration: 1200, tokens: 850 },
  { kind: 'tool_call', label: 'Search context', detail: 'Looking up recent emails matching the topic', toolId: 'mcp:gmail.messages.search', duration: 1500, tokens: 320 },
  { kind: 'thinking', label: 'Drafting reply', detail: 'Composing in the user\'s voice', duration: 2400, tokens: 1450 },
  { kind: 'tool_call', label: 'Save draft', toolId: 'mcp:gmail.drafts.create', duration: 700, tokens: 95 },
  { kind: 'message', label: 'Done — review and send when ready', duration: 200, tokens: 60 },
  { kind: 'done', label: 'Run complete', duration: 50 },
];

const REFUND_PLAN: PlannedStep[] = [
  { kind: 'trigger', label: 'Webhook · /refund', detail: 'POST from billing dashboard', duration: 50 },
  { kind: 'thinking', label: 'Verify request is in 30-day window', detail: 'Reading order metadata, checking purchase date', duration: 1840, tokens: 1100 },
  { kind: 'tool_call', label: 'Fetch customer record', detail: 'Look up the buyer in Stripe', toolId: 'mcp:stripe.customers.retrieve', duration: 410, tokens: 180 },
  { kind: 'tool_call', label: 'Fetch original payment intent', toolId: 'mcp:stripe.charges.list', duration: 380, tokens: 220 },
  { kind: 'tool_call', label: 'Issue refund', detail: '$48.00 USD · reason: customer_request', toolId: 'mcp:stripe.refunds.create', duration: 920, tokens: 140 },
  { kind: 'tool_call', label: 'Email confirmation to customer', toolId: 'mcp:gmail.messages.send', duration: 650, tokens: 240 },
  { kind: 'tool_call', label: 'Post to #ops-billing', toolId: 'composio:slack.chat.post', duration: 320, tokens: 90 },
  { kind: 'done', label: 'Run complete', duration: 50 },
];

function pickPlan(agentId: string | null): PlannedStep[] {
  if (agentId === 'refund-handler') return REFUND_PLAN;
  return ADHOC_PLAN;
}

export function startMockRun(opts: {
  agentId: string | null;
  agentName: string;
  prompt?: string;
}): Run {
  const run = runStore.create(opts);
  runStore.update(run.id, { status: 'running' });

  const plan = pickPlan(opts.agentId);
  const startedAt = Date.now();

  // Walk the plan, emitting steps with realistic delays.
  void executePlan(run.id, plan, startedAt);

  return run;
}

async function executePlan(runId: string, plan: PlannedStep[], startedAt: number) {
  for (const planned of plan) {
    const step: RunStep = {
      id: 'step_' + Math.random().toString(36).slice(2, 8),
      kind: planned.kind,
      status: 'running',
      label: planned.label,
      detail: planned.detail,
      toolId: planned.toolId,
      toolAction: planned.toolAction,
      startedAt: new Date().toISOString(),
    };
    runStore.appendStep(runId, step);

    await sleep(planned.duration);

    const tokensOut = Math.round((planned.tokens ?? 0) * 0.4);
    runStore.updateStep(runId, step.id, {
      status: 'completed',
      endedAt: new Date().toISOString(),
      tokens: planned.tokens ? { input: planned.tokens, output: tokensOut } : undefined,
      costUsd: planned.tokens ? planned.tokens * 0.000003 + tokensOut * 0.000015 : undefined,
    });

    // Update aggregates
    const run = runStore.get(runId);
    if (!run) return;
    runStore.update(runId, {
      totals: {
        tokensIn: run.steps.reduce((s, st) => s + (st.tokens?.input ?? 0), 0),
        tokensOut: run.steps.reduce((s, st) => s + (st.tokens?.output ?? 0), 0),
        costUsd: run.steps.reduce((s, st) => s + (st.costUsd ?? 0), 0),
        durationMs: Date.now() - startedAt,
      },
    });
  }

  runStore.update(runId, {
    status: 'completed',
    endedAt: new Date().toISOString(),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
