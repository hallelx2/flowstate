/**
 * Agent file loaders.
 *
 * Parses `.md` (with YAML frontmatter) or pure `.yaml` files into the
 * canonical Agent IR. Validates against the Zod schema — invalid files
 * throw with a precise error path.
 *
 * Browser-safe: uses only `yaml` and a hand-rolled frontmatter splitter
 * (no Node-specific deps), so the renderer can parse files just like
 * the main process can.
 */

import YAML from 'yaml';
import { AgentMetaSchema } from './schema';
import type { Agent } from './types/agent';

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
 * Split a markdown source into its frontmatter (parsed as YAML) and body.
 * Throws if the file lacks frontmatter delimiters.
 */
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

/**
 * Parse a `.md` agent file: YAML frontmatter + markdown body.
 */
export function parseAgentMarkdown(source: string, sourcePath: string): Agent {
  try {
    const { meta, body } = splitFrontmatter(source);
    const validated = AgentMetaSchema.parse(meta);
    const now = isoNow();
    return {
      ...validated,
      source: 'markdown',
      sourcePath,
      body,
      raw: source,
      createdAt: now,
      updatedAt: now,
    };
  } catch (err) {
    throw new AgentParseError(sourcePath, errorMessage(err), err);
  }
}

/**
 * Parse a `.yaml` agent file: top-level YAML, with `goal` (or `body`) holding prose.
 */
export function parseAgentYaml(source: string, sourcePath: string): Agent {
  try {
    const data = YAML.parse(source);
    if (!data || typeof data !== 'object') {
      throw new Error('YAML must define a top-level object');
    }
    // Pull the prose out; everything else is metadata.
    const { goal, body, ...rest } = data as Record<string, unknown>;
    const validated = AgentMetaSchema.parse(rest);
    const proseField = goal ?? body;
    const now = isoNow();
    return {
      ...validated,
      source: 'yaml',
      sourcePath,
      body: typeof proseField === 'string' ? proseField.trim() : '',
      raw: source,
      createdAt: now,
      updatedAt: now,
    };
  } catch (err) {
    throw new AgentParseError(sourcePath, errorMessage(err), err);
  }
}

/**
 * Convenience dispatcher — picks parser by file extension.
 */
export function parseAgent(source: string, sourcePath: string): Agent {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    return parseAgentYaml(source, sourcePath);
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return parseAgentMarkdown(source, sourcePath);
  }
  throw new AgentParseError(
    sourcePath,
    `Unrecognized agent extension. Expected .md, .markdown, .yaml, or .yml`,
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
