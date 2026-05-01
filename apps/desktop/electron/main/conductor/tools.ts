/**
 * Conductor tools — the in-process MCP surface the orchestrator Claude
 * session calls to learn about the workspace, install/auth tools, write
 * agent files, and dispatch real runs.
 *
 * Every tool is defined with `tool()` from the Agent SDK plus a Zod input
 * schema. Tools return `{ content: [{ type: 'text', text: ... }] }` —
 * structured payloads are stringified as JSON in the text body so Claude
 * can parse them. Annotations (`destructiveHint`, `readOnlyHint`) drive
 * the HITL gate hook — read-only tools pass through silently; destructive
 * ones surface a banner regardless of permissionMode.
 *
 * The tools wrap existing primitives (agent-orchestrator, paths, the core
 * package's pure resolvers) — there is no business logic here, only the
 * Zod-typed surface and JSON-of-result framing.
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { exec, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { promisify } from 'node:util';
import { safeStorage } from 'electron';
import { z } from 'zod';
import {
  STARTER_CLI_FAMILIES,
  findCliFamily,
  resolveCapabilities,
  resolveMcpServers,
  type McpServerDef,
  type ToolManifest,
} from '@flowstate/core';
import {
  decryptSecret,
  loadInstalledMcpDefs,
} from '../agent-orchestrator';
import {
  agentsRoot,
  installedMcpDir,
  secretsPath,
} from '../paths';

const execAsync = promisify(exec);

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Wrap a JSON-serializable value as a single text content block. */
function ok(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

/** Surface a tool error so Claude can read it and adjust. */
function err(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

/** Resolve a vite-style relative path against agentsRoot, denying escape. */
function resolveAgentPath(relPath: string): string {
  const cleaned = relPath.replace(/^\.\//, '');
  const abs = normalize(join(agentsRoot(), cleaned));
  const root = agentsRoot();
  if (!abs.startsWith(root + sep) && abs !== root) {
    throw new Error(`Path "${relPath}" escapes the agents root`);
  }
  return abs;
}

/** Read+parse the secrets JSON; returns {} when absent. */
type SecretsFile = Record<string, string>;
async function readSecretsFile(): Promise<SecretsFile> {
  const path = secretsPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, 'utf8')) as SecretsFile;
  } catch {
    return {};
  }
}
async function writeSecretsFile(data: SecretsFile): Promise<void> {
  const path = secretsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await rename(tmp, path);
}

/** Run a shell probe with a hard timeout; never throws. */
async function runProbe(
  command: string,
  timeoutMs = 3000,
): Promise<{ ok: boolean; stdout?: string; error?: string }> {
  try {
    const { stdout } = await execAsync(command, {
      timeout: timeoutMs,
      windowsHide: true,
    });
    return { ok: true, stdout: stdout.toString().trim().slice(0, 500) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 500) };
  }
}

// ─── ask_user — host-side prompt-card hook ────────────────────────────────
//
// The Conductor calls this when it needs free-form input from the human
// (e.g. "what's your Eventbrite folder id?"). We can't synchronously prompt
// from inside a tool handler without involving the renderer, so we bridge
// through a host-supplied `requestUserInput` callback. The runtime sets it
// when constructing the tools.

export interface ConductorHostBridge {
  /**
   * Surfaces an inline prompt-card in the chat. Resolves with the user's
   * typed text or rejects on cancel.
   */
  requestUserInput: (prompt: {
    question: string;
    placeholder?: string;
    secret?: boolean;
  }) => Promise<string>;

  /**
   * Dispatch an agent run via the existing agent runtime. Returns a runId
   * that the renderer is already subscribed to via `agent:event`.
   */
  dispatchAgentRun: (input: {
    agentRelPath?: string;
    inlinePrompt?: string;
    inlineSystemPrompt?: string;
    inlineTools?: string[];
    model?: string;
  }) => Promise<{ runId: string }>;

  /** List the runs the runtime currently knows about. */
  listRuns: () => Array<{
    id: string;
    agentName: string;
    status: string;
    startedAt: string;
    endedAt?: string;
  }>;

  /** Cancel an in-flight run. Returns true if the run was found. */
  cancelRun: (runId: string) => boolean;

  /** Active workspace metadata for context injection. */
  activeWorkspace: () => { id: string; name: string; cwd?: string } | null;
}

// ─── Tool factory ─────────────────────────────────────────────────────────

/**
 * Build the full Conductor tool array. The host supplies a bridge object
 * because some operations (asking the user, dispatching runs) need to
 * round-trip through the renderer.
 */
