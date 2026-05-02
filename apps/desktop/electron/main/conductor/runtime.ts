/**
 * ConductorRuntime — one long-lived `query()` per BrowserWindow.
 *
 * Streams user messages into the SDK via streaming-input mode, holds the
 * Query handle so we can `.interrupt()` / `.setPermissionMode()` mid-flight,
 * and translates SDK messages into renderer-facing events.
 *
 * The runtime owns:
 *   - the in-process MCP server (custom tools)
 *   - the subagent definitions
 *   - the hook bridges
 *   - the session id index
 *   - the pending-userInput map (for ask_user / set_secret prompts)
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { runAgent, type RuntimeRunRequest } from '../agent-runtime';
import {
  bashAllowPatternsFromTools,
  readApiKey,
  resolveAgentMcpServers,
} from '../agent-orchestrator';
import { agentsRoot } from '../paths';
import { runStoreMain } from '../run-registry';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { parseAgentMarkdown, parseAgentYaml } from '@flowstate/core';
import {
  buildConductorHooks,
  type ConductorHookBridges,
  type WorkspaceSnapshot,
} from './hooks';
import {
  createConductorMcpServer,
  FLOWSTATE_TOOL_PREFIX,
} from './server';
import {
  getActiveSession,
  recordSession,
} from './sessions';
import { CONDUCTOR_SUBAGENTS } from './subagents';
import { CONDUCTOR_SYSTEM_PROMPT } from './system-prompt';
import type { ConductorHostBridge } from './tools';

// ─── Public event shape ───────────────────────────────────────────────────

export type ConductorEvent =
  | { type: 'session-ready'; sessionId: string }
  | { type: 'assistant-text'; text: string; turnId: string }
  | { type: 'tool-call'; toolName: string; input: unknown; turnId: string; toolUseId: string }
  | {
      type: 'tool-result';
      toolName: string;
      output: unknown;
      isError: boolean;
      turnId: string;
      toolUseId: string;
    }
  | { type: 'subagent-phase'; phase: 'start' | 'stop'; subagent?: string }
  | { type: 'turn-complete'; turnId: string; tokensIn: number; tokensOut: number; costUsd: number }
  | { type: 'turn-error'; turnId: string; error: string; subtype?: string }
  | { type: 'dispatch-run'; runId: string; turnId: string }
  | { type: 'toast'; kind: 'info' | 'warn' | 'error'; text: string };

export type ConductorEventEmit = (event: ConductorEvent) => void;

// ─── Outbound bridge — what the runtime asks of the host ──────────────────

export interface ConductorRendererBridge {
  /** Stream events to the renderer. */
  emit: ConductorEventEmit;
  /** Surface a destructive-tool approval banner. */
  requestApproval: (req: {
    toolName: string;
    input: Record<string, unknown>;
    toolUseId?: string;
  }) => Promise<{ approved: boolean; reason?: string }>;
  /** Surface a free-form prompt-card (ask_user, set_secret valueFromUser). */
  requestUserInput: (prompt: {
    question: string;
    placeholder?: string;
    secret?: boolean;
  }) => Promise<string>;
  /** Workspace snapshot for the UserPromptSubmit hook. */
  workspaceSnapshot: () => Promise<WorkspaceSnapshot>;
  /** Active workspace metadata for the read_active_workspace tool. */
  activeWorkspace: () => { id: string; name: string; cwd?: string } | null;
  /** List runs for the list_runs tool. */
  listRuns: () => Array<{
    id: string;
    agentName: string;
    status: string;
    startedAt: string;
    endedAt?: string;
  }>;
  /** Cancel a run for the cancel_run tool. */
  cancelRun: (runId: string) => boolean;
  /** Forward inner-run events to the renderer (tagged so it knows they're nested). */
  forwardInnerRunEvents: (runId: string, event: unknown) => void;
}

// ─── Runtime ──────────────────────────────────────────────────────────────

