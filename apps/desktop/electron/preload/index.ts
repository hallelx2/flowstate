import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

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
  /** Bash command patterns the gate allows. Generated from cli:* refs. */
  bashAllowPatterns?: string[];
  /**
   * MCP server config map. Keys are server ids; values are SDK-shaped
   * stdio/http/sse configs. Passed straight through to query() options.
   */
  mcpServers?: Record<
    string,
    | { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
    | { type: 'http'; url: string; headers?: Record<string, string> }
    | { type: 'sse'; url: string; headers?: Record<string, string> }
  >;
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

  // ─── Agent file persistence ───────────────────────────────────────────

  /** Read an agent file by vite-style relative path (./foo/bar.md). */
  readAgentFile: (relPath: string): Promise<string> =>
    ipcRenderer.invoke('agent:read', relPath),

  /** Write an agent file. Creates parent directories as needed. */
  writeAgentFile: (relPath: string, content: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('agent:write', { relPath, content }),

  /** Absolute filesystem root where agent files live (for display). */
  agentsRoot: (): Promise<string> => ipcRenderer.invoke('agent:root'),
};

contextBridge.exposeInMainWorld('flowstate', flowstateApi);

export type FlowstateApi = typeof flowstateApi;
