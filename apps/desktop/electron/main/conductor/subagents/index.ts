/**
 * Subagent definitions for the Conductor's `agents` option.
 *
 * Each subagent is a system prompt + tool subset. The Conductor's main
 * loop dispatches them via the SDK's built-in Agent tool.
 */

import {
  PLANNER_ALLOWED_TOOLS,
  PLANNER_SYSTEM_PROMPT,
} from './planner';
import {
  INSTALLER_ALLOWED_TOOLS,
  INSTALLER_SYSTEM_PROMPT,
} from './installer';
import {
  AUTHENTICATOR_ALLOWED_TOOLS,
  AUTHENTICATOR_SYSTEM_PROMPT,
} from './authenticator';
import {
  AGENT_WRITER_ALLOWED_TOOLS,
  AGENT_WRITER_SYSTEM_PROMPT,
} from './agent-writer';

/**
 * Shape passed to `query({ options: { agents } })`. Each subagent gets
 * its own system prompt + tool allowlist. The parent dispatches via the
 * built-in `Agent` tool — Claude Code knows the names automatically once
 * they're declared here.
 */
export const CONDUCTOR_SUBAGENTS = {
  planner: {
    description:
      'Read-only intent classifier. Returns a JSON plan: task, needed capabilities, suggested tool refs, whether to reuse a saved agent.',
    prompt: PLANNER_SYSTEM_PROMPT,
    tools: PLANNER_ALLOWED_TOOLS,
  },
  installer: {
    description:
      'Installs an MCP server from the public registry, confirming with the user and populating required secrets via the keychain.',
    prompt: INSTALLER_SYSTEM_PROMPT,
    tools: INSTALLER_ALLOWED_TOOLS,
  },
  authenticator: {
    description:
      'Authenticates a CLI family. Spawns the auth flow in a detached terminal and polls until the auth probe reports success.',
    prompt: AUTHENTICATOR_SYSTEM_PROMPT,
    tools: AUTHENTICATOR_ALLOWED_TOOLS,
  },
  'agent-writer': {
    description:
      'Synthesizes a saved agent .md file (frontmatter + body) from an intent + resolved tool refs, writes it to disk, and round-trips through the loader.',
    prompt: AGENT_WRITER_SYSTEM_PROMPT,
    tools: AGENT_WRITER_ALLOWED_TOOLS,
  },
} as const;
