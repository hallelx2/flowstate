import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  FetchResult,
  MarketplaceSourceId,
  McpServerDef,
  Settings,
  Workspace,
  WorkspaceInput,
} from '@flowstate/core';

export type PlatformInfo = {
  platform: NodeJS.Platform;
  arch: string;
  version: string;
  node: string;
  electron: string;
};

export interface RunRequest {
  runId: string;
  prompt: string;
  agentSystemPrompt?: string;
  allowedTools?: string[];
  cwd?: string;
  model?: string;
  /**
   * Agent's declared tool refs (`mcp:*`, `cli:*`). Main resolves these
   * server-side: builds the SDK mcpServers map (decrypting env vars from
   * the keychain) + the bash allowlist. The renderer never sees decrypted
   * secrets.
   */
  agentTools?: string[];
  /** Declared agent permissions — runtime enforces in canUseTool. */
  permissions?: {
    network?: string[];
    fs?: { read?: string[]; write?: string[] };
    env?: string[];
    approvalRequired?: string[];
  };
  /** Declared agent guardrails — mapped to SDK query options. */
  guardrails?: {
    permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
    maxTurns?: number;
    allowedTools?: string[];
    disallowedTools?: string[];
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number;
  };
  /** Hard caps. Runtime aborts when any limit is exceeded. */
  budget?: {
    tokens?: number;
    usd?: number;
    runtimeMs?: number;
  };
}

/** Self-test result — surfaces auth + SDK reachability to the Settings UI. */
export interface SelfTestResult {
  ok: boolean;
  message: string;
  apiKeySource?: 'keychain' | 'env' | 'none';
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
}

export interface AgentEvent {
  runId: string;
  type: 'started' | 'step' | 'completed' | 'failed';
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
  totals?: { tokensIn: number; tokensOut: number; costUsd: number; durationMs: number };
  error?: string;
}

/** Human-in-the-loop request the SDK sends through canUseTool. */
export interface ApprovalRequest {
  runId: string;
  toolUseID: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
  decisionReason?: string;
  blockedPath?: string;
}

export interface ApprovalResponse {
  toolUseID: string;
  approved: boolean;
  message?: string;
}

