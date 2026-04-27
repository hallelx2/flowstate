/**
 * MCP server definitions — the bridge between flowstate's `mcp:*` tool refs
 * and the Claude Agent SDK's `mcpServers` option.
 *
 * Each entry describes one MCP server (stdio command, http url, etc.) plus
 * the metadata needed to:
 *   1. Build a system-prompt addendum so Claude knows which servers + actions
 *      are available
 *   2. Translate `tools: [mcp:github.create_issue, ...]` into the SDK's
 *      `mcpServers: { github: { command, args, env } }` map
 *   3. Show docs in the Tool Directory + the create-agent picker
 *   4. (Future) Drive the MCP server pool's lifecycle — keep N most-recent
 *      warm, evict cold after idleTimeoutMs
 *
 * The starter registry below ships a handful of well-known MCP servers from
 * the @modelcontextprotocol org. Community publishers extend it via
 * `~/.flowstate/tools/mcp/*.yaml` (loader follows in a later commit).
 */

// ─── Types ────────────────────────────────────────────────────────────────

export type McpTransport =
  | {
      type: 'stdio';
      command: string;
      args?: string[];
      /** Static env-var values. Combined with `envVars` (looked up at runtime). */
      env?: Record<string, string>;
    }
  | {
      type: 'http';
      url: string;
      headers?: Record<string, string>;
    }
  | {
      type: 'sse';
      url: string;
      headers?: Record<string, string>;
    };

export interface McpServerDef {
  /** Tool ref id — what shows after `mcp:` in agent declarations (`mcp:github`). */
  id: string;
  /** Display name. */
  name: string;
  /** One-line description — goes into the system prompt + tool directory. */
  description: string;
  /** Tool family / brand for grouping (usually equal to `id`). */
  family: string;
  /** Capability tags this server's actions cover. */
  capabilities: string[];
  /** Transport descriptor. */
  transport: McpTransport;
  /**
   * Names of env vars the server reads. Surfaced on the install screen so
   * users know what secrets they need to populate before the server can run.
   * The runtime hydrates these from the OS keychain at start time.
   */
  envVars?: string[];
  /**
   * Idle timeout (ms) — how long the pool keeps the server warm after the
   * last call. Defaults to 5 minutes. Set lower for memory-hungry servers.
   */
  idleTimeoutMs?: number;
  /** Tags for marketplace filtering. */
  tags?: string[];
  /** Optional homepage / docs link. */
  homepage?: string;
}

// ─── Starter registry ─────────────────────────────────────────────────────

/**
 * Eight well-known MCP servers from the @modelcontextprotocol org plus a
 * couple of common ecosystem picks. Enough for the default experience to
 * feel useful without over-committing on third-party choices.
 */
