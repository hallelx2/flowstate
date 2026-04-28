/**
 * CLI tool definitions — the bridge between flowstate's `cli:*` refs and
 * the SDK's built-in `Bash` tool.
 *
 * Each entry describes one templated invocation. The runtime uses these to:
 *   1. Build a system-prompt addendum so Claude knows what's available
 *   2. Build a Bash command allowlist so the gate denies anything not declared
 *   3. Show docs in the Tool Directory and the create-agent picker
 *
 * The starter registry below ships ~15 commands across 5 popular CLIs.
 * Community publishers extend it via `~/.flowstate/tools/cli/*.yaml`
 * (loader follows in a later commit).
 */

export interface CliToolInput {
  type: 'string' | 'integer' | 'number' | 'boolean';
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface CliToolDef {
  /** Tool ref id — matches what shows after `cli:` in agent declarations. */
  id: string;
  /** Display name. */
  name: string;
  /** One-line description — goes into the system prompt. */
  description: string;
  /** Capability tags this command satisfies. */
  capabilities: string[];
  /** Tool family for grouping (e.g. "gh", "gcloud"). */
  family: string;
  /**
   * Template with {placeholders}. Renders at invoke time.
   * Example: `gh pr create --title "{title}" --body "{body}"`
   */
  template: string;
  /** Input parameters by name. */
  inputs: Record<string, CliToolInput>;
  /**
   * Bash command pattern (regex) that valid invocations must match.
   * Used by the permission gate. If omitted, derived from `template`
   * by replacing {placeholders} with `.+`.
   */
  pattern?: string;
  /** Tags for marketplace filtering. */
  tags?: string[];
}

// ─── Starter registry ─────────────────────────────────────────────────────

export const STARTER_CLI_TOOLS: CliToolDef[] = [
  // ─── GitHub CLI ─────────────────────────────────────────────────────
  {
    id: 'gh.pr.create',
    name: 'Open a pull request',
    description: 'Create a GitHub PR from the current branch.',
    family: 'gh',
    capabilities: ['code.pr.create'],
    template: 'gh pr create --title "{title}" --body "{body}" --base {base}',
    inputs: {
      title: { type: 'string', required: true, description: 'PR title' },
      body: { type: 'string', required: true, description: 'PR body (markdown)' },
      base: { type: 'string', default: 'main', description: 'Target branch' },
    },
    tags: ['github', 'code'],
  },
  {
    id: 'gh.pr.list',
    name: 'List pull requests',
    description: 'List PRs in the current repository.',
    family: 'gh',
    capabilities: ['code.pr.list'],
    template: 'gh pr list --state {state} --limit {limit} --json number,title,author,state,createdAt',
    inputs: {
      state: { type: 'string', default: 'open', description: 'open | closed | merged | all' },
      limit: { type: 'integer', default: 20 },
    },
    tags: ['github', 'code'],
  },
  {
    id: 'gh.pr.view',
    name: 'View a pull request',
    description: 'Get full details of a single PR including comments and reviews.',
    family: 'gh',
    capabilities: ['code.pr.list'],
    template: 'gh pr view {number} --json number,title,body,state,comments,reviews',
    inputs: {
      number: { type: 'integer', required: true, description: 'PR number' },
    },
    tags: ['github', 'code'],
  },
  {
    id: 'gh.issue.create',
    name: 'Create an issue',
    description: 'Open a new GitHub issue.',
    family: 'gh',
    capabilities: ['code.issue.create'],
    template: 'gh issue create --title "{title}" --body "{body}"',
    inputs: {
      title: { type: 'string', required: true },
      body: { type: 'string', required: true },
    },
    tags: ['github', 'code'],
  },
  {
    id: 'gh.issue.list',
    name: 'List issues',
    description: 'List issues in the current repository.',
    family: 'gh',
    capabilities: ['code.issue.list'],
    template: 'gh issue list --state {state} --limit {limit} --json number,title,author,state,labels',
    inputs: {
      state: { type: 'string', default: 'open' },
      limit: { type: 'integer', default: 30 },
    },
    tags: ['github', 'code'],
  },

  // ─── git ────────────────────────────────────────────────────────────
  {
    id: 'git.status',
    name: 'git status',
    description: 'Show the working tree status.',
    family: 'git',
    capabilities: ['code.repo.read'],
    template: 'git status --short',
    inputs: {},
    tags: ['git'],
  },
  {
    id: 'git.diff',
    name: 'git diff',
    description: 'Show unstaged or staged changes.',
    family: 'git',
    capabilities: ['code.repo.read'],
    template: 'git diff {target}',
    inputs: {
      target: { type: 'string', default: '', description: 'Optional ref or --staged' },
    },
    pattern: '^git diff(?: .+)?$',
    tags: ['git'],
  },
  {
    id: 'git.log',
    name: 'git log',
    description: 'Recent commits with one-line summaries.',
    family: 'git',
    capabilities: ['code.repo.read', 'code.commit.list'],
    template: 'git log --oneline -n {limit}',
    inputs: {
      limit: { type: 'integer', default: 20 },
    },
    tags: ['git'],
  },
  {
    id: 'git.branch.list',
    name: 'git branch',
    description: 'List local branches.',
    family: 'git',
    capabilities: ['code.branch.list'],
    template: 'git branch --sort=-committerdate',
    inputs: {},
    tags: ['git'],
  },

  // ─── gcloud ─────────────────────────────────────────────────────────
  {
    id: 'gcloud.run.deploy',
    name: 'Deploy a service to Cloud Run',
    description: 'Deploy a containerized service to Google Cloud Run.',
    family: 'gcloud',
    capabilities: ['cloud.deploy.container'],
    template: 'gcloud run deploy {service} --image {image} --region {region} --format=json',
    inputs: {
      service: { type: 'string', required: true },
      image: { type: 'string', required: true, description: 'Container image URL' },
      region: { type: 'string', default: 'us-central1' },
    },
    tags: ['gcp', 'cloud'],
  },
  {
    id: 'gcloud.storage.list',
    name: 'List GCS buckets',
    description: 'List Google Cloud Storage buckets in the current project.',
    family: 'gcloud',
    capabilities: ['cloud.storage.list'],
    template: 'gcloud storage ls --format=json',
    inputs: {},
    tags: ['gcp', 'cloud'],
  },

  // ─── Stripe CLI ─────────────────────────────────────────────────────
  {
    id: 'stripe.refunds.create',
    name: 'Issue a refund',
    description: 'Refund a payment intent through Stripe.',
    family: 'stripe',
    capabilities: ['payment.refund.create'],
    template: 'stripe refunds create --payment_intent {payment_intent} --reason {reason}',
    inputs: {
      payment_intent: { type: 'string', required: true },
      reason: { type: 'string', default: 'customer_request', description: 'duplicate | fraudulent | customer_request' },
    },
    tags: ['stripe', 'payments'],
  },
  {
    id: 'stripe.customers.retrieve',
    name: 'Get a Stripe customer',
    description: 'Retrieve a customer record by id.',
    family: 'stripe',
    capabilities: ['payment.customer.retrieve'],
    template: 'stripe customers retrieve {id}',
    inputs: {
      id: { type: 'string', required: true },
    },
    tags: ['stripe', 'payments'],
  },

  // ─── kubectl ────────────────────────────────────────────────────────
  {
    id: 'kubectl.get',
    name: 'kubectl get',
    description: 'List resources of a given kind in the current namespace.',
    family: 'kubectl',
    capabilities: ['cloud.k8s.get'],
    template: 'kubectl get {resource} -o json',
    inputs: {
      resource: { type: 'string', required: true, description: 'pods | deployments | services | etc.' },
    },
    tags: ['k8s', 'cloud'],
  },
  {
    id: 'kubectl.logs',
    name: 'kubectl logs',
    description: 'Stream or fetch logs from a pod.',
    family: 'kubectl',
    capabilities: ['cloud.k8s.logs'],
    template: 'kubectl logs {pod} --tail={tail}',
    inputs: {
      pod: { type: 'string', required: true },
      tail: { type: 'integer', default: 200 },
    },
    tags: ['k8s', 'cloud'],
  },

  // ─── AWS CLI ────────────────────────────────────────────────────────
  {
    id: 'aws.s3.ls',
    name: 'List S3 objects',
    description: 'List buckets or the contents of an S3 path.',
    family: 'aws',
    capabilities: ['cloud.storage.list'],
    template: 'aws s3 ls {path}',
    inputs: {
      path: { type: 'string', default: '', description: 's3://bucket/prefix or empty for all buckets' },
    },
    pattern: '^aws s3 ls(?: .+)?$',
    tags: ['aws', 'cloud'],
  },
  {
    id: 'aws.lambda.invoke',
    name: 'Invoke a Lambda function',
    description: 'Invoke an AWS Lambda function synchronously.',
    family: 'aws',
    capabilities: ['cloud.compute.invoke'],
    template: 'aws lambda invoke --function-name {name} --payload {payload} /tmp/lambda-out.json',
    inputs: {
      name: { type: 'string', required: true },
      payload: { type: 'string', required: true, description: 'JSON payload (base64 or file://)' },
    },
    tags: ['aws', 'cloud'],
  },
  {
    id: 'aws.ec2.describe',
    name: 'Describe EC2 instances',
    description: 'Inspect EC2 instances in the current region.',
    family: 'aws',
    capabilities: ['cloud.compute.list'],
    template: 'aws ec2 describe-instances --output json',
    inputs: {},
    tags: ['aws', 'cloud'],
  },

  // ─── Docker ─────────────────────────────────────────────────────────
  {
    id: 'docker.ps',
    name: 'docker ps',
    description: 'List running containers.',
    family: 'docker',
    capabilities: ['cloud.container.list'],
    template: 'docker ps --format json',
    inputs: {},
    tags: ['docker', 'container'],
  },
  {
    id: 'docker.build',
    name: 'docker build',
    description: 'Build an image from a Dockerfile.',
    family: 'docker',
    capabilities: ['cloud.container.build'],
    template: 'docker build -t {tag} {path}',
    inputs: {
      tag: { type: 'string', required: true },
      path: { type: 'string', default: '.' },
    },
    tags: ['docker', 'container'],
  },
  {
    id: 'docker.logs',
    name: 'docker logs',
    description: 'Fetch logs from a running container.',
    family: 'docker',
    capabilities: ['cloud.container.logs'],
    template: 'docker logs --tail {tail} {container}',
    inputs: {
      container: { type: 'string', required: true },
      tail: { type: 'integer', default: 200 },
    },
    tags: ['docker', 'container'],
  },

  // ─── npm / pnpm ─────────────────────────────────────────────────────
  {
    id: 'npm.install',
    name: 'npm install',
    description: 'Install a package into the current project.',
    family: 'npm',
    capabilities: ['code.dep.install'],
    template: 'npm install {pkg}',
    inputs: {
      pkg: { type: 'string', required: true },
    },
    tags: ['npm', 'code'],
  },
  {
    id: 'npm.run',
    name: 'npm run',
    description: 'Run a package.json script.',
    family: 'npm',
    capabilities: ['code.script.run'],
    template: 'npm run {script}',
    inputs: {
      script: { type: 'string', required: true },
    },
    tags: ['npm', 'code'],
  },
  {
    id: 'pnpm.install',
    name: 'pnpm install',
    description: 'Install dependencies via pnpm.',
    family: 'pnpm',
    capabilities: ['code.dep.install'],
    template: 'pnpm install',
    inputs: {},
    tags: ['pnpm', 'code'],
  },
  {
    id: 'pnpm.run',
    name: 'pnpm run',
    description: 'Run a pnpm workspace script.',
    family: 'pnpm',
    capabilities: ['code.script.run'],
    template: 'pnpm run {script}',
    inputs: {
      script: { type: 'string', required: true },
    },
    tags: ['pnpm', 'code'],
  },

  // ─── jq / yq — data shaping ─────────────────────────────────────────
  {
    id: 'jq.run',
    name: 'jq',
    description: 'Filter and reshape JSON.',
    family: 'jq',
    capabilities: ['data.json.transform'],
    template: 'jq {expr} {file}',
    inputs: {
      expr: { type: 'string', required: true, description: 'jq expression (quoted)' },
      file: { type: 'string', default: '', description: 'Input file path or empty for stdin' },
    },
    pattern: '^jq .+$',
    tags: ['data', 'json'],
  },
  {
    id: 'yq.run',
    name: 'yq',
    description: 'Filter and reshape YAML.',
    family: 'yq',
    capabilities: ['data.yaml.transform'],
    template: 'yq {expr} {file}',
    inputs: {
      expr: { type: 'string', required: true },
      file: { type: 'string', default: '' },
    },
    pattern: '^yq .+$',
    tags: ['data', 'yaml'],
  },

  // ─── Helm ───────────────────────────────────────────────────────────
  {
    id: 'helm.list',
    name: 'helm list',
    description: 'List Helm releases in the current namespace.',
    family: 'helm',
    capabilities: ['cloud.k8s.release.list'],
    template: 'helm list --output json',
    inputs: {},
    tags: ['helm', 'k8s'],
  },
  {
    id: 'helm.upgrade',
    name: 'helm upgrade',
    description: 'Install or upgrade a Helm release.',
    family: 'helm',
    capabilities: ['cloud.k8s.release.deploy'],
    template: 'helm upgrade --install {release} {chart} --values {values}',
    inputs: {
      release: { type: 'string', required: true },
      chart: { type: 'string', required: true },
      values: { type: 'string', required: true, description: 'Path to values.yaml' },
    },
    tags: ['helm', 'k8s'],
  },

  // ─── Terraform ──────────────────────────────────────────────────────
  {
    id: 'terraform.plan',
    name: 'terraform plan',
    description: 'Generate a Terraform execution plan.',
    family: 'terraform',
    capabilities: ['cloud.iac.plan'],
    template: 'terraform plan -no-color -out={out}',
    inputs: {
      out: { type: 'string', default: 'tfplan' },
    },
    tags: ['terraform', 'iac'],
  },
  {
    id: 'terraform.apply',
    name: 'terraform apply',
    description: 'Apply a previously generated Terraform plan.',
    family: 'terraform',
    capabilities: ['cloud.iac.apply'],
    template: 'terraform apply -no-color -auto-approve {plan}',
    inputs: {
      plan: { type: 'string', default: 'tfplan' },
    },
    tags: ['terraform', 'iac'],
  },

  // ─── Vercel ─────────────────────────────────────────────────────────
  {
    id: 'vercel.deploy',
    name: 'vercel deploy',
    description: 'Deploy the current project to Vercel.',
    family: 'vercel',
    capabilities: ['cloud.deploy.frontend'],
    template: 'vercel deploy --yes --prod={prod}',
    inputs: {
      prod: { type: 'boolean', default: false },
    },
    tags: ['vercel', 'cloud'],
  },

  // ─── psql ───────────────────────────────────────────────────────────
  {
    id: 'psql.query',
    name: 'psql -c',
    description: 'Run a single SQL statement against a Postgres database.',
    family: 'psql',
    capabilities: ['data.sql.query'],
    template: 'psql {dsn} -c {sql}',
    inputs: {
      dsn: { type: 'string', required: true, description: 'Postgres connection string' },
      sql: { type: 'string', required: true, description: 'Single quoted SQL statement' },
    },
    pattern: '^psql .+ -c .+$',
    tags: ['postgres', 'data'],
  },
];

// ─── Resolution ───────────────────────────────────────────────────────────

export interface ResolvedCliTool {
  id: string;
  def: CliToolDef;
  /** Regex source the bash gate uses to validate invocations. */
  pattern: string;
}

export interface CliToolResolution {
  /** Tools the agent's `cli:*` refs successfully matched. */
  resolved: ResolvedCliTool[];
  /** `cli:*` refs that don't appear in the registry. */
  unresolved: string[];
  /** System-prompt addendum describing every resolved tool. */
  systemPromptAddendum: string;
  /** Bash command patterns the gate will allow (regex sources). */
  bashAllowPatterns: string[];
  /** Unique CLI families involved (for UI grouping). */
  families: string[];
}

/**
 * Translate the agent's `tools: [cli:*, ...]` declarations into the
 * artifacts the runtime needs to give Claude shell access safely.
 */
export function resolveCliTools(
  agentTools: string[],
  registry: CliToolDef[] = STARTER_CLI_TOOLS,
): CliToolResolution {
  const cliRefs = agentTools
    .filter((t) => t.startsWith('cli:'))
    .map((t) => t.slice(4));

  const byId = new Map(registry.map((d) => [d.id, d]));
  const resolved: ResolvedCliTool[] = [];
  const unresolved: string[] = [];
  const families = new Set<string>();

  for (const id of cliRefs) {
    const def = byId.get(id);
    if (!def) {
      unresolved.push(`cli:${id}`);
      continue;
    }
    families.add(def.family);
    resolved.push({
      id,
      def,
      pattern: def.pattern ?? templateToPattern(def.template),
    });
  }

  return {
    resolved,
    unresolved,
    systemPromptAddendum: buildAddendum(resolved),
    bashAllowPatterns: resolved.map((r) => r.pattern),
    families: [...families],
  };
}

/** Build the system-prompt section that teaches Claude what shell commands it can run. */
function buildAddendum(resolved: ResolvedCliTool[]): string {
  if (resolved.length === 0) return '';

  const byFamily = new Map<string, ResolvedCliTool[]>();
  for (const r of resolved) {
    const list = byFamily.get(r.def.family) ?? [];
    list.push(r);
    byFamily.set(r.def.family, list);
  }

  const sections: string[] = [];
  sections.push('## Available shell commands');
  sections.push(
    'You have access to the SDK Bash tool — but only for the specific commands listed below. ' +
      'Any other shell command will be denied by the runtime. Use these CLIs for the operations they ' +
      "cover; ask the user if you need a CLI that isn't listed.",
  );

  for (const [family, tools] of [...byFamily.entries()].sort()) {
    sections.push(`\n### \`${family}\``);
    for (const r of tools) {
      const inputs = formatInputDocs(r.def.inputs);
      sections.push(`- **${r.def.name}** — ${r.def.description}`);
      sections.push(`  Template: \`${r.def.template}\``);
      if (inputs) sections.push(`  Inputs: ${inputs}`);
    }
  }

  return sections.join('\n');
}

function formatInputDocs(inputs: Record<string, CliToolInput>): string {
  const entries = Object.entries(inputs);
  if (entries.length === 0) return '';
  return entries
    .map(([name, def]) => {
      const parts = [name, def.type];
      if (def.required) parts.push('required');
      if (def.default !== undefined) parts.push(`default=${JSON.stringify(def.default)}`);
      return `\`${parts.join(', ')}\``;
    })
    .join(' · ');
}

/**
 * Translate a template like `gh pr create --title "{title}" --base {base}`
 * into a bash-allow regex like `^gh pr create --title ".+" --base [^\s]+$`.
 *
 * Naive but effective for v1. Tools that need richer matching can supply
 * an explicit `pattern` in the def.
 */
function templateToPattern(template: string): string {
  // Escape regex metachars first
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Replace {name} placeholders with permissive captures
  // Quoted placeholders → match anything inside the quotes
  // Bare placeholders   → match a single shell token (no whitespace)
  const withPlaceholders = escaped
    .replace(/"\\\{[^}]+\\\}"/g, '".+"')
    .replace(/\\\{[^}]+\\\}/g, '\\S+');
  return `^${withPlaceholders}$`;
}

/** Test whether a bash command matches any of the supplied allow patterns. */
export function bashCommandAllowed(command: string, allowPatterns: string[]): boolean {
  if (allowPatterns.length === 0) return false;
  return allowPatterns.some((p) => new RegExp(p).test(command.trim()));
}
