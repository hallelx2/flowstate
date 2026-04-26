# flowstate — Agent Spec v1.0

The contract every agent file, every tool adapter, and every marketplace install conforms to.

This document is the canonical reference. The Zod source of truth is at [`packages/core/src/schema.ts`](packages/core/src/schema.ts).

---

## 1. The agent file

An **agent** is a markdown file with YAML frontmatter (or a pure YAML file). It defines:

- **What** to do (`name`, `description`, `sections.goal`)
- **When** to do it (`trigger`)
- **Which tools** to use (`tools` or `needs`)
- **What to spend** on it (`budget`)
- **What it's allowed to touch** (`permissions`)
- **How Claude should reason** (`guardrails`)
- **What it expects as input** (`inputs`)
- **What secrets it reads** (`secrets`)
- **Which sub-skills it composes from** (`dependencies`)

### Minimum viable agent

```yaml
---
specVersion: "1.0"
id: hello-world
name: Hello world
trigger: { kind: manual }
---

## Goal
Say hello.
```

That's a valid agent. Nothing else is required.

### Marketplace-publishable agent

```yaml
---
specVersion: "1.0"
id: refund-handler
name: Refund handler
description: Process customer refund requests within the 30-day window.

publisher: flowstate-examples
version: 1.0.0
license: MIT
repository: github:flowstate/examples
tags: [stripe, refunds, billing, hitl]

trigger:
  kind: webhook
  config: { path: /refund, method: POST }

tools:
  - mcp:stripe.refunds.create
  - mcp:gmail.messages.send

needs:
  - communication.email.send
  - payment.refund.create

inputs:
  order_id: { type: string, required: true }
  reason: { type: string, required: true }

secrets: [STRIPE_API_KEY, GMAIL_TOKEN]

budget: { tokens: 50000, usd: 0.50, runtimeMs: 300000 }

permissions:
  network: [api.stripe.com, gmail.googleapis.com]
  approvalRequired:
    - mcp:stripe.refunds.create

guardrails:
  permissionMode: default
  maxTurns: 30
  effort: medium

sections:
  goal: { include: ./refund-handler/goal.md }
  steps: [{ id: verify, title: Verify, body: { include: ./refund-handler/steps/01.md } }]
---
```

### Field reference

| Field | Required | Purpose |
|---|---|---|
| `specVersion` | ✓ (defaults `"1.0"`) | Pins the parser. Marketplace installs reject mismatches. |
| `id` | ✓ | kebab-case, unique within the publisher namespace |
| `name` | ✓ | Human-readable label |
| `description` | | One-line summary for marketplace cards |
| `publisher` | for publish | kebab-case namespace (like an npm scope) |
| `version` | for publish | semver |
| `license` | for publish | SPDX identifier (MIT, Apache-2.0, etc.) |
| `repository` | | `github:user/repo` or full git URL |
| `homepage` | | URL to the agent's docs |
| `tags` | | Free-form for marketplace filtering |
| `trigger` | ✓ | Discriminated by `kind`: `manual` · `webhook` · `cron` · `watch` · `event` |
| `tools` | | Explicit tool refs: `provider:id.action` |
| `needs` | | Capability tags from the ontology — resolver picks tools |
| `inputs` | | Typed input schema. Runtime validates payloads against this. |
| `secrets` | | Env/keychain entry names this agent reads |
| `dependencies` | | Sub-skill imports (local refs or marketplace refs) |
| `budget` | | Hard caps: `tokens`, `usd`, `runtimeMs` |
| `permissions` | | Default-deny gates: `network`, `fs.{read,write}`, `env`, `approvalRequired` |
| `guardrails` | | Claude Agent SDK options the agent locks in (see §3) |
| `sections` | | Linked-file structure: `goal`, `rules`, `steps`, `onFailure` |

---

## 2. Tool refs

Every tool is addressed as `provider:id` or `provider:id.action`.

```
mcp:gmail.messages.send
cli:gh.pr.create
http:notion.pages.create
composio:slack.chat.post
skill:notify-ops
shell:my-script
sdk:stripe-node
```

The seven providers have specific contracts (see §5).

---

## 3. Capability ontology

Instead of declaring specific tools, agents can declare **capabilities** they need:

```yaml
needs:
  - communication.email.send
  - payment.refund.create
  - cloud.storage.read
```

The runtime resolves these to whichever tool the user has installed — same agent works for Gmail or Outlook users. Full vocabulary lives in [`packages/core/src/capabilities.ts`](packages/core/src/capabilities.ts).

**Discipline**: capabilities are dotted paths, max 4 segments, lowercase. New capabilities go through PR review against the ontology file. The runtime warns on unknown capabilities but doesn't fail — community publishers may need new tags before the registry catches up.

### v1.0 domains (~80 tags)

`communication` · `payment` · `cloud` · `code` · `data` · `project` · `note` · `calendar` · `crm` · `file` · `web` · `ml` · `system` · `workflow`

---

## 4. Claude Agent SDK guardrails

The `guardrails:` block maps directly to SDK options. Every field is optional.

### `permissionMode`

How tool calls are gated. Maps to SDK's `permissionMode` parameter.