export const STARTER_MCP_SERVERS: McpServerDef[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    family: 'filesystem',
    description:
      'Read, write, and search files inside one or more user-allowed directories.',
    capabilities: ['file.read', 'file.write', 'file.search'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
    },
    tags: ['files', 'core'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'github',
    name: 'GitHub',
    family: 'github',
    description:
      'Issues, pull requests, repos, and code search via the GitHub REST API.',
    capabilities: [
      'code.repo.read',
      'code.pr.create',
      'code.pr.list',
      'code.issue.create',
      'code.issue.list',
    ],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    },
    envVars: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    tags: ['github', 'code'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'git',
    name: 'Git',
    family: 'git',
    description: 'Inspect a local git repository — diffs, history, blame.',
    capabilities: ['code.repo.read', 'code.commit.list', 'code.branch.list'],
    transport: {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-git'],
    },
    tags: ['git', 'code'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
  },
  {
    id: 'slack',
    name: 'Slack',
    family: 'slack',
    description: 'Post messages, list channels, and read history in a Slack workspace.',
    capabilities: ['communication.chat.send', 'communication.chat.read'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
    },
    envVars: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
    tags: ['slack', 'communication'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },
  {
    id: 'postgres',
    name: 'Postgres',
    family: 'postgres',
    description: 'Run read-only queries against a Postgres database.',
    capabilities: ['data.sql.query'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
    },
    envVars: ['DATABASE_URL'],
    tags: ['data', 'sql'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    family: 'sqlite',
    description: 'Query and modify a local SQLite database file.',
    capabilities: ['data.sql.query', 'data.sql.write'],
    transport: {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-sqlite'],
    },
    tags: ['data', 'sql', 'local'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
  },
  {
    id: 'memory',
    name: 'Memory',
    family: 'memory',
    description:
      'Persistent knowledge graph for agents to remember facts across runs.',
    capabilities: ['note.create', 'note.read', 'note.search'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
    tags: ['memory', 'note'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    family: 'puppeteer',
    description: 'Drive a headless Chromium — navigate, click, screenshot, scrape.',
    capabilities: ['web.browse', 'web.scrape', 'web.screenshot'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
    tags: ['web', 'browser'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
  },
];

// ─── Resolution ───────────────────────────────────────────────────────────

/**
 * SDK-shaped server config — a structural-only mirror of the SDK's
 * `McpStdioServerConfig | McpHttpServerConfig | McpSSEServerConfig` union,
 * without taking a hard dep on the SDK package from `@flowstate/core`.
 *
 * The runtime in the desktop app passes this straight to query() options.
 */
export type SdkMcpServerConfig =
  | { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | { type: 'sse'; url: string; headers?: Record<string, string> };

export interface ResolvedMcpServer {
  /** The server id — also the key under which the SDK keys this config. */
  id: string;
  def: McpServerDef;
  /**
   * Action refs the agent declared on this server. Empty array means
   * "all actions" — the agent declared `mcp:<id>` with no action suffix.
   */
  actions: string[];
  /** Ready-to-pass SDK config. */
  sdkConfig: SdkMcpServerConfig;
}

export interface McpServerResolution {
  /** Servers the agent's `mcp:*` refs successfully matched. */
  resolved: ResolvedMcpServer[];
  /** `mcp:*` refs that don't appear in the registry. */
  unresolved: string[];
  /**
   * Map from server id → SDK config — feed directly into the SDK's
   * `query({ options: { mcpServers } })`.
   */
  sdkServers: Record<string, SdkMcpServerConfig>;
  /**
   * SDK-format tool name allowlist derived from the action-suffixed refs.
   * For `mcp:github.create_issue` we emit `mcp__github__create_issue`.
   *
   * Empty when every ref is bare (`mcp:<id>` form) — in that case we don't
   * want to constrain the SDK's tool allowlist; the server's full surface
   * is implicitly available.
   */
  allowedToolNames: string[];
  /** Markdown addendum describing every resolved server + its declared actions. */
  systemPromptAddendum: string;
  /**
   * Env var entries the resolved servers read. Surfaced so the runtime can
   * warn if a referenced secret isn't populated.
   */
  requiredEnvVars: string[];
}

/**
 * Translate an agent's `tools: [mcp:*, ...]` declarations into the SDK's
 * MCP server config map plus the system-prompt scaffolding.
 *
 * Refs come in two shapes:
 *   `mcp:<id>`          — open access to the server's full action surface
 *   `mcp:<id>.<action>` — restrict to the listed actions
 *
 * Mixed refs on the same server merge: any `mcp:<id>` makes the server
 * unrestricted; otherwise the union of declared actions wins.
 */
export function resolveMcpServers(
  agentTools: string[],
  registry: McpServerDef[] = STARTER_MCP_SERVERS,
): McpServerResolution {
  const byId = new Map(registry.map((d) => [d.id, d]));

  /** server id → { actions: Set<string>, unrestricted: boolean } */
  const grouped = new Map<string, { actions: Set<string>; unrestricted: boolean }>();
  const unresolved: string[] = [];

  for (const ref of agentTools) {
    if (!ref.startsWith('mcp:')) continue;
    const tail = ref.slice(4);
    const dot = tail.indexOf('.');
    const id = dot < 0 ? tail : tail.slice(0, dot);
    const action = dot < 0 ? null : tail.slice(dot + 1);

    if (!byId.has(id)) {
      unresolved.push(ref);
      continue;
    }

    const entry = grouped.get(id) ?? { actions: new Set<string>(), unrestricted: false };
    if (action == null) {
      entry.unrestricted = true;
    } else {
      entry.actions.add(action);
    }
    grouped.set(id, entry);
  }

  const resolved: ResolvedMcpServer[] = [];
  const sdkServers: Record<string, SdkMcpServerConfig> = {};
  const allowedToolNames: string[] = [];
  const requiredEnvVars = new Set<string>();

  for (const [id, { actions, unrestricted }] of [...grouped.entries()].sort()) {
    const def = byId.get(id)!;
    const sdkConfig = toSdkConfig(def.transport);
    const actionList = unrestricted ? [] : [...actions].sort();
    resolved.push({ id, def, actions: actionList, sdkConfig });
    sdkServers[id] = sdkConfig;
    if (!unrestricted) {
      for (const a of actionList) {
        allowedToolNames.push(`mcp__${id}__${normalizeAction(a)}`);
      }
    }
    for (const v of def.envVars ?? []) requiredEnvVars.add(v);
  }

  return {
    resolved,
    unresolved,
    sdkServers,
    allowedToolNames,
    systemPromptAddendum: buildAddendum(resolved),
    requiredEnvVars: [...requiredEnvVars],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function toSdkConfig(transport: McpTransport): SdkMcpServerConfig {
  if (transport.type === 'stdio') {
    // The SDK's stdio config makes `type` optional; we omit it so the
    // produced object round-trips through stricter consumers cleanly.
    const cfg: { command: string; args?: string[]; env?: Record<string, string> } = {
      command: transport.command,
    };
    if (transport.args) cfg.args = transport.args;
    if (transport.env) cfg.env = transport.env;
    return cfg;
  }
  if (transport.type === 'http') {
    return transport.headers
      ? { type: 'http', url: transport.url, headers: transport.headers }
      : { type: 'http', url: transport.url };
  }
  return transport.headers
    ? { type: 'sse', url: transport.url, headers: transport.headers }
    : { type: 'sse', url: transport.url };
}

/**
 * SDK MCP tool names use double-underscore separators and identifiers that
 * can't contain dots. Most server actions are already underscore-cased
 * (`create_issue`), but namespaced ones (`chat.post`) need the dot replaced.
 */
function normalizeAction(action: string): string {
  return action.replace(/\./g, '_');
}

function buildAddendum(resolved: ResolvedMcpServer[]): string {
  if (resolved.length === 0) return '';

  const sections: string[] = [];
  sections.push('## Available MCP servers');
  sections.push(
    'You have access to the MCP tools listed below. Each is exposed via the SDK as ' +
      '`mcp__<server>__<action>`. The runtime starts these servers on first use, keeps ' +
      'them warm for follow-up calls, and shuts them down when the run completes.',
  );

  for (const r of resolved) {
    sections.push(`\n### \`mcp:${r.id}\` — ${r.def.name}`);
    sections.push(r.def.description);

    if (r.actions.length === 0) {
      sections.push('_All actions on this server are available._');
    } else {
      const actionLine = r.actions
        .map((a) => `\`${a}\``)
        .join(' · ');
      sections.push(`Declared actions: ${actionLine}`);
    }

    if (r.def.envVars && r.def.envVars.length > 0) {
      sections.push(
        `_Reads env: ${r.def.envVars.map((v) => `\`${v}\``).join(', ')}_`,
      );
    }
  }

  return sections.join('\n');
}
