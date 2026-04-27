/**
 * Claude Agent SDK runtime (main-process side).
 *
 * Wraps the SDK's async-iterator `query()` API and translates its messages
 * into our RunStep events. Runs in the Electron main process so it has
 * Node + filesystem + shell access.
 *
 * Auth resolution order:
 *   1. CLAUDE_CODE_OAUTH_TOKEN env var (Claude Code subscription token)
 *   2. ANTHROPIC_API_KEY env var (pay-per-token)
 *   3. ~/.claude/* on-disk credentials (set by `claude login`)
 *
 * The renderer never sees the SDK directly — it speaks only to the IPC
 * surface registered in main/index.ts.
 *
 * STATUS: scaffolded but not yet wired into the home composer / agent
 * Run buttons. Those still use the in-renderer mock-runner so the demo
 * works without authentication. To swap, see lib/sdk-runner.ts in the
 * renderer + the TODO notes in mock-runner.ts.
 */

import { query, type CanUseTool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Guardrails, Permissions } from '@flowstate/core';

export interface RuntimeRunRequest {
  runId: string;
  prompt: string;
  /** When set, frames the prompt as the body of a saved agent. */
  agentSystemPrompt?: string;
  /** Tools the agent is allowed to invoke (SDK tool names, not flowstate refs). */
  allowedTools?: string[];
  /** Working directory for the run (defaults to process cwd). */
  cwd?: string;
  /** Model alias or full id. */
  model?: string;
  abortSignal?: AbortSignal;
  /** Human-in-the-loop callback — SDK invokes this before each tool call. */
  canUseTool?: CanUseTool;
  /** Agent's declared permissions (network/fs/env/approvalRequired). Enforced before HITL. */
  permissions?: Permissions;
  /** Agent's declared guardrails (mode/maxTurns/allowed/disallowed/effort). Mapped to SDK options. */
  guardrails?: Guardrails;
  /** Bash command patterns the gate allows (from cli:* refs). */
  bashAllowPatterns?: string[];
}

export interface RuntimeEvent {
  runId: string;
  /** Discriminator on the kind of event. */
  type: 'started' | 'step' | 'completed' | 'failed';
  /** Step payload when type === 'step' — shape mirrors core/RunStep. */
  step?: {
    id: string;
    parentId?: string;
    kind: 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'done' | 'error';
    label: string;
    detail?: string;
    toolId?: string;
    toolAction?: string;
    inputs?: Record<string, unknown>;
    output?: unknown;
    startedAt: string;
    endedAt?: string;
    tokens?: { input: number; output: number };
    costUsd?: number;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  };
  /** Tail payload for completed/failed. */
  totals?: {
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    durationMs: number;
  };
  error?: string;
}

export type EventCallback = (event: RuntimeEvent) => void;

/**
 * Run an agent through the Claude Agent SDK.
 *
 * Streams RuntimeEvents through the callback as the SDK emits messages.
 * Returns when the run terminates (completed or failed). Throws if the
 * SDK can't be initialized (missing auth, etc.).
 */
export async function runAgent(req: RuntimeRunRequest, emit: EventCallback): Promise<void> {
  const startedAt = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  let stepCounter = 0;
  const nextStepId = () => `step_${++stepCounter}_${Math.random().toString(36).slice(2, 6)}`;

  emit({ runId: req.runId, type: 'started' });

  try {
    // Guardrails → SDK options. Agent-declared takes precedence over caller-supplied.
    const allowedTools = req.guardrails?.allowedTools ?? req.allowedTools;
    const disallowedTools = req.guardrails?.disallowedTools;
    const permissionMode = req.guardrails?.permissionMode;
    const maxTurns = req.guardrails?.maxTurns;

    const iter = query({
      prompt: req.prompt,
      options: {
        model: req.model,
        cwd: req.cwd,
        allowedTools,
        disallowedTools,
        permissionMode,
        maxTurns,
        systemPrompt: req.agentSystemPrompt,
        canUseTool: req.canUseTool,
        abortController: req.abortSignal
          ? ({ signal: req.abortSignal } as unknown as AbortController)
          : undefined,
      },
    });

    for await (const message of iter as AsyncIterable<SDKMessage>) {
      const stepEvents = translateMessage(message, nextStepId);
      for (const ev of stepEvents) {
        if (ev.tokens) {
          tokensIn += ev.tokens.input;
          tokensOut += ev.tokens.output;
        }
        if (ev.costUsd) costUsd += ev.costUsd;
        emit({ runId: req.runId, type: 'step', step: ev });
      }
    }

    emit({
      runId: req.runId,
      type: 'completed',
      totals: { tokensIn, tokensOut, costUsd, durationMs: Date.now() - startedAt },
    });
  } catch (err) {
    emit({
      runId: req.runId,
      type: 'failed',
      error: err instanceof Error ? err.message : String(err),
      totals: { tokensIn, tokensOut, costUsd, durationMs: Date.now() - startedAt },
    });
    throw err;
  }
}

/**
 * Translate one SDK message into zero or more RunStep events.
 *
 * The mapping is deliberately conservative for the scaffold — assistant
 * text becomes a `thinking` step, tool calls become `tool_call`, results
 * become `tool_result`. Refine as we encounter edge cases in the wild.
 */
function translateMessage(
  message: SDKMessage,
  newId: () => string,
): NonNullable<RuntimeEvent['step']>[] {
  const now = new Date().toISOString();
  const events: NonNullable<RuntimeEvent['step']>[] = [];

  if (message.type === 'system') {
    // No-op for now — could surface init / interrupt info later.
    return events;
  }

  if (message.type === 'assistant') {
    const content = (message as { message?: { content?: unknown[] } }).message?.content ?? [];
    for (const block of content) {
      const b = block as { type?: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> };
      if (b.type === 'text' && b.text) {
        events.push({
          id: newId(),
          kind: 'thinking',
          label: truncate(b.text, 80),
          detail: b.text.length > 80 ? b.text : undefined,
          status: 'completed',
          startedAt: now,
          endedAt: now,
        });
      } else if (b.type === 'tool_use' && b.name) {
        events.push({
          id: b.id ?? newId(),
          kind: 'tool_call',
          label: `Call ${b.name}`,
          toolId: b.name,
          inputs: b.input,
          status: 'running',
          startedAt: now,
        });
      }
    }
    return events;
  }

  if (message.type === 'user') {
    const content = (message as { message?: { content?: unknown[] } }).message?.content ?? [];
    for (const block of content) {
      const b = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
      if (b.type === 'tool_result') {
        events.push({
          id: b.tool_use_id ?? newId(),
          kind: 'tool_result',
          label: 'Result received',
          output: b.content,
          status: b.is_error ? 'failed' : 'completed',
          startedAt: now,
          endedAt: now,
        });
      }
    }
    return events;
  }

  if (message.type === 'result') {
    const r = message as {
      total_cost_usd?: number;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    events.push({
      id: newId(),
      kind: 'done',
      label: 'Run complete',
      status: 'completed',
      startedAt: now,
      endedAt: now,
      tokens:
        r.usage?.input_tokens != null
          ? { input: r.usage.input_tokens, output: r.usage.output_tokens ?? 0 }
          : undefined,
      costUsd: r.total_cost_usd,
    });
  }

  return events;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}
