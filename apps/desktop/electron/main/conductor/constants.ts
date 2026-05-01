/**
 * Pure-string constants used across the Conductor module.
 *
 * Lives in its own file so it can be imported by code paths that mustn't
 * pull in Electron (the offline smoke test, future renderer-side display
 * helpers). Keep this file dependency-free.
 */

/** SDK tool name prefix for everything the in-process flowstate MCP server exposes. */
export const FLOWSTATE_TOOL_PREFIX = 'mcp__flowstate__';

/** Name of the dispatch boundary tool — used by hooks to pivot to nested-run UI. */
export const DISPATCH_TOOL_NAME = `${FLOWSTATE_TOOL_PREFIX}dispatch_agent_run`;

/** Tools annotated destructive — duplicated here for the HITL hook. */
export const DESTRUCTIVE_TOOLS: ReadonlySet<string> = new Set([
  `${FLOWSTATE_TOOL_PREFIX}install_mcp_server`,
  `${FLOWSTATE_TOOL_PREFIX}uninstall_mcp_server`,
  `${FLOWSTATE_TOOL_PREFIX}set_secret`,
  `${FLOWSTATE_TOOL_PREFIX}run_cli_auth`,
  `${FLOWSTATE_TOOL_PREFIX}write_agent_file`,
  `${FLOWSTATE_TOOL_PREFIX}cancel_run`,
]);