export function buildConductorTools(host: ConductorHostBridge) {
  return [
    // ─── Read-only: workspace + tool inventory ──────────────────────────

    tool(
      'read_active_workspace',
      'Return the name + working directory of the active workspace. Useful for understanding the user is in before suggesting work.',
      {},
      async () => {
        const ws = host.activeWorkspace();
        return ok(ws ?? { id: null, name: 'no active workspace' });
      },
      { annotations: { readOnlyHint: true } },
    ),

    tool(
      'list_installed_tools',
      'List every MCP server installed under the user\'s tools dir, plus every CLI family that probes as installed on this machine. Returns ids only — call probe_cli_family for version + auth detail.',
      {},
      async () => {
        const installedMcp = await loadInstalledMcpDefs();
        const cliResults: Record<string, { installed: boolean; version?: string }> = {};
        await Promise.all(
          STARTER_CLI_FAMILIES.map(async (family) => {
            const r = await runProbe(family.versionProbe);
            cliResults[family.id] = { installed: r.ok, version: r.stdout };
          }),
        );
        return ok({
          mcpServers: installedMcp.map((d) => ({
            id: d.id,
            name: d.name,
            capabilities: d.capabilities,
            envVars: d.envVars ?? [],
          })),
          cliFamilies: cliResults,
        });
      },
      { annotations: { readOnlyHint: true } },
    ),

    tool(
      'search_marketplace',
      'Search the public MCP registry. Returns up to `limit` candidate servers matching the query. Use this when the user wants a capability that no installed server provides.',
      {
        query: z.string().describe('Free-form search query (e.g. "calendar", "stripe", "github")'),
        limit: z.number().int().min(1).max(30).optional().describe('Max results (default 10)'),
      },
      async ({ query: q, limit }) => {
        // Lazy import — keeps mcp-marketplace's HTTP plumbing out of cold
        // boot, since the Conductor may never call this in some sessions.
        const { fetchMarketplace } = await import('@flowstate/core');
        const httpFetcher = async (url: string) => {
          try {
            const r = await fetch(url, { headers: { Accept: 'application/json' } });
            return { ok: r.ok, json: () => r.json() };
          } catch {
            return null;
          }
        };
        const result = await fetchMarketplace('official', httpFetcher, {
          search: q,
          limit: limit ?? 10,
        });
        if (!result) return err('marketplace fetch failed (network?)');
        return ok({
          source: result.source,
          results: result.servers.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            capabilities: s.capabilities,
            envVars: s.envVars ?? [],
            transport: s.transport.type ?? 'stdio',
          })),
        });
      },
      { annotations: { readOnlyHint: true } },
    ),

    tool(
      'list_secrets',
      'List the names of secrets currently stored in the keychain. Values are NEVER returned — use this to check whether an env var the user needs is already populated.',
      {},
      async () => {
        const file = await readSecretsFile();
        return ok({ names: Object.keys(file).sort() });
      },
      { annotations: { readOnlyHint: true } },
    ),

    tool(
      'list_saved_agents',
      'List every saved agent in the workspace agents dir. Returns id, name, description, trigger kind, and tool refs for each. Use this BEFORE suggesting a new agent — an existing one may already do what the user wants.',
      {},
      async () => {
        const root = agentsRoot();
        if (!existsSync(root)) return ok({ agents: [] });
        const entries = await readdir(root);
        const agents: Array<{
          relPath: string;
          name: string;
          description?: string;
          trigger: string;
          tools: string[];
        }> = [];
        for (const name of entries) {
          if (!name.endsWith('.md') && !name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
          try {
            const content = await readFile(join(root, name), 'utf8');
            const { parseAgentMarkdown, parseAgentYaml } = await import('@flowstate/core');
            const parsed = name.endsWith('.md')
              ? parseAgentMarkdown(content, `./${name}`)
              : parseAgentYaml(content, `./${name}`);
            agents.push({
              relPath: `./${name}`,
              name: parsed.name,
              description: parsed.description,
              trigger: parsed.trigger.kind,
              tools: parsed.tools ?? [],
            });
          } catch {
            // Skip unparseable agent files — UI's source view will surface them.
          }
        }
        return ok({ agents });
      },
      { annotations: { readOnlyHint: true } },
    ),

    tool(
      'read_agent_file',
      'Read the raw source of an agent file by relative path (e.g. "./inbox-triage.md").',
      {
        relPath: z.string().describe('Relative path under the agents directory'),
      },
      async ({ relPath }) => {
        try {
          const abs = resolveAgentPath(relPath);
          const content = await readFile(abs, 'utf8');
          return ok({ relPath, content });
        } catch (e) {
          return err(e instanceof Error ? e.message : String(e));
        }
      },
      { annotations: { readOnlyHint: true } },
    ),

    tool(
      'resolve_capabilities',
      'Given a list of capability tags (e.g. ["communication.email.send"]), return the installed MCP servers that satisfy each, plus any unmet capabilities. Use this BEFORE suggesting installs to avoid recommending something the user already has.',
      {
        capabilities: z.array(z.string()).describe('Dotted capability paths from the v1 ontology'),
      },
      async ({ capabilities }) => {
        const installed = await loadInstalledMcpDefs();
        // Translate McpServerDef[] → ToolManifest-shaped registry expected
        // by resolveCapabilities. Most fields are placeholders; the
        // resolver only reads id / name / kind / capabilities / authStatus.
        const registry: ToolManifest[] = installed.map((d) => ({
          id: d.id,
          name: d.name,
          kind: 'mcp',
          description: d.description,
          capabilities: d.capabilities,
          auth: { kind: d.envVars && d.envVars.length > 0 ? 'api_key' : 'none' },
          authStatus: 'ready',
          provider: {},
          actions: [],
        }));
        const result = resolveCapabilities(capabilities, registry);
        return ok(result);
      },
      { annotations: { readOnlyHint: true } },
    ),

    tool(
      'probe_cli_family',
      'Check whether a CLI family (gh, gcloud, stripe, etc.) is installed and authenticated on this machine. Returns { installed, version?, authenticated? }.',
      {
        familyId: z.string().describe('CLI family id from the catalog'),
      },
      async ({ familyId }) => {
        const family = findCliFamily(familyId);
        if (!family) return err(`unknown family "${familyId}"`);
        const probe = await runProbe(family.versionProbe);
        const out: Record<string, unknown> = {
          familyId,
          installed: probe.ok,
          version: probe.stdout,
        };
        if (probe.ok && family.auth.kind !== 'none' && family.auth.probe) {
          const authR = await runProbe(family.auth.probe, 5000);
          out['authenticated'] = authR.ok;
          out['authOutput'] = authR.stdout;
        } else if (probe.ok && family.auth.kind === 'none') {
          out['authenticated'] = true;
        }
        if (!probe.ok) out['error'] = probe.error;
        return ok(out);
      },
      { annotations: { readOnlyHint: true } },
    ),

    // ─── Read-only: runs ────────────────────────────────────────────────

    tool(
      'list_runs',
      'List the runs the runtime currently knows about (in-memory, recent first).',
      {},
      async () => ok({ runs: host.listRuns() }),
      { annotations: { readOnlyHint: true } },
    ),

    // ─── Destructive (HITL-gated) ────────────────────────────────────────

    tool(
      'install_mcp_server',
      'Install an MCP server definition under the user\'s tools dir. Persists to disk so the runtime registry picks it up on the next agent run. ALWAYS surface this through ask_user first — installation is a side effect.',
      {
        def: z
          .object({
            id: z.string(),
            name: z.string(),
            family: z.string().optional(),
            description: z.string(),
            capabilities: z.array(z.string()),
            transport: z.union([
              z.object({
                type: z.literal('stdio').optional(),
                command: z.string(),
                args: z.array(z.string()).optional(),
                env: z.record(z.string(), z.string()).optional(),
              }),
              z.object({
                type: z.literal('http'),
                url: z.string(),
                headers: z.record(z.string(), z.string()).optional(),
              }),
              z.object({
                type: z.literal('sse'),
                url: z.string(),
                headers: z.record(z.string(), z.string()).optional(),
              }),
            ]),
            envVars: z.array(z.string()).optional(),
            homepage: z.string().optional(),
            tags: z.array(z.string()).optional(),
          })
          .describe('McpServerDef shape — usually copied from a search_marketplace result'),
      },
      async ({ def }) => {
        try {
          const dir = installedMcpDir();
          if (!existsSync(dir)) await mkdir(dir, { recursive: true });
          const path = join(dir, `${def.id}.json`);
          const tmp = `${path}.${process.pid}.tmp`;
          // family defaults to id when missing — the McpServerDef type requires it.
          const normalized: McpServerDef = {
            ...(def as McpServerDef),
            family: def.family ?? def.id,
          };
          await writeFile(tmp, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
          await rename(tmp, path);
          return ok({ installed: def.id, path });
        } catch (e) {
          return err(e instanceof Error ? e.message : String(e));
        }
      },
      { annotations: { destructiveHint: true } },
    ),

    tool(
      'uninstall_mcp_server',
      'Remove an installed MCP server definition. Does NOT delete any secrets associated with it.',
      {
        id: z.string().describe('Server id to uninstall'),
      },
      async ({ id }) => {
        try {
          const path = join(installedMcpDir(), `${id}.json`);
          if (!existsSync(path)) return err(`not installed: ${id}`);
          await unlink(path);
          return ok({ uninstalled: id });
        } catch (e) {
          return err(e instanceof Error ? e.message : String(e));
        }
      },
      { annotations: { destructiveHint: true } },
    ),

    tool(
      'set_secret',
      'Store a secret in the OS keychain. Pass `valueFromUser: true` to ask the user for the value through ask_user (preferred — keeps the value out of the assistant transcript). Pass `value` explicitly only when the user already typed it in the chat.',
      {
        name: z.string().describe('Env-var name (e.g. STRIPE_API_KEY)'),
        value: z.string().optional().describe('Plaintext value — only when the user already shared it in chat'),
        valueFromUser: z.boolean().optional().describe('If true, prompt the user via ask_user'),
        promptHint: z.string().optional().describe('Question to ask when valueFromUser is true'),
      },
      async ({ name, value, valueFromUser, promptHint }) => {
        let v = value;
        if (valueFromUser) {
          try {
            v = await host.requestUserInput({
              question: promptHint ?? `Enter the value for ${name}`,
              placeholder: name,
              secret: true,
            });
          } catch {
            return err('user cancelled');
          }
        }
        if (!v) return err('no value provided');
        try {
          const current = await readSecretsFile();
          let stored: string;
          if (safeStorage.isEncryptionAvailable()) {
            stored = `enc:${safeStorage.encryptString(v).toString('base64')}`;
          } else {
            stored = `plain:${Buffer.from(v, 'utf8').toString('base64')}`;
          }
          current[name] = stored;
          await writeSecretsFile(current);
          return ok({ stored: name });
        } catch (e) {
          return err(e instanceof Error ? e.message : String(e));
        }
      },
      { annotations: { destructiveHint: true } },
    ),

    tool(
      'run_cli_auth',
      'Spawn the CLI family\'s auth command in a detached terminal so the user can complete the OAuth / device-code flow. The Conductor should poll probe_cli_family afterwards to detect completion.',
      {
        familyId: z.string().describe('CLI family id'),
      },
      async ({ familyId }) => {
        const family = findCliFamily(familyId);
        if (!family || family.auth.kind !== 'command')
          return err(`no command-based auth for "${familyId}"`);
        const cmd = family.auth.command;
        try {
          if (process.platform === 'darwin') {
            spawn(
              'osascript',
              [
                '-e',
                `tell application "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"`,
              ],
              { detached: true, stdio: 'ignore' },
            ).unref();
          } else if (process.platform === 'win32') {
            spawn('cmd.exe', ['/c', 'start', 'cmd', '/k', cmd], {
              detached: true,
              stdio: 'ignore',
              windowsHide: false,
            }).unref();
          } else {
            const term = process.env['TERMINAL'] ?? 'x-terminal-emulator';
            spawn(term, ['-e', cmd], { detached: true, stdio: 'ignore' }).unref();
          }
          return ok({ launched: familyId, command: cmd });
        } catch (e) {
          return err(e instanceof Error ? e.message : String(e));
        }
      },
      { annotations: { destructiveHint: true } },
    ),

    tool(
      'write_agent_file',
      'Save an agent .md or .yaml file under the workspace agents dir. Use this when the user wants to keep the workflow as a reusable agent. The file is parsed on disk by the loader; if it fails to parse the change is rolled back.',
      {
        relPath: z.string().describe('Relative path (e.g. "./thank-you-webinar.md")'),
        content: z.string().describe('Full file content with YAML frontmatter + markdown body'),
      },
      async ({ relPath, content }) => {
        try {
          const abs = resolveAgentPath(relPath);
          const parent = dirname(abs);
          if (!existsSync(parent)) await mkdir(parent, { recursive: true });
          // Backup any existing file so we can roll back on parse failure.
          let prior: string | null = null;
          if (existsSync(abs)) prior = await readFile(abs, 'utf8');
          await writeFile(abs, content, 'utf8');
          // Round-trip through the loader to catch broken frontmatter early.
          try {
            const { parseAgentMarkdown, parseAgentYaml } = await import('@flowstate/core');
            if (relPath.endsWith('.md')) parseAgentMarkdown(content, relPath);
            else parseAgentYaml(content, relPath);
          } catch (parseErr) {
            // Roll back.
            if (prior != null) await writeFile(abs, prior, 'utf8');
            else await unlink(abs);
            return err(
              `agent failed to parse — file rolled back. Reason: ${
                parseErr instanceof Error ? parseErr.message : String(parseErr)
              }`,
            );
          }
          return ok({ written: relPath });
        } catch (e) {
          return err(e instanceof Error ? e.message : String(e));
        }
      },
      { annotations: { destructiveHint: true } },
    ),

    tool(
      'dispatch_agent_run',
      'Run an agent. Either pass `agentRelPath` to run a saved agent, OR pass `inlinePrompt` (with optional `inlineSystemPrompt` + `inlineTools`) for a one-shot ad-hoc run. Returns the runId — the renderer is already streaming events for it.',
      {
        agentRelPath: z
          .string()
          .optional()
          .describe('Saved agent relative path (e.g. "./thank-you-webinar.md")'),
        inlinePrompt: z.string().optional().describe('Ad-hoc user prompt'),
        inlineSystemPrompt: z.string().optional().describe('Ad-hoc system prompt'),
        inlineTools: z
          .array(z.string())
          .optional()
          .describe('Ad-hoc tool refs (mcp:* / cli:*) — main resolves them'),
        model: z.string().optional().describe('Model alias or full id'),
      },
      async (input) => {
        try {
          const { runId } = await host.dispatchAgentRun(input);
          return ok({ runId });
        } catch (e) {
          return err(e instanceof Error ? e.message : String(e));
        }
      },
      // dispatch is destructive in the sense that it consumes tokens + can
      // touch the world via the inner agent — but the inner run has its
      // own gate, so we don't double-prompt here. Mark non-destructive so
      // the Conductor can fire saved agents without an extra banner.
      { annotations: { destructiveHint: false } },
    ),

    tool(
      'cancel_run',
      'Cancel an in-flight run by id.',
      {
        runId: z.string(),
      },
      async ({ runId }) => {
        const cancelled = host.cancelRun(runId);
        return ok({ cancelled });
      },
      { annotations: { destructiveHint: true } },
    ),

    tool(
      'ask_user',
      'Surface an inline prompt-card in the chat asking the user a free-form question. Use this when you need information you can\'t derive (a folder id, an opt-in choice, a value to put in a secret). Returns the user\'s typed response.',
      {
        question: z.string().describe('The question to display to the user'),
        placeholder: z.string().optional(),
        secret: z.boolean().optional().describe('If true, mask the input field'),
      },
      async ({ question, placeholder, secret }) => {
        try {
          const answer = await host.requestUserInput({ question, placeholder, secret });
          return ok({ answer });
        } catch {
          return err('user cancelled');
        }
      },
      { annotations: { destructiveHint: false } },
    ),

    // ─── Resolver pass-through helpers ──────────────────────────────────

    tool(
      'preview_agent_resolution',
      'Given an array of mcp:* / cli:* tool refs, preview what the runtime would build at run time: which servers spawn, which actions are scoped, which env vars they need, and which bash patterns are allowed. No side effects.',
      {
        tools: z.array(z.string()),
      },
      async ({ tools }) => {
        const installed = await loadInstalledMcpDefs();
        const mcp = resolveMcpServers(tools, installed);
        // Bash allowlist via the same resolver assemble-system-prompt uses.
        const { resolveCliTools } = await import('@flowstate/core');
        const cli = resolveCliTools(tools);
        // Surface which env vars are missing in the keychain.
        const secrets = await readSecretsFile();
        const missingSecrets: string[] = [];
        for (const v of mcp.requiredEnvVars) {
          if (!(v in secrets)) missingSecrets.push(v);
        }
        return ok({
          mcp: {
            resolved: mcp.resolved.map((r) => ({
              id: r.id,
              actions: r.actions,
              envVars: r.def.envVars ?? [],
            })),
            unresolved: mcp.unresolved,
            requiredEnvVars: mcp.requiredEnvVars,
            missingSecrets,
          },
          cli: {
            resolved: cli.resolved.map((r) => r.id),
            unresolved: cli.unresolved,
            bashAllowPatterns: cli.bashAllowPatterns,
          },
        });
      },
      { annotations: { readOnlyHint: true } },
    ),
  ];
}

// ─── Re-exports for unit testing ──────────────────────────────────────────

export { decryptSecret };