export class ConductorRuntime {
  private q: ReturnType<typeof query> | null = null;
  /** Stream-input source — Claude reads UserMessages off this iterable. */
  private inputQueue: ((value: IteratorResult<{ type: 'user'; message: { role: 'user'; content: string } }>) => void)[] = [];
  private pendingUserMessages: Array<{
    type: 'user';
    message: { role: 'user'; content: string };
  }> = [];
  private inputClosed = false;
  private currentTurnId: string | null = null;
  private sessionId: string | null = null;
  private workspaceId: string;
  private bridge: ConductorRendererBridge;

  constructor(workspaceId: string, bridge: ConductorRendererBridge) {
    this.workspaceId = workspaceId;
    this.bridge = bridge;
  }

  /**
   * Lazily start the SDK query() with streaming-input mode so we can
   * push follow-up turns from the renderer over IPC.
   */
  async start(): Promise<void> {
    if (this.q) return;

    // Inject API key from keychain into env BEFORE the SDK reads it.
    const previousApiKey = process.env['ANTHROPIC_API_KEY'];
    const userApiKey = await readApiKey();
    if (userApiKey) process.env['ANTHROPIC_API_KEY'] = userApiKey;
    // We don't restore here — the runtime is long-lived. We restore on close().
    this._previousApiKey = previousApiKey ?? null;

    // Resume prior session if one exists for this workspace.
    const priorSessionId = await getActiveSession(this.workspaceId);

    const host: ConductorHostBridge = {
      requestUserInput: this.bridge.requestUserInput,
      dispatchAgentRun: (input) => this.dispatchInnerRun(input),
      listRuns: () => this.bridge.listRuns(),
      cancelRun: (id) => this.bridge.cancelRun(id),
      activeWorkspace: () => this.bridge.activeWorkspace(),
    };

    const flowstateServer = createConductorMcpServer(host);

    const hookBridges: ConductorHookBridges = {
      workspace: this.bridge.workspaceSnapshot,
      hitl: { requestApproval: this.bridge.requestApproval },
      phase: {
        notifyPhase: (p) =>
          this.bridge.emit({ type: 'subagent-phase', phase: p.kind, subagent: p.subagent }),
      },
      toast: { toast: (m) => this.bridge.emit({ type: 'toast', kind: m.kind, text: m.text }) },
      dispatch: {
        onDispatch: (info) => {
          if (this.currentTurnId) {
            this.bridge.emit({
              type: 'dispatch-run',
              runId: info.runId,
              turnId: this.currentTurnId,
            });
          }
        },
      },
      getSessionId: () => this.sessionId,
    };

    // Build the streaming-input async iterable. The SDK pulls from this
    // every time we want to send a user turn. We cast through unknown
    // because the SDK's SDKUserMessage type carries optional internal
    // fields (parent_tool_use_id, etc.) we don't supply for plain user
    // turns — runtime accepts them missing.
    const input = this.makeInputIterable() as unknown as never;

    this.q = query({
      prompt: input,
      options: {
        systemPrompt: CONDUCTOR_SYSTEM_PROMPT,
        mcpServers: { flowstate: flowstateServer },
        // Allow built-in read tools + Agent (for subagent dispatch) + every
        // flowstate.* tool. Built-in Write/Edit/Bash are NOT allowed at the
        // Conductor level — destructive work happens via flowstate.* tools
        // that route through the HITL hook.
        allowedTools: [
          'Read',
          'Glob',
          'Grep',
          'Agent',
          // SDK tool name pattern for in-process MCP tools
          `${FLOWSTATE_TOOL_PREFIX}*`,
        ],
        // Subagents declared by name; Conductor dispatches via Agent tool.
        agents: CONDUCTOR_SUBAGENTS as never,
        // Hooks — see conductor/hooks.ts.
        hooks: buildConductorHooks(hookBridges) as never,
        // permissionMode 'default' so the SDK keeps asking for unscoped
        // tools. Our HITL hook + tool annotations carry the heavy lifting.
        permissionMode: 'default',
        // Resume if we have a prior session id.
        resume: priorSessionId ?? undefined,
        // Long-running budget: high cap, repair flows can cost.
        maxTurns: 60,
      },
    });

    // Drain SDK messages forever. Errors don't kill the runtime — they're
    // emitted as turn-error events; the next user message starts a fresh turn.
    void this.drain().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.bridge.emit({
        type: 'turn-error',
        turnId: this.currentTurnId ?? 'unknown',
        error: message,
      });
    });
  }

  private _previousApiKey: string | null = null;

  /** Push a user turn into the running session. */
  send(text: string): string {
    const turnId = `turn_${randomUUID().slice(0, 8)}`;
    this.currentTurnId = turnId;
    const msg = {
      type: 'user' as const,
      message: { role: 'user' as const, content: text },
    };
    if (this.inputQueue.length > 0) {
      const resolve = this.inputQueue.shift()!;
      resolve({ value: msg, done: false });
    } else {
      this.pendingUserMessages.push(msg);
    }
    return turnId;
  }

  /** Interrupt the current turn. */
  async interrupt(): Promise<void> {
    if (!this.q) return;
    const q = this.q as unknown as { interrupt?: () => Promise<void> };
    if (typeof q.interrupt === 'function') await q.interrupt();
  }

  /** Change permission mode mid-session. */
  async setPermissionMode(
    mode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions',
  ): Promise<void> {
    if (!this.q) return;
    const q = this.q as unknown as {
      setPermissionMode?: (m: string) => Promise<void>;
    };
    if (typeof q.setPermissionMode === 'function') await q.setPermissionMode(mode);
  }

  /** Shut the runtime down cleanly. */
  async close(): Promise<void> {
    this.inputClosed = true;
    // Resolve any waiting iterator with done.
    while (this.inputQueue.length > 0) {
      const resolve = this.inputQueue.shift()!;
      resolve({ value: undefined as never, done: true });
    }
    if (this._previousApiKey == null) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = this._previousApiKey;
    this.q = null;
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private makeInputIterable(): AsyncIterable<{
    type: 'user';
    message: { role: 'user'; content: string };
  }> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            new Promise((resolve) => {
              if (self.inputClosed) {
                resolve({ value: undefined as never, done: true });
                return;
              }
              if (self.pendingUserMessages.length > 0) {
                const msg = self.pendingUserMessages.shift()!;
                resolve({ value: msg, done: false });
                return;
              }
              self.inputQueue.push(resolve);
            }),
          return: () => Promise.resolve({ value: undefined as never, done: true as const }),
        };
      },
    };
  }

  private async drain(): Promise<void> {
    if (!this.q) return;
    let turnTokensIn = 0;
    let turnTokensOut = 0;
    let turnCostUsd = 0;

    for await (const message of this.q as AsyncIterable<unknown>) {
      const m = message as Record<string, unknown>;
      const type = m['type'] as string;

      if (type === 'system' && m['subtype'] === 'init') {
        const sid = m['session_id'] as string | undefined;
        if (sid) {
          this.sessionId = sid;
          await recordSession(this.workspaceId, sid);
          this.bridge.emit({ type: 'session-ready', sessionId: sid });
        }
        continue;
      }

      if (type === 'assistant') {
        const content = (m['message'] as { content?: unknown[] } | undefined)?.content ?? [];
        for (const block of content) {
          const b = block as { type?: string; text?: string; name?: string; id?: string; input?: unknown };
          if (b.type === 'text' && b.text && this.currentTurnId) {
            this.bridge.emit({
              type: 'assistant-text',
              text: b.text,
              turnId: this.currentTurnId,
            });
          } else if (b.type === 'tool_use' && b.name && this.currentTurnId) {
            this.bridge.emit({
              type: 'tool-call',
              toolName: b.name,
              input: b.input,
              turnId: this.currentTurnId,
              toolUseId: b.id ?? '',
            });
          }
        }
        continue;
      }

      if (type === 'user') {
        const content = (m['message'] as { content?: unknown[] } | undefined)?.content ?? [];
        for (const block of content) {
          const b = block as {
            type?: string;
            tool_use_id?: string;
            content?: unknown;
            is_error?: boolean;
          };
          if (b.type === 'tool_result' && this.currentTurnId) {
            this.bridge.emit({
              type: 'tool-result',
              toolName: '',
              output: b.content,
              isError: b.is_error === true,
              turnId: this.currentTurnId,
              toolUseId: b.tool_use_id ?? '',
            });
          }
        }
        continue;
      }

      if (type === 'result') {
        const r = m as {
          total_cost_usd?: number;
          usage?: { input_tokens?: number; output_tokens?: number };
          subtype?: string;
          is_error?: boolean;
          result?: string;
        };
        if (r.usage?.input_tokens != null) turnTokensIn += r.usage.input_tokens;
        if (r.usage?.output_tokens != null) turnTokensOut += r.usage.output_tokens;
        if (r.total_cost_usd != null) turnCostUsd += r.total_cost_usd;

        if (r.is_error || (r.subtype && r.subtype !== 'success')) {
          this.bridge.emit({
            type: 'turn-error',
            turnId: this.currentTurnId ?? 'unknown',
            error: r.result ?? r.subtype ?? 'unknown error',
            subtype: r.subtype,
          });
        } else if (this.currentTurnId) {
          this.bridge.emit({
            type: 'turn-complete',
            turnId: this.currentTurnId,
            tokensIn: turnTokensIn,
            tokensOut: turnTokensOut,
            costUsd: turnCostUsd,
          });
        }
        // Reset turn-scoped totals for the next turn.
        turnTokensIn = 0;
        turnTokensOut = 0;
        turnCostUsd = 0;
      }
    }
  }

  // ─── Inner-run dispatch (the boundary tool's host implementation) ───

  /**
   * Dispatch a saved or inline agent run via the existing AgentRuntime.
   * Streams the inner run's events back to the renderer through
   * `forwardInnerRunEvents`. Returns the runId immediately — the
   * dispatch tool's promise resolves before the run completes, so the
   * Conductor can keep narrating while the run streams beneath.
   */
  private async dispatchInnerRun(input: {
    agentRelPath?: string;
    inlinePrompt?: string;
    inlineSystemPrompt?: string;
    inlineTools?: string[];
    model?: string;
  }): Promise<{ runId: string }> {
    const runId = `run_${randomUUID().slice(0, 8)}`;

    let prompt: string;
    let systemPrompt: string | undefined;
    let agentTools: string[] | undefined;
    let permissions: RuntimeRunRequest['permissions'];
    let guardrails: RuntimeRunRequest['guardrails'];
    let budget: RuntimeRunRequest['budget'];
    let agentName = 'inline';
    let agentId = '_inline';
    let triggerKind: string | undefined;

    if (input.agentRelPath) {
      // Saved agent path — load + assemble.
      const cleaned = input.agentRelPath.replace(/^\.\//, '');
      const abs = normalize(join(agentsRoot(), cleaned));
      if (!abs.startsWith(agentsRoot() + sep)) {
        throw new Error(`Path "${input.agentRelPath}" escapes the agents root`);
      }
      if (!existsSync(abs)) {
        throw new Error(`Agent file not found: ${input.agentRelPath}`);
      }
      const content = await readFile(abs, 'utf8');
      const parsed = abs.endsWith('.md')
        ? parseAgentMarkdown(content, input.agentRelPath)
        : parseAgentYaml(content, input.agentRelPath);
      // We can't import the renderer's assembleSystemPrompt without
      // pulling in vite-only paths. For the inner run we use a minimal
      // system prompt — the agent runtime resolves cli/mcp addenda
      // from agentTools anyway via the existing pipeline.
      systemPrompt = inlineSystemPromptFor(parsed);
      agentTools = parsed.tools;
      permissions = parsed.permissions;
      guardrails = parsed.guardrails;
      budget = parsed.budget;
      prompt = defaultUserPromptFor(parsed.trigger.kind);
      agentName = parsed.name;
      agentId = parsed.id;
      triggerKind = parsed.trigger.kind;
    } else {
      prompt = input.inlinePrompt ?? '';
      systemPrompt = input.inlineSystemPrompt;
      agentTools = input.inlineTools;
      // Inline runs synthesized by the Conductor MUST come with safe
      // defaults — without these, a runaway plan could spend unboundedly.
      // The Conductor can override by passing them explicitly later.
      guardrails = {
        permissionMode: 'default',
        maxTurns: 20,
      };
      budget = {
        tokens: 200_000,
        usd: 5,
        runtimeMs: 10 * 60 * 1000,
      };
    }

    // Resolve mcp + cli for the inner run, same as the agent:run handler.
    const mcp = await resolveAgentMcpServers(agentTools ?? []);
    const bashAllowPatterns = bashAllowPatternsFromTools(agentTools ?? []);

    // Each inner run gets its own AbortController so cancel_run / window
    // close can terminate it independently of the Conductor session.
    const innerAbort = new AbortController();
    runStoreMain.register({
      id: runId,
      agentId,
      agentName,
      abortController: innerAbort,
      workspaceId: this.workspaceId === 'default' ? null : this.workspaceId,
      ...(triggerKind !== undefined ? { triggerKind } : {}),
    });

    const runtimeReq: RuntimeRunRequest = {
      runId,
      prompt,
      agentSystemPrompt: systemPrompt,
      model: input.model,
      permissions,
      guardrails,
      budget,
      bashAllowPatterns,
      mcpServers: mcp.sdkServers,
      abortSignal: innerAbort.signal,
    };

    // Fire and forget. The agent-runtime emits events through its
    // callback; we forward them to the renderer tagged with runId so
    // the UI can render them under the Conductor turn.
    void runAgent(runtimeReq, (ev) => {
      this.bridge.forwardInnerRunEvents(runId, ev);
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.bridge.forwardInnerRunEvents(runId, {
        runId,
        type: 'failed',
        error: message,
        totals: { tokensIn: 0, tokensOut: 0, costUsd: 0, durationMs: 0 },
      });
    });

    return { runId };
  }
}