| Mode | Behavior | When to use |
|---|---|---|
| `default` | Each tool call goes through `canUseTool` (= the HITL banner) | Untrusted agents, destructive workflows, first runs |
| `acceptEdits` | File edits auto-approve; other tools still gate | Code-writing agents working in your own repo |
| `plan` | Agent only proposes — never executes any tool | Dry runs, "what would you do?" mode |
| `bypassPermissions` | All tools auto-approve | Trusted agents in sandboxed envs only |

### `maxTurns`

Hard cap on the SDK's agentic loop. Default is unbounded (dangerous). For most agents, 20–50 is plenty.

### `allowedTools` / `disallowedTools`

Explicit allowlist/denylist of SDK-known tool names (`Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`, `WebFetch`, `Task`, etc.). If `allowedTools` is set, only those are usable. `disallowedTools` is checked even when `allowedTools` is unset.

### `effort`

Reasoning effort hint. `low` | `medium` | `high` | `xhigh` | `max` — or an integer.

---

## 5. Standardized tool adapter contract

Every tool kind implements [`ToolAdapter`](packages/core/src/tool-adapter.ts). Authoring a new tool kind = implementing this interface once.

```typescript
interface ToolAdapter {
  manifest(): Promise<ToolManifest>;
  init(config: ToolConfig): Promise<void>;
  authStatus(): Promise<AuthStatus>;
  authSetup?(): Promise<AuthFlow>;
  health(): Promise<ToolHealth>;
  listActions(): Promise<ToolAction[]>;
  invoke(action, args, opts?): Promise<ToolResult>;
  dispose?(): Promise<void>;
}
```

### Per-kind specifics

| Kind | Config | Auth | Notes |
|---|---|---|---|
| `mcp` | `{ command, args, env }` OR `{ url }` | Per-server | Pool keeps warm 10 most-recent, evicts after 5m idle |
| `cli` | `{ command, requiredVersion, authProbeCommand }` | Ambient (user's `gcloud auth login` etc.) | Sandboxed Bash with allowlist regex |
| `http` | `{ baseUrl, auth: bearer/basic/header/oauth2, defaultHeaders }` | Per-API key in keychain | Auto-truncate large responses |
| `composio` | `{ action, connectedAccountId }` | Composio's cloud OAuth | Single tool slot via `composio.execute` router |
| `skill` | `{ path }` | Inherited | Recursive — skills are agents without triggers |
| `shell` | `{ path, sandboxed }` | None | Path resolved against agents root |
| `sdk` | `{ module, options }` | Per-SDK | Type-safe wrappers via codegen |

### Authoring a new tool

1. Implement `ToolAdapter` in TypeScript
2. Provide a manifest with `id`, `name`, `kind`, `capabilities`, `actions`, `auth`
3. Register in the tool registry directory (`~/.flowstate/tools/<id>/`)
4. Test via the Tool Directory's "Test action" UI in Settings

---

## 6. The marketplace install screen

When a user runs `flowstate add github:publisher/agent-id`, the install UI shows:

- **Identity** — publisher, name, version, license, signature
- **What it does** — description + first paragraph of `goal`
- **Trigger** — when this thing will fire
- **Tools needed** — translated to "what could it touch on your machine"
- **Capabilities required** — semantic tags
- **Inputs expected** — typed schema (renders as a form preview)
- **Secrets required** — exact env var / keychain entry names
- **Permissions** — network domains, fs paths, env vars
- **Approval points** — which steps will pause for HITL
- **Budget** — tokens / USD / runtime caps
- **Guardrails** — permission mode, max turns

User clicks Install → agent file is written to `~/.flowstate/agents/<publisher>/<id>/`. Runtime cross-checks the declared permissions against actual invocations at run time.

---

## 7. Versioning + compatibility

| Spec change | Allowed in | Behavior |
|---|---|---|
| Add optional field | Minor (1.0 → 1.1) | Older parsers ignore it |
| Add required field | Major (1.x → 2.0) | Older parsers reject |
| Add capability tag | Patch | Always allowed, additive |
| Remove capability tag | Major | Deprecation cycle of 2 minor versions |
| Change tool ref format | Major | Migration script provided |

The runtime always honors `specVersion` — files declaring `"2.0"` won't load on a v1 runtime. This keeps the marketplace honest as we evolve.

---

## 8. File layout convention (multi-file agents)

```
<publisher>/<agent-id>/
  agent.md                    # master with frontmatter + section refs
  goal.md                     # the goal section (referenced via { include: })
  rules/
    *.md                      # one rule per file
  steps/
    01-*.md                   # numeric prefix gives natural order
  on-failure.md               # failure handling
  README.md                   # human-readable docs (optional)
  CHANGELOG.md                # version history (optional)
  flowstate.lock              # resolved dependency tree (auto-generated)
```

Single-file agents work too — everything inline. Use multi-file when sections grow past ~30 lines or when rules/steps deserve independent review.

---

## 9. Reserved field names

These names are reserved and may have meaning in future spec versions. Don't use them as custom fields:

`specVersion`, `id`, `name`, `description`, `publisher`, `version`, `license`, `homepage`, `repository`, `tags`, `trigger`, `tools`, `needs`, `inputs`, `secrets`, `dependencies`, `budget`, `permissions`, `guardrails`, `sections`, `body`, `goal`.

---

## 10. The flowstate manifesto

> **An agent is a runbook a human can read, a markdown file git can diff, a permission contract you can audit, and a program Claude can execute — all the same artifact.**

Everything in this spec serves that one sentence.
