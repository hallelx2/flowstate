/**
 * Agent file loaders.
 *
 * Parses `.md` (with YAML frontmatter) or pure `.yaml` files into the
 * canonical Agent IR. Validates against the Zod schema — invalid files
 * throw with a precise error path.
 *
 * Composability: master agent files can reference external markdown via
 * `{ include: "./relative/path.md" }` in the `sections` block. The loader
 * resolves these against a caller-supplied FileRegistry, inlines their
 * content into the AST, AND records the resolved source paths so the UI
 * can show the original file tree.
 *
 * Browser-safe: uses only `yaml` and a hand-rolled frontmatter splitter
 * (no Node-specific deps), so the renderer can parse files just like
 * the main process can.
 */

import YAML from 'yaml';
import {
  AgentMetaSchema,
  type AgentMeta,
  type Sections,
  type SectionSource,
} from './schema';
import type { Agent, ResolvedSection, ResolvedSections, AgentSourceFile } from './types/agent';

const FRONTMATTER_RE = /^---\r?\n([\s\S]+?)\r?\n---\r?\n?([\s\S]*)$/;

export class AgentParseError extends Error {
  constructor(
    public readonly sourcePath: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[${sourcePath}] ${message}`);
    this.name = 'AgentParseError';
  }
}

/**
 * Caller-provided file registry for resolving `include:` paths.
 * Implementations can read from disk, from a vite glob bundle, or
 * from in-memory test fixtures — the loader doesn't care.
 */
export interface FileRegistry {
  /** Resolve an include path (relative to parentPath) and return its content + canonical key. */
  resolve(parentPath: string, includePath: string): { path: string; content: string } | null;
}

// ─── Frontmatter ──────────────────────────────────────────────────────────

function splitFrontmatter(source: string): { meta: unknown; body: string } {
  const match = source.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error('Missing YAML frontmatter (expected leading `---` block)');
  }
  const [, yamlBlock, body] = match;
  return {
    meta: YAML.parse(yamlBlock!),
    body: (body ?? '').trim(),
  };
}

function isoNow(): string {
  return new Date().toISOString();
}

// ─── Section resolution ───────────────────────────────────────────────────

function resolveSection(
  src: SectionSource,
  parentPath: string,
  files: FileRegistry | undefined,
  collected: AgentSourceFile[],
): ResolvedSection {
  if (typeof src === 'string') {
    return { kind: 'inline', body: src };
  }
  if (!files) {
    throw new Error(
      `include: "${src.include}" — no FileRegistry was supplied to resolve external sections`,
    );
  }
  const found = files.resolve(parentPath, src.include);
  if (!found) {
    throw new Error(`include: "${src.include}" — file not found`);
  }
  collected.push({ path: found.path, content: found.content });
  return { kind: 'include', body: found.content, sourcePath: found.path };
}

function resolveSections(
  meta: AgentMeta,
  parentPath: string,
  files: FileRegistry | undefined,
  collected: AgentSourceFile[],
): ResolvedSections | undefined {
  const s: Sections | undefined = meta.sections;
  if (!s) return undefined;
  return {
    goal: s.goal ? resolveSection(s.goal, parentPath, files, collected) : undefined,
    rules: s.rules?.map((r) => ({
      title: r.title,
      appliesTo: r.appliesTo,
      body: resolveSection(r.body, parentPath, files, collected),
    })),
    steps: s.steps?.map((step) => ({
      id: step.id,
      title: step.title,
      body: resolveSection(step.body, parentPath, files, collected),
    })),
    onFailure: s.onFailure
      ? resolveSection(s.onFailure, parentPath, files, collected)
      : undefined,
  };
}

// ─── Public parsers ───────────────────────────────────────────────────────

/** Parse a `.md` agent file: YAML frontmatter + markdown body. */
export function parseAgentMarkdown(
  source: string,
  sourcePath: string,
  files?: FileRegistry,
): Agent {
  try {
    const { meta, body } = splitFrontmatter(source);
    const validated = AgentMetaSchema.parse(meta);
    const collected: AgentSourceFile[] = [];
    const sections = resolveSections(validated, sourcePath, files, collected);
    const now = isoNow();
    return {
      ...validated,
      sections,
      source: 'markdown',
      sourcePath,
      body,
      raw: source,
      includedFiles: collected,
      createdAt: now,
      updatedAt: now,
    };
  } catch (err) {
    throw new AgentParseError(sourcePath, errorMessage(err), err);
  }
}

/** Parse a `.yaml` agent file: top-level YAML, with `goal` (or `body`) holding prose. */
export function parseAgentYaml(
  source: string,
  sourcePath: string,
  files?: FileRegistry,
): Agent {
  try {
    const data = YAML.parse(source);
    if (!data || typeof data !== 'object') {
      throw new Error('YAML must define a top-level object');
    }
    const { goal, body, ...rest } = data as Record<string, unknown>;
    const validated = AgentMetaSchema.parse(rest);
    const proseField = goal ?? body;
    const collected: AgentSourceFile[] = [];
    const sections = resolveSections(validated, sourcePath, files, collected);
    const now = isoNow();
    return {
      ...validated,
      sections,
      source: 'yaml',
      sourcePath,
      body: typeof proseField === 'string' ? proseField.trim() : '',
      raw: source,
      includedFiles: collected,
      createdAt: now,
      updatedAt: now,
    };
  } catch (err) {
    throw new AgentParseError(sourcePath, errorMessage(err), err);
  }
}

/** Convenience dispatcher — picks parser by file extension. */
export function parseAgent(source: string, sourcePath: string, files?: FileRegistry): Agent {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    return parseAgentYaml(source, sourcePath, files);
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return parseAgentMarkdown(source, sourcePath, files);
  }
  throw new AgentParseError(
    sourcePath,
    `Unrecognized agent extension. Expected .md, .markdown, .yaml, or .yml`,
  );
}

// ─── Path utilities ───────────────────────────────────────────────────────

/**
 * Normalize a path: collapse './' segments, resolve '..', return canonical
 * form prefixed with './' (matches vite import.meta.glob key format).
 */
export function normalizePath(p: string): string {
  const parts = p.split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      if (result.length > 0 && result[result.length - 1] !== '..') {
        result.pop();
      } else {
        result.push('..');
      }
    } else if (part !== '.' && part !== '') {
      result.push(part);
    }
  }
  const joined = result.join('/');
  return joined.startsWith('..') ? joined : './' + joined;
}

/** Resolve `relPath` (from inside the file at `parentPath`) into a canonical path. */
export function resolveIncludePath(parentPath: string, relPath: string): string {
  const segments = parentPath.split('/');
  segments.pop(); // strip filename
  const parentDir = segments.join('/');
  const combined = parentDir ? `${parentDir}/${relPath}` : relPath;
  return normalizePath(combined);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
