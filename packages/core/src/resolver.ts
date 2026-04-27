/**
 * Capability resolver + permission gate.
 *
 * Two pure functions, no I/O — designed to run in either main or renderer.
 *
 * resolveCapabilities() — matches the agent's `needs:` list against
 *   the installed tool registry and returns which tools satisfy each
 *   capability, plus anything that couldn't be resolved.
 *
 * checkPermissions() — given a single tool invocation, decides whether
 *   it's allowed under the agent's declared `permissions:` and
 *   `guardrails:`. The runtime calls this inside `canUseTool` BEFORE
 *   showing the HITL banner.
 */

import type { Guardrails, Permissions } from './schema';
import type { ToolManifest } from './types/tool';
import { bashCommandAllowed } from './cli-tools';

// ─── Capability resolver ──────────────────────────────────────────────────

export interface ResolvedCapability {
  capability: string;
  toolRef: string;
  toolName: string;
  /** Why this tool was picked (e.g. "best ready match"). */
  reason: string;
}

export interface ResolveResult {
  resolved: ResolvedCapability[];
  /** Capabilities that no installed tool advertises. */
  unresolved: string[];
  /** Soft issues — capability matched but tool needs setup, etc. */
  warnings: string[];
}

/**
 * Picks one tool per capability from the installed registry.
 *
 * Picking strategy (deterministic):
 *   1. Tools with authStatus === 'ready' before any other status
 *   2. Tools the user has marked as preferred for this capability (future)
 *   3. Lexicographic tool-id order (so reruns are stable)
 *
 * Skill / shell / sdk tools without an explicit auth status count as ready.
 */
export function resolveCapabilities(
  needs: string[] | undefined,
  registry: ToolManifest[],
): ResolveResult {
  const resolved: ResolvedCapability[] = [];
  const unresolved: string[] = [];
  const warnings: string[] = [];

  if (!needs || needs.length === 0) {
    return { resolved, unresolved, warnings };
  }

  for (const cap of needs) {
    const matches = registry
      .filter((t) => t.capabilities.includes(cap))
      .sort((a, b) => {
        const aReady = (a.authStatus ?? 'ready') === 'ready' ? 0 : 1;
        const bReady = (b.authStatus ?? 'ready') === 'ready' ? 0 : 1;
        if (aReady !== bReady) return aReady - bReady;
        return a.id.localeCompare(b.id);
      });

    if (matches.length === 0) {
      unresolved.push(cap);
      continue;
    }

    const best = matches[0]!;
    const toolRef = `${best.kind}:${best.id}`;
    resolved.push({
      capability: cap,
      toolRef,
      toolName: best.name,
      reason:
        (best.authStatus ?? 'ready') === 'ready'
          ? 'best ready match'
          : `selected (auth: ${best.authStatus ?? 'unknown'})`,
    });

    if ((best.authStatus ?? 'ready') !== 'ready') {
      warnings.push(`${cap} resolved to ${toolRef} but auth is "${best.authStatus}"`);
    }
  }

  return { resolved, unresolved, warnings };
}

/**
 * Combine the agent's explicit `tools:` list with the resolved tools
 * from `needs:`, deduped. The runtime uses this as the *intent* of which
 * provider:id tools the agent is allowed to invoke.
 */
export function effectiveToolRefs(
  explicitTools: string[] | undefined,
  resolved: ResolvedCapability[],
): string[] {
  const set = new Set<string>(explicitTools ?? []);
  for (const r of resolved) set.add(r.toolRef);
  return [...set];
}

// ─── Permission gate ──────────────────────────────────────────────────────

export interface PermissionDecision {
  /** allow → continue (may still hit HITL); deny → never invoke. */
  decision: 'allow' | 'deny' | 'requires_approval';
  reason?: string;
}

/**
 * Decide whether `toolName` can be invoked with `input`, given the agent's
 * declared permissions + guardrails. Pure function — call once per invocation.
 *
 * The five checks, short-circuit in order:
 *   1. guardrails.disallowedTools  → deny
 *   2. guardrails.allowedTools (if set, deny unlisted)
 *   3. permissions.network / fs policy on `input`
 *   4. Bash command allowlist (when supplied) — denies any shell command
 *      not matching a known cli:* tool template
 *   5. permissions.approvalRequired  → requires_approval
 *
 * The runtime maps:
 *   allow             → invoke (may still hit canUseTool's HITL flow)
 *   deny              → return { behavior: 'deny', message: reason }
 *   requires_approval → route to HITL banner regardless of permissionMode
 */