// ─── Local helpers — narrow versions of agent-prompt's renderer code ─────

function inlineSystemPromptFor(agent: {
  name: string;
  description?: string;
  body?: string;
  sections?: {
    goal?: { body: string };
    steps?: Array<{ title: string; body: { body: string } }>;
    rules?: Array<{ title: string; body: { body: string } }>;
    onFailure?: { body: string };
  };
  tools?: string[];
}): string {
  const parts: string[] = [];
  parts.push(`# ${agent.name}`);
  if (agent.description) parts.push(agent.description);
  if (agent.sections?.goal) parts.push(`## Goal\n\n${agent.sections.goal.body.trim()}`);
  if (agent.sections?.steps?.length) {
    const lines = agent.sections.steps
      .map((s, i) => `### Step ${i + 1} · ${s.title}\n\n${s.body.body.trim()}`)
      .join('\n\n');
    parts.push(`## Steps\n\n${lines}`);
  }
  if (agent.sections?.rules?.length) {
    const lines = agent.sections.rules
      .map((r) => `### ${r.title}\n\n${r.body.body.trim()}`)
      .join('\n\n');
    parts.push(`## Rules\n\n${lines}`);
  }
  if (agent.sections?.onFailure)
    parts.push(`## On failure\n\n${agent.sections.onFailure.body.trim()}`);
  if (agent.body?.trim()) parts.push(`## Overview\n\n${agent.body.trim()}`);
  return parts.join('\n\n');
}

function defaultUserPromptFor(kind: string): string {
  switch (kind) {
    case 'manual':
      return 'Begin executing the agent as described in the system prompt.';
    case 'webhook':
      return 'A webhook just fired. Process the payload according to your goal.';
    case 'cron':
      return 'Scheduled run. Execute the periodic work described in your goal.';
    case 'watch':
      return 'A watched source changed. Process the change according to your goal.';
    case 'event':
      return 'An event fired. Handle it.';
    default:
      return 'Begin.';
  }
}
