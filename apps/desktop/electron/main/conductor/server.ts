/**
 * Wraps the Conductor's tool array in a `createSdkMcpServer` so it can be
 * passed to `query({ options: { mcpServers: { flowstate: ... } } })`.
 *
 * In-process — no subprocess, no IPC. Tool handlers run directly in the
 * main Electron process and have full access to the Node + Electron APIs
 * (safeStorage, fs, child_process).
 */

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { buildConductorTools, type ConductorHostBridge } from './tools';

export function createConductorMcpServer(host: ConductorHostBridge) {
  return createSdkMcpServer({
    name: 'flowstate',
    version: '1.0.0',
    tools: buildConductorTools(host),
  });
}

// Constants live in ./constants so the offline smoke test (and any renderer
// code that wants to display tool names) can import them without pulling
// Electron into the dependency graph.
export {
  DESTRUCTIVE_TOOLS,
  DISPATCH_TOOL_NAME,
  FLOWSTATE_TOOL_PREFIX,
} from './constants';
