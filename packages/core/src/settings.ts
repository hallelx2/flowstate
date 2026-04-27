/**
 * User-level flowstate settings.
 *
 * One Zod schema, one defaults object, one reconciler. All of it is pure —
 * the disk write happens in the desktop main process; the renderer only
 * sees this validated shape.
 *
 * On disk: `<userData>/settings.json` (prod) or
 *          `<projectRoot>/.flowstate/settings.json` (dev — round-trips
 *          through git so config changes are reviewable during development).
 *
 * Forward compat: every field is optional. Older settings files load without
 * complaint; missing fields fall back to the defaults below. Adding a new
 * field is a minor bump; renaming or removing requires a migration.
 */

import { z } from 'zod';

// ─── Schema ───────────────────────────────────────────────────────────────

export const SettingsSchema = z.object({
  /** Schema version — pin so future migrations have a starting point. */
  schemaVersion: z.literal(1).optional(),

  account: z
    .object({
      /** Where the agent runtime gets its model. */
      provider: z.enum(['subscription', 'api', 'local']).optional(),
      /** Default model id (Claude alias or local-model name). */
      model: z.string().optional(),
      /** Pinned models on the picker. */
      favorites: z.array(z.string()).optional(),
      /** Local-LLM endpoint when provider = 'local'. */
      localEndpoint: z.string().url().optional(),
    })
    .optional(),

  workspace: z
    .object({
      /** Directory the loader scans for `.md` / `.yaml` agent files. */
      agentsDir: z.string().optional(),
      /** Tool registry root (per-kind subfolders: cli/, mcp/, http/...). */
      toolsDir: z.string().optional(),
      /** Where per-run JSONL journals are written. */
      runsDir: z.string().optional(),
      /** Watch agentsDir + reload on save. */
      autoReload: z.boolean().optional(),
    })
    .optional(),

  tools: z
    .object({
      /** Run shell + cli tools through an OS sandbox (firejail / sandbox-exec). */
      sandbox: z.boolean().optional(),
      /** Default per-invocation timeout, seconds. */
      defaultTimeoutSec: z.number().int().positive().optional(),
      /** MCP pool — keep most-recent N servers warm. */
      mcpPoolSize: z.number().int().positive().optional(),
      /** MCP idle eviction, minutes. */
      mcpIdleMin: z.number().int().positive().optional(),
      /** Truncate tool stdout to this many tokens before passing to the agent. */
      truncateTokens: z.number().int().positive().optional(),
      /** Surface the Composio adapter in the tool directory. */
      composioEnabled: z.boolean().optional(),
    })
    .optional(),

  privacy: z
    .object({
      errorReports: z.boolean().optional(),
      usageStats: z.boolean().optional(),
      /** Once-a-week update check against anthropic.com. */
      autoUpdateCheck: z.boolean().optional(),
    })
    .optional(),

  appearance: z
    .object({
      theme: z.enum(['light', 'dark', 'system']).optional(),
      density: z.enum(['comfortable', 'compact']).optional(),
      editorFont: z.string().optional(),
    })
    .optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

// ─── Defaults ─────────────────────────────────────────────────────────────

/**
 * Fallbacks the runtime applies when a field is missing. Keep these
 * conservative — defaults that ship in code are easy to change; defaults
 * that get baked into someone's settings.json are hard to.
 */
export const DEFAULT_SETTINGS = {
  schemaVersion: 1 as const,
  account: {
    provider: 'subscription',
    model: 'claude-opus-4-7',
    favorites: ['claude-opus-4-7'],
  },
  workspace: {
    // Path strings are placeholders; the main process replaces them with
    // os-resolved paths on first read so the file ends up populated with
    // real paths the first time it's saved.
    agentsDir: '~/Documents/flowstate/agents',
    toolsDir: '~/Documents/flowstate/tools',
    runsDir: '~/Documents/flowstate/runs',
    autoReload: true,
  },
  tools: {
    sandbox: true,
    defaultTimeoutSec: 30,
    mcpPoolSize: 10,
    mcpIdleMin: 5,
    truncateTokens: 4000,
    composioEnabled: false,
  },
  privacy: {
    errorReports: false,
    usageStats: false,
    autoUpdateCheck: true,
  },
  appearance: {
    theme: 'light',
    density: 'comfortable',
    editorFont: 'jetbrains-mono',
  },
};

// ─── Reconciler ───────────────────────────────────────────────────────────

/**
 * Result of `withDefaults` — every section is populated, no `undefined`s.
 * The renderer store keeps a value of this type so consumer components can
 * read fields without optional-chaining.
 */
export type ResolvedSettings = typeof DEFAULT_SETTINGS;

/**
 * Merge a (possibly partial / older-shape) parsed settings object with the
 * defaults so every field is populated. Scoped per top-level group so
 * partial writes don't blow away unrelated fields.
 *
 * Pure function — useful in either main or renderer.
 */
export function withDefaults(raw: Settings | undefined): ResolvedSettings {
  const r = raw ?? {};
  return {
    schemaVersion: r.schemaVersion ?? DEFAULT_SETTINGS.schemaVersion,
    account: { ...DEFAULT_SETTINGS.account, ...(r.account ?? {}) },
    workspace: { ...DEFAULT_SETTINGS.workspace, ...(r.workspace ?? {}) },
    tools: { ...DEFAULT_SETTINGS.tools, ...(r.tools ?? {}) },
    privacy: { ...DEFAULT_SETTINGS.privacy, ...(r.privacy ?? {}) },
    appearance: { ...DEFAULT_SETTINGS.appearance, ...(r.appearance ?? {}) },
  };
}

/**
 * Apply a deep partial patch to a settings object — patch fields override,
 * unspecified fields are preserved. Used by the main-process write handler
 * so the renderer can send `{ account: { model: '...' } }` and not need to
 * spread the whole tree.
 */
export function mergeSettings(
  current: Settings | undefined,
  patch: Partial<Settings>,
): Settings {
  const c = current ?? {};
  const out: Settings = { ...c };
  if (patch.schemaVersion != null) out.schemaVersion = patch.schemaVersion;
  if (patch.account) out.account = { ...(c.account ?? {}), ...patch.account };
  if (patch.workspace) out.workspace = { ...(c.workspace ?? {}), ...patch.workspace };
  if (patch.tools) out.tools = { ...(c.tools ?? {}), ...patch.tools };
  if (patch.privacy) out.privacy = { ...(c.privacy ?? {}), ...patch.privacy };
  if (patch.appearance) out.appearance = { ...(c.appearance ?? {}), ...patch.appearance };
  return out;
}
