/**
 * Tool manifest. One shape, many providers.
 */

export type ToolKind = 'mcp' | 'cli' | 'http' | 'composio' | 'skill' | 'shell' | 'sdk';

export type AuthKind = 'oauth2' | 'api_key' | 'ambient' | 'none';

export type AuthStatus = 'ready' | 'needs_setup' | 'expired' | 'unknown';

export interface ToolAuth {
  kind: AuthKind;
  scopes?: string[];
  /** Env var names this tool needs */
  required?: string[];
  /** Shell command to verify auth is good */
  statusCheck?: string;
}

export interface ToolAction {
  id: string;
  summary: string;
  inputs?: Record<string, { type: string; required?: boolean; default?: unknown }>;
  outputs?: { format?: 'json' | 'text' | 'binary' };
}

export interface ToolManifest {
  id: string;
  name: string;
  kind: ToolKind;
  /** Path to icon, or `iconify:logos:gmail` */
  icon?: string;
  brandColor?: string;
  description: string;
  /** Semantic capability tags — used by RAG resolver */
  capabilities: string[];
  tags?: string[];
  publisher?: 'official' | 'community' | 'custom';
  version?: string;

  auth: ToolAuth;
  authStatus?: AuthStatus;

  /** Provider-specific bits, opaque to runtime contract */
  provider: Record<string, unknown>;

  actions: ToolAction[];

  ui?: {
    category?: string;
    configFormPath?: string;
    testAction?: string;
  };
}

export interface ToolHealth {
  toolId: string;
  status: 'ok' | 'degraded' | 'down';
  latencyMs?: number;
  lastChecked: string;
  error?: string;
}
