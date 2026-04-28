/**
 * CLI tool family catalog.
 *
 * Sibling of `mcp-marketplace`, but for command-line tools rather than MCP
 * servers. Where MCPs come from a public registry, the CLI catalog is
 * hand-curated — there's no canonical "registry of CLIs". Each entry
 * describes one brand (`gh`, `aws`, `docker`, …) and tells the runtime:
 *
 *   1. How to detect that the CLI is installed on this machine
 *      (a version-probe command, executed in main with timeout)
 *
 *   2. How to authenticate it
 *      (interactive command, env-var keychain, or both)
 *
 *   3. How the user installs it on each major platform
 *      (homebrew, winget, apt, etc. — we surface instructions; we
 *       don't sudo for them)
 *
 *   4. What the actions are that agents can invoke
 *      (cross-references the per-action entries in `cli-tools.ts` —
 *       e.g. `gh` family contains `gh.pr.create`, `gh.pr.list`, …)
 *
 * The runtime itself doesn't shell out from this module — that lives in
 * the desktop main process. This file is pure data + helpers so it ships
 * to both renderer (for the marketplace UI) and main (for the probes).
 */

import { STARTER_CLI_TOOLS, type CliToolDef } from './cli-tools';

// ─── Per-OS install instructions ──────────────────────────────────────────

export type Platform = 'darwin' | 'win32' | 'linux';

export interface InstallInstruction {
  /** Display label for the package manager / approach. */
  label: string;
  /** One-line shell command the user pastes into their terminal. */
  command: string;
  /** Is this the recommended path on this OS? Drives the "primary" CTA. */
  primary?: boolean;
}

export interface InstallSteps {
  darwin?: InstallInstruction[];
  win32?: InstallInstruction[];
  linux?: InstallInstruction[];
  /** Generic / cross-platform fallback link (curl install script, releases page). */
  manual?: { url: string; description?: string };
}

// ─── Auth shapes ──────────────────────────────────────────────────────────

/**
 * How the user authenticates this CLI. Three shapes the catalog supports:
 *
 *   command   Run an interactive command (`gh auth login`). The runtime
 *             spawns it in a detached terminal so the user completes the
 *             OAuth / device-code flow themselves.
 *
 *   env       Authentication is via environment variables read at every
 *             invocation. Maps to the same keychain the MCP marketplace
 *             uses, so secrets never round-trip through the renderer.
 *
 *   none      The CLI doesn't need authentication (e.g. `jq`, `git`
 *             against public repos, `docker` against a local daemon).
 */
export type CliAuth =
  | {
      kind: 'command';
      /** The command to run — usually interactive. */
      command: string;
      /** Probe command that returns 0 when authenticated. */
      probe?: string;
      /** One-line description shown next to the Authenticate button. */
      description?: string;
    }
  | {
      kind: 'env';
      /** Env vars the CLI reads. Reuses the keychain via the secrets API. */
      envVars: Array<{
        name: string;
        description?: string;
        required?: boolean;
        secret?: boolean;
      }>;
      /** Optional probe command (e.g. `aws sts get-caller-identity`). */
      probe?: string;
      description?: string;
    }
  | {
      kind: 'none';
    };

// ─── Family entry ─────────────────────────────────────────────────────────

export interface CliToolFamily {
  /** Tool ref family — what shows after `cli:` (e.g. `gh` for `cli:gh.pr.create`). */
  id: string;
  /** Display name. */
  name: string;
  /** One-line description for the marketplace card. */
  description: string;
  /** What this CLI is for, in 2-3 sentences. Surfaced on the detail panel. */
  longDescription?: string;
  /** Brand colour (CSS hex) used for the icon background. */
  brandColor?: string;
  /** Optional brand icon URL. Falls back to a monogram bubble. */
  iconUrl?: string;
  /** Capability tags — folded into agents' `needs:` resolution. */
  capabilities: string[];
  /** Free-form tags for marketplace filtering. */
  tags?: string[];
  /** Official documentation / homepage. */
  homepage?: string;
  /** Publisher name (e.g. "GitHub", "AWS", "HashiCorp"). */
  publisher?: string;
  /**
   * Probe that succeeds (exit 0) if the CLI is on PATH. Usually
   * `<cli> --version`. Runs with a 3s timeout in main.
   */
  versionProbe: string;
  /** Auth descriptor — see CliAuth. */
  auth: CliAuth;
  /** Per-OS install instructions. */
  install: InstallSteps;
  /** Curation flags (mirror the MCP marketplace). */
  verified?: boolean;
  featured?: boolean;
}