export function checkPermissions(
  toolName: string,
  input: Record<string, unknown>,
  permissions: Permissions | undefined,
  guardrails: Guardrails | undefined,
  /** Bash command patterns derived from `tools: [cli:*]`. Empty/undefined = no bash restriction. */
  bashAllowPatterns?: string[],
): PermissionDecision {
  // 1. Disallowed list — hard block.
  if (guardrails?.disallowedTools?.includes(toolName)) {
    return {
      decision: 'deny',
      reason: `Tool "${toolName}" is in the agent's disallowedTools list.`,
    };
  }

  // 2. Allowlist — if set, anything not listed is denied.
  if (guardrails?.allowedTools && guardrails.allowedTools.length > 0) {
    if (!guardrails.allowedTools.includes(toolName)) {
      return {
        decision: 'deny',
        reason: `Tool "${toolName}" is not in the agent's allowedTools list.`,
      };
    }
  }

  // 3. Permission scopes — apply to the SDK's built-in tool families.
  if (permissions) {
    const networkCheck = checkNetwork(toolName, input, permissions);
    if (networkCheck) return networkCheck;

    const fsCheck = checkFilesystem(toolName, input, permissions);
    if (fsCheck) return fsCheck;
  }

  // 4. Bash command allowlist — when the agent declared cli:* tools,
  //    every Bash invocation must match one of the resolved templates.
  if (toolName === 'Bash' && bashAllowPatterns && bashAllowPatterns.length > 0) {
    const command = stringField(input, ['command']);
    if (!command) {
      return { decision: 'deny', reason: 'Bash invocation missing `command` field' };
    }
    if (!bashCommandAllowed(command, bashAllowPatterns)) {
      return {
        decision: 'deny',
        reason:
          `Bash command not allowed: \`${command}\`. ` +
          `This agent has only declared the cli:* tools listed in its frontmatter. ` +
          `Add the relevant cli:* ref to the agent's tools, or ask the user.`,
      };
    }
  }

  // 5. Forced-approval list — surfaces the HITL banner regardless of mode.
  if (permissions?.approvalRequired?.includes(toolName)) {
    return {
      decision: 'requires_approval',
      reason: `${toolName} is in approvalRequired — human confirmation needed`,
    };
  }

  return { decision: 'allow' };
}

// ─── Per-scope helpers ────────────────────────────────────────────────────

function checkNetwork(
  toolName: string,
  input: Record<string, unknown>,
  permissions: Permissions,
): PermissionDecision | null {
  if (!permissions.network || permissions.network.length === 0) return null;
  if (toolName !== 'WebFetch' && toolName !== 'WebSearch') return null;

  const url = (input['url'] as string | undefined) ?? (input['query'] as string | undefined);
  if (!url || !/^https?:\/\//i.test(url)) return null;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { decision: 'deny', reason: `Invalid URL "${url}"` };
  }

  const allowed = permissions.network.some(
    (d) => host === d || host.endsWith(`.${d}`),
  );
  if (!allowed) {
    return {
      decision: 'deny',
      reason: `Network access to "${host}" is not in permissions.network. Allowed: ${permissions.network.join(', ')}`,
    };
  }
  return null;
}

function checkFilesystem(
  toolName: string,
  input: Record<string, unknown>,
  permissions: Permissions,
): PermissionDecision | null {
  if (!permissions.fs) return null;

  // Read-side tools
  if ((toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob') && permissions.fs.read) {
    const path = stringField(input, ['path', 'file_path', 'pattern']);
    if (path && !pathIsAllowed(path, permissions.fs.read)) {
      return {
        decision: 'deny',
        reason: `Read of "${path}" is not in permissions.fs.read. Allowed: ${permissions.fs.read.join(', ')}`,
      };
    }
  }

  // Write-side tools
  if ((toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') && permissions.fs.write) {
    const path = stringField(input, ['file_path', 'path']);
    if (path && !pathIsAllowed(path, permissions.fs.write)) {
      return {
        decision: 'deny',
        reason: `Write to "${path}" is not in permissions.fs.write. Allowed: ${permissions.fs.write.join(', ')}`,
      };
    }
  }

  return null;
}

function stringField(input: Record<string, unknown>, names: string[]): string | undefined {
  for (const n of names) {
    const v = input[n];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/**
 * True if `path` is contained within (or equal to) any allowed prefix.
 * Naive but sufficient for v1 — absolute + relative both work, glob
 * support is deferred to v2.
 */
function pathIsAllowed(path: string, allowedPrefixes: string[]): boolean {
  return allowedPrefixes.some((prefix) => {
    if (path === prefix) return true;
    const normalized = prefix.endsWith('/') || prefix.endsWith('\\') ? prefix : prefix + '/';
    return path.startsWith(normalized) || path.startsWith(prefix + '\\');
  });
}
