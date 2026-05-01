/**
 * A flowstate workspace = a named collection of agent dirs + model defaults
 * + run history. Persisted in SQLite (see apps/desktop/electron/main/workspace-db.ts).
 *
 * Today this struct is metadata only — switching workspaces does NOT yet
 * rebind the agent loader's source directory (that lives behind a vite
 * glob and needs its own pass). It DOES drive the workspace switcher in
 * the title bar and survives restarts.
 */

export type WorkspaceProvider = 'subscription' | 'api' | 'local';

export interface Workspace {
  id: string;
  name: string;
  agentsDir: string | null;
  runsDir: string | null;
  toolsDir: string | null;
  model: string | null;
  provider: WorkspaceProvider | null;
  color: string | null;
  createdAt: string;
  lastOpenedAt: string;
}

export interface WorkspaceInput {
  name: string;
  agentsDir?: string | null;
  runsDir?: string | null;
  toolsDir?: string | null;
  model?: string | null;
  provider?: WorkspaceProvider | null;
  color?: string | null;
}
