/**
 * The canonical Tool contract.
 *
 * Every tool, regardless of underlying transport (MCP / CLI / HTTP /
 * Composio / Skill / Shell / SDK), implements ToolAdapter. The agent
 * runtime, the tool registry UI, the marketplace, and the permission
 * gate all consume the same shape.
 *
 * Authoring a new tool kind = implementing this interface once.
 */

import type {
  ToolKind,
  ToolManifest,
  ToolAction,
  AuthStatus as ToolAuthStatus,
  ToolHealth as ToolHealthRecord,
} from './types/tool';

// ─── Lifecycle ────────────────────────────────────────────────────────────

export interface ToolAdapter {
  /** Returns the tool's manifest (identity, capabilities, brand, actions). */
  manifest(): Promise<ToolManifest>;

  /** Called once at registration. Wire up servers, validate config. */
  init(config: ToolConfig): Promise<void>;

  /** True if the tool can be invoked right now. */
  authStatus(): Promise<ToolAuthStatus>;

  /** Returns instructions or a UI flow for the user to complete auth. */
  authSetup?(): Promise<AuthFlow>;

  /** Liveness probe — used by the MCP pool's eviction logic. */
  health(): Promise<ToolHealthRecord>;

  /** Discoverable actions — for indexing + RAG resolver. */
  listActions(): Promise<ToolAction[]>;

  /** Execute one action. The runtime handles permissions + truncation outside. */
  invoke(
    action: string,
    args: Record<string, unknown>,
    opts?: InvokeOptions,
  ): Promise<ToolResult>;

  /** Optional cleanup — kill servers, close connections. */
  dispose?(): Promise<void>;
}

// ─── Config (per-kind) ───────────────────────────────────────────────────

export type ToolConfig =
  | McpConfig
  | CliConfig
  | HttpConfig
  | ComposioConfig
  | SkillConfig
  | ShellConfig
  | SdkConfig;

export interface McpConfig {
  kind: 'mcp';
  /** stdio command + args (most common) */
  command?: string;
  args?: string[];
  /** OR streamable-http server URL */
  url?: string;
  env?: Record<string, string>;
  /** How long to keep this server warm after the last call (ms). */
  idleTimeoutMs?: number;
}

export interface CliConfig {
  kind: 'cli';
  /** The base command, e.g. "gcloud", "gh", "stripe". */
  command: string;
  /** Required minimum version, optional. */
  requiredVersion?: string;
  /** Authentication is presumed already configured by the user (`gh auth login` etc.). */
  authProbeCommand?: string;
}

export interface HttpConfig {
  kind: 'http';
  baseUrl: string;
  auth?: HttpAuth;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
}

export type HttpAuth =
  | { type: 'bearer'; secretName: string }
  | { type: 'basic'; userSecret: string; passSecret: string }
  | { type: 'header'; headerName: string; secretName: string }
  | { type: 'oauth2'; tokenSecret: string };

export interface ComposioConfig {
  kind: 'composio';
  /** The Composio action name, e.g. "GMAIL_SEND_EMAIL". */
  action: string;
  /** Composio's connected-account id for the current user. */
  connectedAccountId?: string;
}

export interface SkillConfig {
  kind: 'skill';
  /** Path to the skill .md file (relative to the agents root). */
  path: string;
}

export interface ShellConfig {
  kind: 'shell';
  /** Path to the executable script. */
  path: string;
  /** Run inside the OS sandbox. */
  sandboxed?: boolean;
}

export interface SdkConfig {
  kind: 'sdk';
  /** The SDK module to load. */
  module: string;
  /** Construction options (API key refs, region, etc.). */
  options?: Record<string, unknown>;
}

// ─── Invocation ──────────────────────────────────────────────────────────

export interface InvokeOptions {
  signal?: AbortSignal;
  /** Hard cap on this single invocation. Falls back to provider config. */
  timeoutMs?: number;
  /** The agent's declared permissions — runtime checks against them before invoke. */
  agentPermissions?: AgentPermissionView;
  /** The current run id, for tracing + journal correlation. */
  runId?: string;
  /** Idempotency key for safe-to-retry calls. */
  idempotencyKey?: string;
}

export interface AgentPermissionView {
  network?: string[];
  fsRead?: string[];
  fsWrite?: string[];
  env?: string[];
}

export type ToolResult =
  | {
      ok: true;
      output: unknown;
      meta?: ToolMeta;
    }
  | {
      ok: false;
      error: string;
      /** True if the runtime should consider retrying. */
      recoverable?: boolean;
      meta?: ToolMeta;
    };

export interface ToolMeta {
  durationMs: number;
  bytesIn?: number;
  bytesOut?: number;
  /** For CLI tools — the exit code. */
  exitCode?: number;
  /** For HTTP tools — the response status. */
  httpStatus?: number;
  /** For MCP tools — server-reported tokens, if available. */
  tokens?: { input: number; output: number };
  /** Was the output truncated to fit the agent's context budget? */
  truncated?: boolean;
}

// ─── Auth ───────────────────────────────────────────────────────────────
// AuthStatus is re-exported from types/tool.ts for the canonical source.
export type { AuthStatus } from './types/tool';

export type AuthFlow =
  /** Open a browser to complete OAuth — receive callback. */
  | { kind: 'oauth'; url: string; redirectUri: string }
  /** Show a form for the user to paste credentials. */
  | { kind: 'form'; fields: AuthFormField[] }
  /** Run a shell command (e.g. `gcloud auth login`). */
  | { kind: 'shell'; command: string; instructions: string }
  /** Open an external URL with copy-paste instructions. */
  | { kind: 'manual'; url?: string; instructions: string };

export interface AuthFormField {
  name: string;
  label: string;
  /** Input type — controls UI affordance + storage. */
  type: 'text' | 'password' | 'url' | 'select';
  /** Where to store the value — keychain (preferred) or env. */
  storage: 'keychain' | 'env';
  required?: boolean;
  options?: string[]; // for select
  placeholder?: string;
  hint?: string;
}

// ─── Health ─────────────────────────────────────────────────────────────
// ToolHealth is re-exported from types/tool.ts for the canonical source.
export type { ToolHealth } from './types/tool';

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Parse a flowstate tool ref ("provider:id" or "provider:id.action") into parts.
 * Returns null if the ref doesn't match the expected shape.
 */
export function parseToolRef(ref: string): {
  kind: ToolKind;
  id: string;
  action?: string;
} | null {
  const colon = ref.indexOf(':');
  if (colon < 0) return null;
  const kind = ref.slice(0, colon) as ToolKind;
  const tail = ref.slice(colon + 1);
  const dot = tail.indexOf('.');
  if (dot < 0) return { kind, id: tail };
  return { kind, id: tail.slice(0, dot), action: tail.slice(dot + 1) };
}

/** Format a parsed ref back into "provider:id.action" form. */
export function formatToolRef(parts: { kind: ToolKind; id: string; action?: string }): string {
  return parts.action ? `${parts.kind}:${parts.id}.${parts.action}` : `${parts.kind}:${parts.id}`;
}
