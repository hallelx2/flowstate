import { parseAgent, type Agent } from '@flowstate/core';

/**
 * Auto-discover every .md / .yaml agent file in this directory at build time.
 * Vite's `import.meta.glob` with `?raw` ships the source as a string —
 * we then run it through the canonical parser to produce typed Agent objects.
 *
 * In the runner / hosted version this becomes a filesystem watcher reading
 * from the user's chosen agents directory. For the MVP, bundling at build
 * time keeps the demo self-contained.
 */

const modules = import.meta.glob('./*.{md,yaml,yml}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const AGENTS: Agent[] = Object.entries(modules)
  .map(([path, source]) => {
    const fileName = path.replace(/^\.\//, '');
    return parseAgent(source, fileName);
  })
  .sort((a, b) => a.name.localeCompare(b.name));
