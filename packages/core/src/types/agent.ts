/**
 * Canonical Agent representation. The Agent IR.
 *
 * Both `.md` and `.yaml` source forms parse to this shape via the loader.
 * Re-exports the metadata types from the schema so consumers have one import.
 *
 * After loader resolution, `sections` holds inlined content (any `include:`
 * references have been replaced with the file body), and `includedFiles`
 * lists every external file that contributed to this agent — for the
 * "Source" tab's file tree.
 */

import type { AgentMeta } from '../schema';

export type AgentSource = 'markdown' | 'yaml';

/** A section after include-resolution — content is always inlined. */
export interface ResolvedSection {
  kind: 'inline' | 'include';
  body: string;
  /** When kind === 'include', the resolved file path (vite glob key). */
  sourcePath?: string;
}

export interface ResolvedRule {
  title: string;
  body: ResolvedSection;
  appliesTo?: string[];
}

export interface ResolvedStep {
  id?: string;
  title: string;
  body: ResolvedSection;
}

export interface ResolvedSections {
  goal?: ResolvedSection;
  rules?: ResolvedRule[];
  steps?: ResolvedStep[];
  onFailure?: ResolvedSection;
}

export interface AgentSourceFile {
  path: string;
  content: string;
}

export interface Agent extends Omit<AgentMeta, 'sections'> {
  /** Where this agent was loaded from */
  source: AgentSource;
  /** Absolute or workspace-relative path of the source file */
  sourcePath: string;
  /** The narrative body (markdown content, or YAML's `goal` field) */
  body: string;
  /** The original source text of the master file (for the source-view in the UI) */
  raw: string;
  /** Sections with all `include:` references resolved to inline content */
  sections?: ResolvedSections;
  /** Every external file that was included — for the source tree */
  includedFiles: AgentSourceFile[];

  createdAt: string;
  updatedAt: string;
}

// Re-export the metadata types so consumers can write `import { Trigger } from '@flowstate/core'`
export type {
  AgentMeta,
  Trigger,
  Budget,
  Permissions,
  Sections,
  Rule,
  Step,
  SectionSource,
} from '../schema';