// ─── The catalog ──────────────────────────────────────────────────────────

/**
 * Curated list of CLIs flowstate ships out of the box. Order: featured
 * first, then alphabetical. Adding a new CLI = drop an entry here +
 * add corresponding `cli:<family>.<action>` entries to STARTER_CLI_TOOLS.
 */
export const STARTER_CLI_FAMILIES: CliToolFamily[] = [
  {
    id: 'gh',
    name: 'GitHub CLI',
    description: 'Pull requests, issues, releases, and repos via gh.',
    longDescription:
      'The official GitHub command line. Open PRs, manage issues, run workflows, browse releases — all from the terminal, with first-class auth that survives across sessions.',
    brandColor: '#181717',
    iconUrl: 'https://github.com/github.png?size=128',
    capabilities: ['code.pr.create', 'code.pr.list', 'code.issue.create', 'code.issue.list', 'code.repo.read'],
    tags: ['github', 'code'],
    homepage: 'https://cli.github.com',
    publisher: 'GitHub',
    versionProbe: 'gh --version',
    auth: {
      kind: 'command',
      command: 'gh auth login',
      probe: 'gh auth status',
      description: 'Interactive OAuth flow — opens your browser.',
    },
    install: {
      darwin: [{ label: 'Homebrew', command: 'brew install gh', primary: true }],
      win32: [
        { label: 'Winget', command: 'winget install --id GitHub.cli', primary: true },
        { label: 'Scoop', command: 'scoop install gh' },
      ],
      linux: [
        { label: 'apt', command: 'sudo apt install gh', primary: true },
        { label: 'dnf', command: 'sudo dnf install gh' },
      ],
      manual: { url: 'https://cli.github.com', description: 'Official downloads + scripts' },
    },
    verified: true,
    featured: true,
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Distributed version control — diffs, log, branches.',
    brandColor: '#F05032',
    iconUrl: 'https://github.com/git.png?size=128',
    capabilities: ['code.repo.read', 'code.commit.list', 'code.branch.list'],
    tags: ['git', 'code'],
    homepage: 'https://git-scm.com',
    publisher: 'git-scm.com',
    versionProbe: 'git --version',
    auth: { kind: 'none' },
    install: {
      darwin: [{ label: 'Homebrew', command: 'brew install git', primary: true }],
      win32: [
        { label: 'Winget', command: 'winget install --id Git.Git', primary: true },
      ],
      linux: [
        { label: 'apt', command: 'sudo apt install git', primary: true },
        { label: 'dnf', command: 'sudo dnf install git' },
      ],
      manual: { url: 'https://git-scm.com/downloads' },
    },
    verified: true,
    featured: true,
  },
  {
    id: 'aws',
    name: 'AWS CLI',
    description: 'Manage AWS services from the terminal — S3, Lambda, EC2, IAM.',
    brandColor: '#FF9900',
    iconUrl: 'https://github.com/aws.png?size=128',
    capabilities: ['cloud.compute.list', 'cloud.storage.list', 'cloud.iam.read'],
    tags: ['aws', 'cloud'],
    homepage: 'https://aws.amazon.com/cli',
    publisher: 'Amazon Web Services',
    versionProbe: 'aws --version',
    auth: {
      kind: 'env',
      envVars: [
        { name: 'AWS_ACCESS_KEY_ID', required: true, secret: true, description: 'IAM access key id.' },
        { name: 'AWS_SECRET_ACCESS_KEY', required: true, secret: true, description: 'IAM secret key.' },
        { name: 'AWS_REGION', description: 'Default region (e.g. us-east-1).' },
        { name: 'AWS_PROFILE', description: 'Named profile from ~/.aws/credentials.' },
      ],
      probe: 'aws sts get-caller-identity',
      description: 'Set IAM credentials, or run `aws configure` for an interactive flow.',
    },
    install: {
      darwin: [{ label: 'Homebrew', command: 'brew install awscli', primary: true }],
      win32: [
        { label: 'Winget', command: 'winget install --id Amazon.AWSCLI', primary: true },
      ],
      linux: [{ label: 'pip', command: 'pip install awscli', primary: true }],
      manual: { url: 'https://aws.amazon.com/cli', description: 'Official MSI / installers' },
    },
    verified: true,
    featured: true,
  },
  {
    id: 'gcloud',
    name: 'Google Cloud SDK',
    description: 'Deploy, manage, and inspect Google Cloud resources.',
    brandColor: '#4285F4',
    iconUrl: 'https://github.com/GoogleCloudPlatform.png?size=128',
    capabilities: ['cloud.deploy.container', 'cloud.storage.list', 'cloud.compute.list'],
    tags: ['gcp', 'cloud'],
    homepage: 'https://cloud.google.com/sdk',
    publisher: 'Google Cloud',
    versionProbe: 'gcloud --version',
    auth: {
      kind: 'command',
      command: 'gcloud auth login',
      probe: 'gcloud auth list --filter=status:ACTIVE --format="value(account)"',
      description: 'Browser-based OAuth for your Google Cloud account.',
    },
    install: {
      darwin: [{ label: 'Homebrew Cask', command: 'brew install --cask google-cloud-sdk', primary: true }],
      win32: [
        { label: 'Winget', command: 'winget install --id Google.CloudSDK', primary: true },
      ],
      linux: [{ label: 'apt', command: 'sudo apt install google-cloud-cli', primary: true }],
      manual: { url: 'https://cloud.google.com/sdk/docs/install' },
    },
    verified: true,
    featured: true,
  },
  {
    id: 'kubectl',
    name: 'kubectl',
    description: 'Talk to a Kubernetes cluster — pods, deployments, services, logs.',
    brandColor: '#326CE5',
    iconUrl: 'https://github.com/kubernetes.png?size=128',
    capabilities: ['cloud.k8s.get', 'cloud.k8s.logs'],
    tags: ['k8s', 'cloud'],
    homepage: 'https://kubernetes.io/docs/reference/kubectl',
    publisher: 'Kubernetes',
    versionProbe: 'kubectl version --client=true',
    auth: {
      kind: 'none',
      // kubectl reads `~/.kube/config` — populated by your cluster provider
      // (eks/gke/aks token plugins). We treat that as "auth: none" because
      // there's no flowstate-managed credential.
    },
    install: {
      darwin: [{ label: 'Homebrew', command: 'brew install kubectl', primary: true }],
      win32: [
        { label: 'Winget', command: 'winget install --id Kubernetes.kubectl', primary: true },
      ],
      linux: [{ label: 'apt', command: 'sudo apt install kubectl', primary: true }],
      manual: { url: 'https://kubernetes.io/docs/tasks/tools' },
    },
    verified: true,
  },
  {
    id: 'docker',
    name: 'Docker',
    description: 'Build, run, and manage containers locally and on remote daemons.',
    brandColor: '#2496ED',
    iconUrl: 'https://github.com/docker.png?size=128',
    capabilities: ['cloud.container.list', 'cloud.container.build', 'cloud.container.logs'],
    tags: ['docker', 'container'],
    homepage: 'https://www.docker.com',
    publisher: 'Docker, Inc.',
    versionProbe: 'docker --version',
    auth: {
      kind: 'command',
      command: 'docker login',
      probe: 'docker info --format "{{.Username}}"',
      description: 'Sign in to Docker Hub (or another registry).',
    },
    install: {
      darwin: [{ label: 'Homebrew Cask', command: 'brew install --cask docker', primary: true }],
      win32: [
        { label: 'Winget', command: 'winget install --id Docker.DockerDesktop', primary: true },
      ],
      linux: [{ label: 'apt', command: 'sudo apt install docker.io', primary: true }],
      manual: { url: 'https://www.docker.com/products/docker-desktop' },
    },
    verified: true,
    featured: true,
  },
  {
    id: 'stripe',
    name: 'Stripe CLI',
    description: 'Inspect, create, and refund Stripe payments from the terminal.',
    brandColor: '#635BFF',
    iconUrl: 'https://github.com/stripe.png?size=128',
    capabilities: ['payment.refund.create', 'payment.customer.retrieve'],
    tags: ['stripe', 'payment'],
    homepage: 'https://stripe.com/docs/stripe-cli',
    publisher: 'Stripe',
    versionProbe: 'stripe --version',
    auth: {
      kind: 'command',
      command: 'stripe login',
      probe: 'stripe config --list',
      description: 'Browser-based pairing with your Stripe account.',
    },
    install: {
      darwin: [{ label: 'Homebrew', command: 'brew install stripe/stripe-cli/stripe', primary: true }],
      win32: [{ label: 'Scoop', command: 'scoop install stripe', primary: true }],
      linux: [
        {
          label: 'apt',
          command:
            'curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg > /dev/null && echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" | sudo tee -a /etc/apt/sources.list.d/stripe.list && sudo apt update && sudo apt install stripe',
          primary: true,
        },
      ],
      manual: { url: 'https://stripe.com/docs/stripe-cli' },
    },
    verified: true,
    featured: true,
  },
  {
    id: 'vercel',
    name: 'Vercel CLI',
    description: 'Deploy frontend projects to Vercel and manage environment variables.',
    brandColor: '#000000',
    iconUrl: 'https://github.com/vercel.png?size=128',
    capabilities: ['cloud.deploy.frontend'],
    tags: ['vercel', 'cloud'],
    homepage: 'https://vercel.com/cli',
    publisher: 'Vercel',
    versionProbe: 'vercel --version',
    auth: {
      kind: 'command',
      command: 'vercel login',
      probe: 'vercel whoami',
      description: 'Email magic-link or GitHub OAuth.',
    },
    install: {
      darwin: [{ label: 'npm', command: 'npm i -g vercel', primary: true }],
      win32: [{ label: 'npm', command: 'npm i -g vercel', primary: true }],
      linux: [{ label: 'npm', command: 'npm i -g vercel', primary: true }],
      manual: { url: 'https://vercel.com/docs/cli' },
    },
    verified: true,
  },
  {
    id: 'npm',
    name: 'npm',
    description: 'Node.js package manager — install, run scripts, publish.',
    brandColor: '#CB3837',
    iconUrl: 'https://github.com/npm.png?size=128',
    capabilities: ['code.dep.install', 'code.script.run'],
    tags: ['npm', 'code'],
    homepage: 'https://www.npmjs.com',
    publisher: 'npm, Inc.',
    versionProbe: 'npm --version',
    auth: {
      kind: 'command',
      command: 'npm login',
      probe: 'npm whoami',
      description: 'Only needed to publish — installs work anonymously.',
    },
    install: {
      darwin: [{ label: 'Homebrew', command: 'brew install node', primary: true }],
      win32: [{ label: 'Winget', command: 'winget install --id OpenJS.NodeJS', primary: true }],
      linux: [{ label: 'apt', command: 'sudo apt install nodejs npm', primary: true }],
      manual: { url: 'https://nodejs.org' },
    },
    verified: true,
  },
  {
    id: 'pnpm',
    name: 'pnpm',
    description: 'Fast, disk-efficient package manager for Node.',
    brandColor: '#F69220',
    iconUrl: 'https://github.com/pnpm.png?size=128',
    capabilities: ['code.dep.install', 'code.script.run'],
    tags: ['pnpm', 'code'],
    homepage: 'https://pnpm.io',
    publisher: 'pnpm',
    versionProbe: 'pnpm --version',
    auth: { kind: 'none' },
    install: {
      darwin: [{ label: 'corepack', command: 'corepack enable pnpm', primary: true }],
      win32: [{ label: 'corepack', command: 'corepack enable pnpm', primary: true }],
      linux: [{ label: 'corepack', command: 'corepack enable pnpm', primary: true }],
      manual: { url: 'https://pnpm.io/installation' },
    },
    verified: true,
  },
  {
    id: 'jq',
    name: 'jq',
    description: 'Slice, filter, and reshape JSON on the command line.',
    brandColor: '#3D7CC9',
    iconUrl: 'https://github.com/jqlang.png?size=128',
    capabilities: ['data.json.transform'],
    tags: ['data', 'json'],
    homepage: 'https://jqlang.github.io/jq',
    publisher: 'jq language project',
    versionProbe: 'jq --version',
    auth: { kind: 'none' },
    install: {
      darwin: [{ label: 'Homebrew', command: 'brew install jq', primary: true }],
      win32: [{ label: 'Winget', command: 'winget install --id jqlang.jq', primary: true }],
      linux: [{ label: 'apt', command: 'sudo apt install jq', primary: true }],
      manual: { url: 'https://jqlang.github.io/jq/download' },
    },
    verified: true,
  },
  {
    id: 'yq',
    name: 'yq',
    description: 'jq for YAML — transform and query YAML documents.',
    brandColor: '#CB171E',
    iconUrl: 'https://github.com/mikefarah.png?size=128',
    capabilities: ['data.yaml.transform'],
    tags: ['data', 'yaml'],
    homepage: 'https://mikefarah.gitbook.io/yq',
    publisher: 'mikefarah',
    versionProbe: 'yq --version',
    auth: { kind: 'none' },
    install: {
      darwin: [{ label: 'Homebrew', command: 'brew install yq', primary: true }],
      win32: [{ label: 'Winget', command: 'winget install --id MikeFarah.yq', primary: true }],
      linux: [{ label: 'snap', command: 'sudo snap install yq', primary: true }],
      manual: { url: 'https://github.com/mikefarah/yq#install' },
    },
    verified: true,
  },
  {
    id: 'helm',
    name: 'Helm',
    description: 'Kubernetes package manager — install and upgrade chart releases.',
    brandColor: '#0F1689',
    iconUrl: 'https://github.com/helm.png?size=128',
    capabilities: ['cloud.k8s.release.list', 'cloud.k8s.release.deploy'],
    tags: ['helm', 'k8s'],
    homepage: 'https://helm.sh',
    publisher: 'CNCF / Helm',
    versionProbe: 'helm version --short',
    auth: { kind: 'none' },
    install: {
      darwin: [{ label: 'Homebrew', command: 'brew install helm', primary: true }],
      win32: [{ label: 'Winget', command: 'winget install --id Helm.Helm', primary: true }],
      linux: [{ label: 'apt', command: 'sudo apt install helm', primary: true }],
      manual: { url: 'https://helm.sh/docs/intro/install' },
    },
    verified: true,
  },
  {
    id: 'terraform',
    name: 'Terraform',
    description: 'Infrastructure as code — plan + apply across cloud providers.',
    brandColor: '#7B42BC',
    iconUrl: 'https://github.com/hashicorp.png?size=128',
    capabilities: ['cloud.iac.plan', 'cloud.iac.apply'],
    tags: ['terraform', 'iac'],
    homepage: 'https://www.terraform.io',
    publisher: 'HashiCorp',
    versionProbe: 'terraform version',
    auth: { kind: 'none' },
    install: {
      darwin: [{ label: 'Homebrew', command: 'brew tap hashicorp/tap && brew install hashicorp/tap/terraform', primary: true }],
      win32: [{ label: 'Winget', command: 'winget install --id HashiCorp.Terraform', primary: true }],
      linux: [{ label: 'apt', command: 'sudo apt install terraform', primary: true }],
      manual: { url: 'https://developer.hashicorp.com/terraform/install' },
    },
    verified: true,
  },
  {
    id: 'psql',
    name: 'psql',
    description: 'Postgres command-line client — run SQL against any Postgres database.',
    brandColor: '#336791',
    iconUrl: 'https://github.com/postgres.png?size=128',
    capabilities: ['data.sql.query'],
    tags: ['postgres', 'data'],
    homepage: 'https://www.postgresql.org',
    publisher: 'PostgreSQL',
    versionProbe: 'psql --version',
    auth: {
      kind: 'env',
      envVars: [
        { name: 'PGHOST', description: 'Hostname of the Postgres server.' },
        { name: 'PGUSER', description: 'Database role.' },
        { name: 'PGPASSWORD', secret: true, description: 'Password for the role.' },
        { name: 'PGDATABASE', description: 'Default database name.' },
        { name: 'DATABASE_URL', secret: true, description: 'Single-string connection alternative.' },
      ],
      description: 'Set PG* env vars or use DATABASE_URL.',
    },
    install: {
      darwin: [{ label: 'Homebrew', command: 'brew install libpq', primary: true }],
      win32: [{ label: 'Winget', command: 'winget install --id PostgreSQL.PostgreSQL', primary: true }],
      linux: [{ label: 'apt', command: 'sudo apt install postgresql-client', primary: true }],
      manual: { url: 'https://www.postgresql.org/download' },
    },
    verified: true,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Look up a family by id. */
export function findCliFamily(
  id: string,
  registry: CliToolFamily[] = STARTER_CLI_FAMILIES,
): CliToolFamily | undefined {
  return registry.find((f) => f.id === id);
}

/**
 * Pull every action entry that belongs to a family (e.g. all `gh.*`
 * actions for the `gh` family). Used by the detail panel to enumerate
 * what agents can actually do with the CLI once it's installed.
 */
export function actionsForFamily(
  familyId: string,
  actions: CliToolDef[] = STARTER_CLI_TOOLS,
): CliToolDef[] {
  return actions.filter((a) => a.family === familyId);
}

/** Pick the right install instructions for a platform, with a fallback to all. */
export function instructionsForPlatform(
  family: CliToolFamily,
  platform: Platform,
): InstallInstruction[] {
  return family.install[platform] ?? [];
}

/** Sort families: featured first, then verified, then by name. */
export function sortFamilies(families: CliToolFamily[]): CliToolFamily[] {
  return [...families].sort((a, b) => {
    const tierA = a.featured ? 2 : a.verified ? 1 : 0;
    const tierB = b.featured ? 2 : b.verified ? 1 : 0;
    if (tierA !== tierB) return tierB - tierA;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}