const flowstateApi = {
  platform: (): Promise<PlatformInfo> => ipcRenderer.invoke('flowstate:platform'),

  /** Spawn an agent run via the Claude Agent SDK in the main process. */
  runAgent: (req: RunRequest): Promise<void> => ipcRenderer.invoke('agent:run', req),

  /** Cancel an in-flight run. Returns true if the run was found. */
  cancelAgent: (runId: string): Promise<boolean> => ipcRenderer.invoke('agent:cancel', runId),

  /** Subscribe to streaming agent events. Returns an unsubscribe fn. */
  onAgentEvent: (cb: (event: AgentEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, ev: AgentEvent) => cb(ev);
    ipcRenderer.on('agent:event', handler);
    return () => ipcRenderer.off('agent:event', handler);
  },

  /**
   * Subscribe to permission-approval requests from the SDK. Triggered when
   * Claude wants to call a tool that needs user confirmation.
   */
  onApprovalRequest: (cb: (req: ApprovalRequest) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, req: ApprovalRequest) => cb(req);
    ipcRenderer.on('agent:approval-request', handler);
    return () => ipcRenderer.off('agent:approval-request', handler);
  },

  /** Resolve a pending approval. The SDK's canUseTool Promise resolves here. */
  respondToApproval: (payload: ApprovalResponse): Promise<boolean> =>
    ipcRenderer.invoke('agent:approval-response', payload),

  /**
   * Smoke-test the SDK end-to-end. Sends a one-token prompt with no tools
   * to verify that auth resolves and the SDK is reachable. Used by the
   * Settings → Test connection button.
   */
  agentSelfTest: (): Promise<SelfTestResult> => ipcRenderer.invoke('agent:selftest'),

  // ─── Conductor (intelligent composer) ────────────────────────────────
  // The Conductor is one long-lived `query()` per window. Renderer pushes
  // user turns via send() and subscribes to event / approval / user-input
  // streams to render the chat.

  conductorStart: (): Promise<{ ok: true }> =>
    ipcRenderer.invoke('conductor:start'),

  conductorSend: (text: string): Promise<{ turnId: string }> =>
    ipcRenderer.invoke('conductor:send', { text }),

  conductorInterrupt: (): Promise<boolean> =>
    ipcRenderer.invoke('conductor:interrupt'),

  conductorSetPermissionMode: (
    mode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions',
  ): Promise<boolean> =>
    ipcRenderer.invoke('conductor:set-permission-mode', mode),

  /** Subscribe to the Conductor's streaming events. Returns unsubscribe. */
  onConductorEvent: (cb: (ev: unknown) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, ev: unknown) => cb(ev);
    ipcRenderer.on('conductor:event', handler);
    return () => ipcRenderer.off('conductor:event', handler);
  },

  /** Subscribe to destructive-tool approval requests from the Conductor. */
  onConductorApprovalRequest: (
    cb: (req: { id: string; toolName: string; input: Record<string, unknown> }) => void,
  ): (() => void) => {
    const handler = (
      _e: IpcRendererEvent,
      req: { id: string; toolName: string; input: Record<string, unknown> },
    ) => cb(req);
    ipcRenderer.on('conductor:approval-request', handler);
    return () => ipcRenderer.off('conductor:approval-request', handler);
  },

  conductorRespondApproval: (
    payload: { id: string; approved: boolean; reason?: string },
  ): Promise<boolean> => ipcRenderer.invoke('conductor:approval-response', payload),

  /** Subscribe to free-form ask_user / set_secret prompt cards. */
  onConductorUserInputRequest: (
    cb: (req: {
      id: string;
      question: string;
      placeholder?: string;
      secret?: boolean;
    }) => void,
  ): (() => void) => {
    const handler = (
      _e: IpcRendererEvent,
      req: { id: string; question: string; placeholder?: string; secret?: boolean },
    ) => cb(req);
    ipcRenderer.on('conductor:user-input-request', handler);
    return () => ipcRenderer.off('conductor:user-input-request', handler);
  },

  conductorRespondUserInput: (
    payload: { id: string; answer?: string; cancelled?: boolean },
  ): Promise<boolean> => ipcRenderer.invoke('conductor:user-input-response', payload),

  // ─── Agent file persistence ───────────────────────────────────────────

  /** Read an agent file by vite-style relative path (./foo/bar.md). */
  readAgentFile: (relPath: string): Promise<string> =>
    ipcRenderer.invoke('agent:read', relPath),

  /** Write an agent file. Creates parent directories as needed. */
  writeAgentFile: (relPath: string, content: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('agent:write', { relPath, content }),

  /** Absolute filesystem root where agent files live (for display). */
  agentsRoot: (): Promise<string> => ipcRenderer.invoke('agent:root'),

  // ─── Settings persistence ────────────────────────────────────────────

  /** Read the user's settings.json. Returns {} when the file is absent. */
  readSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:read'),

  /**
   * Apply a deep-partial patch to settings.json. The main process merges
   * with the on-disk version, validates against the schema, then writes
   * atomically. Returns the validated, merged result.
   */
  writeSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:write', patch),

  /** Absolute path to settings.json (for display in About / Privacy). */
  settingsPath: (): Promise<string> => ipcRenderer.invoke('settings:path'),

  // ─── MCP marketplace ─────────────────────────────────────────────────
  // The renderer doesn't make outbound HTTP itself — main fetches the
  // public registries, normalizes results into McpServerDef shape, and
  // returns them. Installs round-trip back to disk so they survive restarts.

  /**
   * Search the live marketplace. `source` defaults to the official MCP
   * registry; pass 'glama' for the long-tail community catalogue. The
   * result is paginated — pass `cursor` to fetch the next page.
   */
  marketplaceSearch: (params: {
    source?: MarketplaceSourceId;
    search?: string;
    cursor?: string;
    limit?: number;
  }): Promise<FetchResult> => ipcRenderer.invoke('marketplace:search', params),

  /** List the user's installed MCP server definitions (under ~/.flowstate/tools/mcp/). */
  marketplaceListInstalled: (): Promise<McpServerDef[]> =>
    ipcRenderer.invoke('marketplace:list-installed'),

  /** Persist a chosen server def to disk so it joins the runtime registry. */
  marketplaceInstall: (def: McpServerDef): Promise<{ id: string; path: string }> =>
    ipcRenderer.invoke('marketplace:install', def),

  /** Remove an installed server def. */
  marketplaceUninstall: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('marketplace:uninstall', id),

  /**
   * Pull the ENTIRE catalogue (paginated under the hood) and return it
   * deduped + A→Z sorted. Cached on disk for 6 hours so subsequent opens
   * are instant. Pass `force: true` to bypass the cache.
   */
  marketplaceFetchAll: (params?: {
    source?: MarketplaceSourceId;
    force?: boolean;
  }): Promise<{
    source: MarketplaceSourceId;
    servers: McpServerDef[];
    fetchedAt: string;
    fromCache: boolean;
  }> => ipcRenderer.invoke('marketplace:fetch-all', params ?? {}),

  /**
   * Subscribe to fetch-all progress events while the catalogue downloads
   * (one message per page completed). Returns an unsubscribe.
   */
  onMarketplaceProgress: (
    cb: (info: { source: MarketplaceSourceId; loaded: number; page: number }) => void,
  ): (() => void) => {
    const handler = (
      _e: IpcRendererEvent,
      info: { source: MarketplaceSourceId; loaded: number; page: number },
    ) => cb(info);
    ipcRenderer.on('marketplace:progress', handler);
    return () => ipcRenderer.off('marketplace:progress', handler);
  },

  // ─── Secrets keychain (env-var values for installed MCP servers) ──────
  // Stored on disk in <userData>/secrets.json (encrypted via Electron
  // safeStorage on platforms that support it; plaintext fallback otherwise
  // — main warns in console if the OS doesn't support encryption).

  /** Read whether a given env-var name has a value stored (NOT the value itself). */
  secretsList: (): Promise<string[]> => ipcRenderer.invoke('secrets:list'),

  /** Set / overwrite a secret's value. */
  secretsSet: (name: string, value: string): Promise<boolean> =>
    ipcRenderer.invoke('secrets:set', { name, value }),

  /** Delete a secret. */
  secretsDelete: (name: string): Promise<boolean> =>
    ipcRenderer.invoke('secrets:delete', name),

  // ─── CLI tool family catalog ──────────────────────────────────────────
  // Renderer asks main to probe the local machine — does this CLI exist
  // on PATH? Is it authenticated? Main shells out (with a short timeout)
  // and returns booleans + version strings. Renderer never spawns child
  // processes itself.

  /**
   * Probe a single CLI family — runs its `versionProbe` with a 3s timeout
   * and returns whether it succeeded, plus the captured stdout (so the
   * detail panel can show the version string).
   */
  cliProbe: (familyId: string): Promise<{
    installed: boolean;
    version?: string;
    error?: string;
  }> => ipcRenderer.invoke('cli:probe', familyId),

  /** Probe ALL families in the catalogue. Parallel, returns one entry per family id. */
  cliProbeAll: (): Promise<Record<string, { installed: boolean; version?: string }>> =>
    ipcRenderer.invoke('cli:probe-all'),

  /**
   * Probe whether the CLI is currently authenticated. Only meaningful for
   * families with `auth.kind === 'command'` (where there's a probe to run).
   * Returns null when the family doesn't have an auth probe.
   */
  cliAuthProbe: (familyId: string): Promise<{ authenticated: boolean; output?: string } | null> =>
    ipcRenderer.invoke('cli:auth-probe', familyId),

  /**
   * Spawn the auth command in a detached terminal window so the user
   * completes the OAuth / device-code flow themselves. Returns true if
   * the spawn succeeded — completion is detected via subsequent
   * cliAuthProbe calls.
   */
  cliRunAuth: (familyId: string): Promise<boolean> =>
    ipcRenderer.invoke('cli:run-auth', familyId),

  /** Open an external URL (the install page) in the user's default browser. */
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('flowstate:open-external', url),

  /** OS this main process is running on — drives platform-specific install steps. */
  platformId: (): NodeJS.Platform => process.platform,

  // ─── Workspaces (SQLite-backed) ───────────────────────────────────────
  // Backed by flowstate.db (better-sqlite3) in the main process. The
  // renderer never touches the DB directly — every call round-trips
  // through IPC so we keep the single-writer guarantee.

  /** Every workspace, most-recently-opened first. */
  workspaceList: (): Promise<Workspace[]> => ipcRenderer.invoke('workspace:list'),

  /** The currently active workspace, or null if the DB hasn't seeded yet. */
  workspaceActive: (): Promise<Workspace | null> => ipcRenderer.invoke('workspace:active'),

  /** Create a new workspace. Returns the persisted row (with id + timestamps). */
  workspaceCreate: (input: WorkspaceInput): Promise<Workspace> =>
    ipcRenderer.invoke('workspace:create', input),

  /** Patch any subset of fields. Omitted fields stay as-is. */
  workspaceUpdate: (id: string, patch: Partial<WorkspaceInput>): Promise<Workspace | null> =>
    ipcRenderer.invoke('workspace:update', { id, patch }),

  /** Mark a workspace active + bump its lastOpenedAt. */
  workspaceSwitch: (id: string): Promise<Workspace | null> =>
    ipcRenderer.invoke('workspace:switch', id),

  /** Delete a workspace. Throws if it's the only one. */
  workspaceDelete: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('workspace:delete', id),
};

contextBridge.exposeInMainWorld('flowstate', flowstateApi);

export type FlowstateApi = typeof flowstateApi;
