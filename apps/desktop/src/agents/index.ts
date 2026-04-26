import {
  parseAgent,
  resolveIncludePath,
  type Agent,
  type FileRegistry,
} from '@flowstate/core';

/**
 * Auto-discover every .md / .yaml file in this directory tree at build time.
 *
 * Two roles for files:
 *   - MASTER agent files live at the top level of /agents/ and become Agent
 *     objects. They may reference subfolder files via `sections.*.include:`.
 *   - INCLUDE-ONLY files live in subfolders (e.g. ./refund-handler/goal.md)
 *     and are pulled in by their master via the FileRegistry below.
 *
 * In the runner / hosted version this becomes a filesystem walk.
 * For the MVP, vite bundles everything at build time.
 */

const allFiles = import.meta.glob('./**/*.{md,yaml,yml}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Resolves `include:` paths the loader hands us. */
const registry: FileRegistry = {
  resolve(parentPath, includePath) {
    const target = resolveIncludePath(parentPath, includePath);
    const content = allFiles[target];
    if (content == null) return null;
    return { path: target, content };
  },
};

// Master files: top-level only (no slashes after the leading ./).
const TOP_LEVEL_RE = /^\.\/[^/]+\.(md|markdown|yaml|yml)$/i;

export const AGENTS: Agent[] = Object.entries(allFiles)
  .filter(([path]) => TOP_LEVEL_RE.test(path))
  .map(([path, source]) => parseAgent(source, path, registry))
  .sort((a, b) => a.name.localeCompare(b.name));
