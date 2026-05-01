/**
 * Conductor hooks — the SDK's deep control surface.
 *
 * Phase 3 of the plan. Each hook lives here as a `HookCallback`-shaped
 * function and is wired into `query({ options: { hooks } })` in
 * conductor/runtime.ts.
 *
 * The SDK's exact `HookCallback` type is not stable across SDK minor
 * versions, so this module deliberately uses `unknown` at the boundary
 * and narrows internally. If the SDK exports stricter types in a later
 * version we tighten without touching call sites.
 */

import { existsSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { conductorArchiveDir, conductorAuditDir } from '../paths';
import { DESTRUCTIVE_TOOLS } from './constants';
import { maskForAudit } from './redaction';

// Generic hook input/output types — the SDK passes a discriminated union;
// we narrow per-event below.
type HookOutput = {
  systemMessage?: string;
  hookSpecificOutput?: {
    hookEventName?: string;
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
  };
  async?: boolean;
};
type HookInput = Record<string, unknown> & { hook_event_name?: string };
type HookCb = (input: HookInput, toolUseId: string | undefined, ctx: { signal: AbortSignal }) => Promise<HookOutput>;

// ─── Audit log ────────────────────────────────────────────────────────────

async function appendAudit(sessionId: string, line: unknown): Promise<void> {
  const dir = conductorAuditDir();
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  await appendFile(path, JSON.stringify(line) + '\n', 'utf8');
}

// ─── UserPromptSubmit: inject workspace snapshot ──────────────────────────

export interface WorkspaceSnapshot {
  workspaceName: string | null;
  cwd: string | null;
  installedMcpIds: string[];
  cliFamiliesInstalled: string[];
  populatedSecrets: string[];
  recentRuns: Array<{ id: string; agentName: string; status: string }>;
}

export function makeUserPromptSubmitHook(
  getSnapshot: () => Promise<WorkspaceSnapshot>,
): HookCb {
  return async () => {
    const snap = await getSnapshot();
    const lines: string[] = [];
    lines.push('## Workspace context');
    lines.push(`- Active workspace: ${snap.workspaceName ?? '(none)'}`);
    if (snap.cwd) lines.push(`- Working directory: \`${snap.cwd}\``);
    if (snap.installedMcpIds.length > 0) {
      lines.push(
        `- Installed MCP servers: ${snap.installedMcpIds.map((s) => `\`${s}\``).join(', ')}`,
      );
    } else {
      lines.push('- Installed MCP servers: none yet');
    }
    if (snap.cliFamiliesInstalled.length > 0) {
      lines.push(
        `- CLIs on PATH: ${snap.cliFamiliesInstalled.map((s) => `\`${s}\``).join(', ')}`,
      );
    }
    if (snap.populatedSecrets.length > 0) {
      lines.push(
        `- Secrets in keychain: ${snap.populatedSecrets.map((s) => `\`${s}\``).join(', ')}`,
      );
    }
    if (snap.recentRuns.length > 0) {
      lines.push('- Recent runs:');
      for (const r of snap.recentRuns.slice(0, 5)) {
        lines.push(`  - ${r.agentName} (${r.status})`);
      }
    }
    return { systemMessage: lines.join('\n') };
  };
}

// ─── PreToolUse: HITL gate + audit ────────────────────────────────────────

export interface HitlBridge {
  /**
   * Surface a banner asking the user to approve a destructive tool call.
   * Returns true on approve, false on deny. The bridge is responsible for
   * the IPC roundtrip and timeout.
   */
  requestApproval: (req: {
    toolName: string;
    input: Record<string, unknown>;
    toolUseId?: string;
  }) => Promise<{ approved: boolean; reason?: string }>;
}

// Audit-log redaction lives in ./redaction so the offline smoke test can
// import it without Electron in the dependency graph.

export function makeAuditHook(getSessionId: () => string | null): HookCb {
  return async (input) => {
    const event = input['hook_event_name'] as string | undefined;
    const sessionId = getSessionId() ?? 'unknown';
    const toolName = (input['tool_name'] as string | undefined) ?? '';
    const toolInput = (input['tool_input'] as Record<string, unknown> | undefined) ?? {};
    try {
      await appendAudit(sessionId, {
        ts: new Date().toISOString(),
        event,
        tool: toolName,
        input: maskForAudit(toolName, toolInput),
      });
    } catch {
      // Auditing failures must never block the run.
    }
    return {};
  };
}

export function makeHitlGateHook(bridge: HitlBridge): HookCb {
  return async (input, toolUseId) => {
    const toolName = (input['tool_name'] as string | undefined) ?? '';
    const toolInput = (input['tool_input'] as Record<string, unknown> | undefined) ?? {};
    if (!DESTRUCTIVE_TOOLS.has(toolName)) return {};
    const decision = await bridge.requestApproval({
      toolName,
      input: maskForAudit(toolName, toolInput),
      toolUseId,
    });
    if (!decision.approved) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: decision.reason ?? 'Denied by user',
        },
      };
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Approved by user',
      },
    };
  };
}

// ─── Subagent phase chips ─────────────────────────────────────────────────

export interface PhaseBridge {
  notifyPhase: (phase: { kind: 'start' | 'stop'; subagent?: string }) => void;
}

export function makeSubagentStartHook(bridge: PhaseBridge): HookCb {
  return async (input) => {
    const subagent = input['subagent_name'] as string | undefined;
    bridge.notifyPhase({ kind: 'start', subagent });
    return {};
  };
}

export function makeSubagentStopHook(bridge: PhaseBridge): HookCb {
  return async (input) => {
    const subagent = input['subagent_name'] as string | undefined;
    bridge.notifyPhase({ kind: 'stop', subagent });
    return {};
  };
}

// ─── Notification → toast ─────────────────────────────────────────────────

export interface ToastBridge {
  toast: (msg: { kind: 'info' | 'warn' | 'error'; text: string }) => void;
}

export function makeNotificationHook(bridge: ToastBridge): HookCb {
  return async (input) => {
    const text = (input['message'] as string | undefined) ?? '';
    const subtype = (input['subtype'] as string | undefined) ?? '';
    if (!text) return {};
    const kind: 'info' | 'warn' | 'error' = subtype.includes('error')
      ? 'error'
      : subtype.includes('warn')
        ? 'warn'
        : 'info';
    bridge.toast({ kind, text });
    return {};
  };
}

// ─── PreCompact: archive transcript before SDK truncates ──────────────────

export function makePreCompactHook(getSessionId: () => string | null): HookCb {
  return async (input) => {
    const sessionId = getSessionId() ?? 'unknown';
    try {
      const dir = conductorArchiveDir();
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      const path = join(dir, `${sessionId}-${Date.now()}.json`);
      await writeFile(path, JSON.stringify(input, null, 2), 'utf8');
    } catch {
      // Archive failures are non-fatal.
    }
    return {};
  };
}

// ─── PostToolUse: dispatch-run forwarder ──────────────────────────────────

export interface DispatchBridge {
  /** Called when the Conductor's dispatch_agent_run tool returns successfully. */
  onDispatch: (info: { runId: string; turnId?: string }) => void;
}

export function makePostToolUseHook(bridge: DispatchBridge): HookCb {
  return async (input) => {
    const toolName = (input['tool_name'] as string | undefined) ?? '';
    if (!toolName.endsWith('dispatch_agent_run')) return {};
    const result = input['tool_response'] as { content?: Array<{ text?: string }> } | undefined;
    const text = result?.content?.[0]?.text ?? '';
    try {
      const parsed = JSON.parse(text) as { runId?: string };
      if (parsed.runId) {
        bridge.onDispatch({ runId: parsed.runId });
      }
    } catch {
      // Non-JSON dispatch result — ignore.
    }
    return {};
  };
}

// ─── Bundle helper ────────────────────────────────────────────────────────

export interface ConductorHookBridges {
  workspace: () => Promise<WorkspaceSnapshot>;
  hitl: HitlBridge;
  phase: PhaseBridge;
  toast: ToastBridge;
  dispatch: DispatchBridge;
  getSessionId: () => string | null;
}

/**
 * Build the `hooks` object passed to query() options. The SDK accepts an
 * object keyed by event name, each value being an array of
 * `{ matcher?, hooks: HookCallback[] }` entries.
 */
export function buildConductorHooks(b: ConductorHookBridges) {
  return {
    UserPromptSubmit: [{ hooks: [makeUserPromptSubmitHook(b.workspace)] }],
    PreToolUse: [
      {
        hooks: [makeAuditHook(b.getSessionId), makeHitlGateHook(b.hitl)],
      },
    ],
    PostToolUse: [{ hooks: [makePostToolUseHook(b.dispatch)] }],
    SubagentStart: [{ hooks: [makeSubagentStartHook(b.phase)] }],
    SubagentStop: [{ hooks: [makeSubagentStopHook(b.phase)] }],
    Notification: [{ hooks: [makeNotificationHook(b.toast)] }],
    PreCompact: [{ hooks: [makePreCompactHook(b.getSessionId)] }],
  };
}
