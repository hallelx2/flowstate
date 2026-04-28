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

/**
 * One environment variable an MCP server reads. Spec-rich version that
 * carries the registry's description, required/secret flags and format —
 * used by the install screen so the user knows what each value is for
 * before they paste it in. Servers that only declare bare names continue
 * to work via the legacy `envVars: string[]` field.
 */
export interface EnvVarSpec {
  /** OS env-var name (e.g. `STRIPE_API_KEY`). */
  name: string;
  /** Free-form description from the registry — surfaced under the input. */
  description?: string;
  /** Whether the server can't start without this value populated. */
  required?: boolean;
  /** Registry hint that the value is sensitive (token, key, password). */
  secret?: boolean;
  /** Loose type hint (`string`, `url`, `number`, …). */
  format?: string;
  /** Default value the server falls back to when the env is absent. */
  default?: string;
}

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
   *
   * Kept as the canonical list of REQUIRED-AT-INSTALL env vars so legacy
   * starter-registry consumers keep working unchanged. Rich per-var
   * metadata (description, format, secret flag, required flag) lives in
   * `envVarSpecs` below — populate both when the source has it.
   */
  envVars?: string[];
  /**
   * Spec-rich description of each env var the server reads. Pulled from
   * the registry's `environmentVariables` entries when available. The
   * marketplace install screen renders these so users understand WHAT
   * each value is, whether it's required, and whether to mask the input.
   */
  envVarSpecs?: EnvVarSpec[];
  /**
   * Idle timeout (ms) — how long the pool keeps the server warm after the
   * last call. Defaults to 5 minutes. Set lower for memory-hungry servers.
   */
  idleTimeoutMs?: number;
  /** Tags for marketplace filtering. */
  tags?: string[];
  /** Optional homepage / docs link. */
  homepage?: string;
  /**
   * Brand icon URL — used by the marketplace cards + detail drawer to
   * give each server a recognisable visual anchor. Synthesised from
   * `repository` (GitHub user/org avatar) or `homepage` (favicon) when
   * the registry doesn't expose an icon directly. The renderer falls
   * back to a monogram bubble when this is missing.
   */
  iconUrl?: string;

  // ─── Quality signals (populated by the marketplace normalizer) ──────
  // None of these are required; defs created by the user / starter list
  // can omit them and the UI falls back to neutral display.

  /**
   * 0–100 composite quality score derived from registry signals
   * (verified publisher, completeness of metadata, active status, etc).
   * Higher = better. See `computeQuality()` in mcp-marketplace.ts.
   */
  quality?: number;
  /**
   * True when the server's publisher namespace is in flowstate's
   * verified-publisher list (e.g. `io.github.modelcontextprotocol`,
   * `io.github.anthropics`, vendor official orgs). Drives the "Verified"
   * badge in the marketplace UI.
   */
  verified?: boolean;
  /**
   * True for hand-picked, curated servers that flowstate features on
   * the marketplace landing surface. Subset of verified — `featured`
   * implies `verified`. Curated centrally, not derived per-server.
   */
  featured?: boolean;
  /** ISO timestamp of the most-recent update from the source registry. */
  updatedAt?: string;
  /**
   * Publisher / author of the server, surfaced under the title on cards
   * and detail drawers. For the official registry this is the first
   * dotted segment of the namespace (e.g. `ac.tandem` → "ac.tandem").
   */
  publisher?: string;
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

  // ─── Communication ──────────────────────────────────────────────────
  {
    id: 'gmail',
    name: 'Gmail',
    family: 'gmail',
    description: 'Read, search, draft, and send email through a Gmail account.',
    capabilities: [
      'communication.email.read',
      'communication.email.send',
      'communication.email.search',
    ],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
    },
    envVars: ['GMAIL_CREDENTIALS'],
    tags: ['email', 'google', 'communication'],
    homepage: 'https://github.com/GongRzhe/Gmail-MCP-Server',
  },
  {
    id: 'discord',
    name: 'Discord',
    family: 'discord',
    description: 'Post messages and manage channels in a Discord server.',
    capabilities: ['communication.chat.send', 'communication.chat.read'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@barryyip0625/mcp-discord'],
    },
    envVars: ['DISCORD_TOKEN'],
    tags: ['discord', 'communication'],
    homepage: 'https://github.com/barryyip0625/mcp-discord',
  },
  {
    id: 'twilio',
    name: 'Twilio',
    family: 'twilio',
    description: 'Send SMS, voice calls, and WhatsApp messages via Twilio.',
    capabilities: ['communication.sms.send', 'communication.voice.call'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@twilio-alpha/mcp'],
    },
    envVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
    tags: ['sms', 'communication'],
    homepage: 'https://github.com/twilio-labs/mcp',
  },

  // ─── Cloud & infrastructure ─────────────────────────────────────────
  {
    id: 'gdrive',
    name: 'Google Drive',
    family: 'gdrive',
    description: 'Search and read files from a connected Google Drive account.',
    capabilities: ['cloud.storage.read', 'cloud.storage.search', 'file.read'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gdrive'],
    },
    envVars: ['GDRIVE_CREDENTIALS_PATH'],
    tags: ['google', 'cloud', 'files'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive',
  },
  {
    id: 'aws',
    name: 'AWS',
    family: 'aws',
    description: 'Query AWS services through the official AWS Labs MCP server.',
    capabilities: ['cloud.compute.list', 'cloud.storage.list', 'cloud.iam.read'],
    transport: {
      type: 'stdio',
      command: 'uvx',
      args: ['awslabs.aws-api-mcp-server'],
    },
    envVars: ['AWS_REGION', 'AWS_PROFILE'],
    tags: ['aws', 'cloud'],
    homepage: 'https://github.com/awslabs/mcp',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    family: 'cloudflare',
    description: 'Manage Workers, R2, KV, and DNS through the Cloudflare MCP server.',
    capabilities: ['cloud.deploy.worker', 'cloud.dns.manage', 'cloud.storage.read'],
    transport: {
      type: 'http',
      url: 'https://mcp.cloudflare.com/sse',
    },
    envVars: ['CLOUDFLARE_API_TOKEN'],
    tags: ['cloudflare', 'cloud', 'edge'],
    homepage: 'https://github.com/cloudflare/mcp-server-cloudflare',
  },

  // ─── Project / task management ──────────────────────────────────────
  {
    id: 'linear',
    name: 'Linear',
    family: 'linear',
    description: 'Search, create, and update Linear issues, projects, and cycles.',
    capabilities: [
      'project.issue.create',
      'project.issue.list',
      'project.issue.update',
    ],
    transport: {
      type: 'http',
      url: 'https://mcp.linear.app/sse',
    },
    envVars: ['LINEAR_API_KEY'],
    tags: ['linear', 'project'],
    homepage: 'https://linear.app/docs/mcp',
  },
  {
    id: 'jira',
    name: 'Jira',
    family: 'jira',
    description: 'Read and write Jira issues, projects, and sprints.',
    capabilities: [
      'project.issue.create',
      'project.issue.list',
      'project.issue.update',
    ],
    transport: {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-atlassian'],
    },
    envVars: ['ATLASSIAN_URL', 'ATLASSIAN_USERNAME', 'ATLASSIAN_API_TOKEN'],
    tags: ['jira', 'atlassian', 'project'],
    homepage: 'https://github.com/sooperset/mcp-atlassian',
  },
  {
    id: 'asana',
    name: 'Asana',
    family: 'asana',
    description: 'Manage tasks, projects, and workspaces in Asana.',
    capabilities: ['project.task.create', 'project.task.list', 'project.task.update'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@roychri/mcp-server-asana'],
    },
    envVars: ['ASANA_ACCESS_TOKEN'],
    tags: ['asana', 'project'],
    homepage: 'https://github.com/roychri/mcp-server-asana',
  },

  // ─── Notes / docs ───────────────────────────────────────────────────
  {
    id: 'notion',
    name: 'Notion',
    family: 'notion',
    description: 'Create pages, query databases, and search across a Notion workspace.',
    capabilities: ['note.create', 'note.read', 'note.search', 'data.database.query'],
    transport: {
      type: 'http',
      url: 'https://mcp.notion.com/mcp',
    },
    envVars: ['NOTION_API_KEY'],
    tags: ['notion', 'note'],
    homepage: 'https://developers.notion.com/docs/mcp',
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    family: 'obsidian',
    description: 'Read and modify notes in a local Obsidian vault.',
    capabilities: ['note.create', 'note.read', 'note.search'],
    transport: {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-obsidian'],
    },
    envVars: ['OBSIDIAN_API_KEY'],
    tags: ['obsidian', 'note', 'local'],
    homepage: 'https://github.com/MarkusPfundstein/mcp-obsidian',
  },
  {
    id: 'confluence',
    name: 'Confluence',
    family: 'confluence',
    description: 'Search, read, and create Confluence pages and spaces.',
    capabilities: ['note.read', 'note.search', 'note.create'],
    transport: {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-atlassian'],
    },
    envVars: ['ATLASSIAN_URL', 'ATLASSIAN_USERNAME', 'ATLASSIAN_API_TOKEN'],
    tags: ['confluence', 'atlassian', 'note'],
    homepage: 'https://github.com/sooperset/mcp-atlassian',
  },

  // ─── Calendar ───────────────────────────────────────────────────────
  {
    id: 'gcal',
    name: 'Google Calendar',
    family: 'gcal',
    description: 'List events, create meetings, and check availability in Google Calendar.',
    capabilities: [
      'calendar.event.create',
      'calendar.event.list',
      'calendar.availability.read',
    ],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@cocal/google-calendar-mcp'],
    },
    envVars: ['GOOGLE_OAUTH_CREDENTIALS'],
    tags: ['google', 'calendar'],
    homepage: 'https://github.com/nspady/google-calendar-mcp',
  },

  // ─── CRM ────────────────────────────────────────────────────────────
  {
    id: 'hubspot',
    name: 'HubSpot',
    family: 'hubspot',
    description: 'Read and update HubSpot CRM contacts, companies, and deals.',
    capabilities: ['crm.contact.read', 'crm.contact.update', 'crm.deal.read'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@hubspot/mcp-server'],
    },
    envVars: ['HUBSPOT_ACCESS_TOKEN'],
    tags: ['hubspot', 'crm'],
    homepage: 'https://github.com/HubSpot/mcp-server-hubspot',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    family: 'salesforce',
    description: 'Query SOQL, manage records, and run reports in Salesforce.',
    capabilities: ['crm.contact.read', 'crm.deal.read', 'data.sql.query'],
    transport: {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-salesforce'],
    },
    envVars: ['SALESFORCE_USERNAME', 'SALESFORCE_PASSWORD', 'SALESFORCE_TOKEN'],
    tags: ['salesforce', 'crm'],
    homepage: 'https://github.com/smn2gnt/MCP-Salesforce',
  },

  // ─── Payments ───────────────────────────────────────────────────────
  {
    id: 'stripe',
    name: 'Stripe',
    family: 'stripe',
    description: 'Manage customers, payments, refunds, and subscriptions through Stripe.',
    capabilities: [
      'payment.refund.create',
      'payment.customer.retrieve',
      'payment.subscription.list',
    ],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@stripe/mcp', '--tools=all'],
    },
    envVars: ['STRIPE_API_KEY'],
    tags: ['stripe', 'payment'],
    homepage: 'https://github.com/stripe/agent-toolkit',
  },

  // ─── Web search & scrape ────────────────────────────────────────────
  {
    id: 'brave-search',
    name: 'Brave Search',
    family: 'brave-search',
    description: 'Run private web searches via the Brave Search API.',
    capabilities: ['web.search'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
    },
    envVars: ['BRAVE_API_KEY'],
    tags: ['web', 'search'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    family: 'firecrawl',
    description: 'Crawl websites and extract structured content with Firecrawl.',
    capabilities: ['web.scrape', 'web.crawl'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'firecrawl-mcp'],
    },
    envVars: ['FIRECRAWL_API_KEY'],
    tags: ['web', 'scrape'],
    homepage: 'https://github.com/mendableai/firecrawl-mcp-server',
  },
  {
    id: 'fetch',
    name: 'Fetch',
    family: 'fetch',
    description: 'Fetch a URL and return its rendered text content.',
    capabilities: ['web.fetch'],
    transport: {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch'],
    },
    tags: ['web', 'core'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },

  // ─── Code ───────────────────────────────────────────────────────────
  {
    id: 'gitlab',
    name: 'GitLab',
    family: 'gitlab',
    description: 'Issues, merge requests, and repos via the GitLab API.',
    capabilities: [
      'code.repo.read',
      'code.pr.create',
      'code.pr.list',
      'code.issue.create',
    ],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gitlab'],
    },
    envVars: ['GITLAB_PERSONAL_ACCESS_TOKEN'],
    tags: ['gitlab', 'code'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gitlab',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    family: 'sentry',
    description: 'Inspect and triage Sentry errors and performance issues.',
    capabilities: ['code.error.read', 'code.error.list'],
    transport: {
      type: 'http',
      url: 'https://mcp.sentry.dev/sse',
    },
    envVars: ['SENTRY_AUTH_TOKEN'],
    tags: ['sentry', 'observability'],
    homepage: 'https://docs.sentry.io/product/sentry-mcp',
  },

  // ─── Data ───────────────────────────────────────────────────────────
  {
    id: 'mongodb',
    name: 'MongoDB',
    family: 'mongodb',
    description: 'Query and write to MongoDB collections.',
    capabilities: ['data.nosql.query', 'data.nosql.write'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'mongodb-mcp-server'],
    },
    envVars: ['MDB_MCP_CONNECTION_STRING'],
    tags: ['data', 'nosql'],
    homepage: 'https://github.com/mongodb-js/mongodb-mcp-server',
  },
  {
    id: 'redis',
    name: 'Redis',
    family: 'redis',
    description: 'Read, write, and inspect keys against a Redis instance.',
    capabilities: ['data.kv.query', 'data.kv.write'],
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-redis'],
    },
    envVars: ['REDIS_URL'],
    tags: ['data', 'cache'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/redis',
  },
  {
    id: 'bigquery',
    name: 'BigQuery',
    family: 'bigquery',
    description: 'Run BigQuery SQL and inspect schemas in a Google Cloud project.',
    capabilities: ['data.sql.query', 'data.warehouse.query'],
    transport: {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-bigquery-server'],
    },
    envVars: ['GOOGLE_APPLICATION_CREDENTIALS', 'BIGQUERY_PROJECT_ID'],
    tags: ['data', 'sql', 'gcp'],
    homepage: 'https://github.com/LucasHild/mcp-server-bigquery',
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
