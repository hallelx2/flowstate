/**
 * Canonical Agent representation. The Agent IR.
 *
 * Both `.md` and `.yaml` source forms parse to this shape via the loader.
 * Re-exports the metadata types from the schema so consumers have one import.
 */

import type { AgentMeta } from '../schema';

export type AgentSource = 'markdown' | 'yaml';

export interface Agent extends AgentMeta {
  /** Where this agent was loaded from */
  source: AgentSource;
  /** Absolute or workspace-relative path of the source file */
  sourcePath: string;
  /** The narrative body (markdown content, or YAML's `goal` field) */
  body: string;
  /** The original source text (for the source-view in the UI) */
  raw: string;

  createdAt: string;
  updatedAt: string;
}

// Re-export the metadata types so consumers can write `import { Trigger } from '@flowstate/core'`
export type { AgentMeta, Trigger, Budget, Permissions } from '../schema';
