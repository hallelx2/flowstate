# flowstate

> Talk to your agents like you talk to a person.

flowstate is a **markdown-driven process automation system**. Define agents in plain `.md` or `.yaml` files, give them tools (CLIs, MCP servers, skills, HTTP APIs, Composio integrations), and watch them work — with full visibility into every step they take, the ability to pause for human approval, and a permission gate that actually enforces what you declared.

It's the n8n alternative for people who'd rather write a runbook than wire a node graph.

---

## The thesis

> **An agent is a runbook a human can read, a markdown file git can diff, a permission contract you can audit, and a program Claude can execute — all the same artifact.**

Five things that follow from that:

1. **Conversation is the surface.** Describe the work the way you'd describe it to a teammate.
2. **Markdown is the source of truth.** Processes are literate documents — reviewable, shareable on GitHub, version-controlled like code.
3. **The visual flow is the proof.** Every tool call, every decision, every retry — laid out spatially so nothing happens behind your back.
4. **Tools come from where they already live.** Your authenticated CLIs (`gcloud`, `gh`, `stripe`, `kubectl`), MCP servers, and the skills you've written — flowstate finds them and binds them at runtime.
5. **Local-first, BYO subscription.** Your data stays on your machine. The runtime uses the Claude Agent SDK with whatever credentials you already have (Claude Code subscription / API key / local LLM). flowstate sells nothing — it conducts what you already pay for.

---

## Architecture

```
 ┌────────────────────────────────────────────────────────────────┐
 │                       Desktop client                           │
 │                Electron · React 18 · Tailwind 4                │
 │                                                                │
 │       Splash → Home · Agents · Tools · Runs · Settings         │
 └─────────────────────────────────┬──────────────────────────────┘
                                   │
                ┌──────────────────▼──────────────────┐
                │       @flowstate/core (shared)      │
                │                                     │
                │   Agent IR · Spec v1.0 (Zod)        │
                │   Capability ontology · ToolAdapter │
                │   Resolver · Permission gate        │
                │   CLI tool registry + bash gate     │
                │   .md / .yaml loader                │
                └──────────────────┬──────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
 ┌─────────────┐         ┌──────────────────┐         ┌────────────┐
 │   Tool      │         │   Claude SDK     │         │   IPC      │
 │  Registry   │ ◄──────►│  agent-runtime   │◄────────│  bridge    │
 │ (MCP·CLI·…) │         │   in main proc   │         │ (preload)  │
 └─────────────┘         └────────┬─────────┘         └────────────┘
                                   │
                                   ▼
                         ┌────────────────────┐
                         │ Permission gate    │
                         │  + canUseTool      │
                         │  + HITL banner     │
                         └────────────────────┘
```

---

## Quickstart

```bash
pnpm install
pnpm dev
```

That'll launch the Electron window with HMR. Six pillar surfaces in the left rail:

- **Home** — conversational composer; ad-hoc agent runs from natural-language prompts
- **Agents** — directory of `.md` / `.yaml` agents with Inspector + Source + Edit tabs
- **Tools** — every MCP / CLI / Skill / HTTP / Composio adapter, brand-iconized
- **Runs** — live React-Flow trace of every run, with HITL approval banners
- **Settings** — model picker (Claude Opus 4.7 → Haiku 4.5), provider, paths, telemetry
- **Settings → About** — version + stack

### Other commands

```bash
pnpm typecheck     # tsc across the whole workspace
pnpm build         # production builds
pnpm --filter @flowstate/desktop make    # package as platform installer
```

---

## What's wired today

| Capability | State | Notes |
|---|---|---|
| Agent file loader (`.md` + `.yaml`, with linked sections) | ✅ working | Browser-safe, Zod-validated, custom frontmatter splitter |
| Spec v1.0 with marketplace metadata | ✅ shipped | `specVersion`, `publisher`, `version`, `license`, `inputs`, `secrets`, `dependencies`, `guardrails` |
| Capability ontology (~80 tags / 14 domains) | ✅ shipped | `KNOWN_CAPABILITIES` set + `unknownCapabilities()` validator |
| ToolAdapter contract (7 kinds, 1 interface) | ✅ shipped | Full per-kind config types in `tool-adapter.ts` |
| Capability resolver (`needs:` → tool refs) | ✅ working | Pure function; UI shows resolved ✓ / unresolved ⚠ chips |
| Permission gate (network / fs / approvalRequired / bash allowlist) | ✅ enforced | Inside `canUseTool` before HITL |
| Real Claude Agent SDK execution | ✅ wired | `query()` in main process, falls back to mock if no auth |
| Human-in-the-loop approvals | ✅ working | SDK `canUseTool` → IPC → Cohere-purple approval banner → resume |
| CLI tool registry + bash regex gate | ✅ shipped | 15 starter commands across `gh` / `git` / `gcloud` / `stripe` / `kubectl` |
| In-app create / edit / save agent files | ✅ working | Form modal + CodeMirror edit + IPC writeAgentFile |
| Run history with React Flow visualization | ✅ working | Per-run trace with status colors + live ticker |
| MCP server pool + lifecycle | ✅ shipped | `mcp:*` refs resolve via `resolveMcpServers` → SDK MCP server config; system prompt advertises tools |
| MCP marketplace (search / install / uninstall) | ✅ shipped | Official + Glama registries, 6h cache, secrets in OS keychain |
| CLI marketplace (detect / install / authenticate) | ✅ shipped | 15-brand catalog with install + auth metadata, OS-shell launcher |
| Settings persistence to disk | ✅ shipped | `~/.flowstate/settings.json`, atomic write, Zod-validated read |
| SQLite-backed workspaces + title-bar switcher | ✅ shipped | Multi-workspace via `flowstate.db` (WAL); `agents_dir` / `runs_dir` / `tools_dir` per workspace |
| Conductor — intent-routing orchestrator | ✅ shipped | Home composer talks to a router agent that delegates to planner / installer / authenticator / agent-writer sub-agents |
| Home composer chat UI | ✅ shipped | Conductor thread, prompt cards, toasts |
| shadcn/ui primitives mapped onto Cohere tokens | ✅ shipped | `<Button>` ported across `btn-ghost` / `btn-dark` / `btn-outline` call sites |
| Per-run JSONL journals + SQLite run store | ⏳ M1 | Replace in-memory 100-run cap with durable storage |
| `~/.flowstate/agents/` live-reload watcher | ⏳ M1 | chokidar → IPC `agents:changed` |
| Webhook / cron / watch trigger listeners | ⏳ M2 | Turn agents into daemons; `manual` works today, the other four don't |
| `flowstate add github:publisher/agent` install | ⏳ M3 | Agent-side of the marketplace; MCP + CLI sides are already shipped |
| Run analytics (latency / cost / failure-rate / diff) | ⏳ M4 | Depends on M1's run store |

---

## The agent file format

Two surface forms — Markdown with YAML frontmatter, and pure YAML — both compile to the **same canonical AST** (defined in [`packages/core/src/schema.ts`](packages/core/src/schema.ts)). Full reference in [`SPEC.md`](SPEC.md).

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
  - cli:gh.pr.create

needs:
  - communication.email.send
  - payment.refund.create

inputs:
  order_id: { type: string, required: true }
  amount_cents: { type: integer, required: true }

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
  steps:
    - { title: Verify, body: { include: ./refund-handler/steps/01-verify.md } }
    - { title: Refund, body: { include: ./refund-handler/steps/02-refund.md } }
  rules:
    - { title: 30-day window, body: { include: ./refund-handler/rules/timing.md } }
  onFailure: { include: ./refund-handler/on-failure.md }
---
```

That single file is the runbook, the Claude system prompt, the permission contract, the audit log, and the marketplace listing. Same source, four jobs.

---

## The seven tool kinds

Tools are addressed as `provider:id.action`. Same `ToolAdapter` contract, seven transports:

| Kind | Source | Auth | Best for |
|---|---|---|---|
| `mcp` | Local MCP server (stdio or HTTP) | Per-server | Structured I/O, typed schemas |
| `cli` | `gh`, `gcloud`, `stripe`, `kubectl`, etc. | **Ambient** (your existing `gh auth login`) | Anything DevOps — zero integration tax |
| `http` | Direct REST/GraphQL | API key in keychain | One-off integrations |
| `composio` | Composio SaaS | Their managed OAuth | Long tail with annoying OAuth |
| `skill` | Markdown recipe (your own) | Inherited | Reusable procedures |
| `shell` | Custom script / built-in | Whatever the script needs | Company-specific logic |
| `sdk` | Native lib | API key | When type safety matters |

**Capability mode** (`needs:`) is the killer move: declare what the agent needs to *accomplish* (`communication.email.send`), and the resolver picks the best tool the user has installed at bind time. Same agent works for users with Gmail or Outlook, Stripe or Paddle.

---

## Claude Agent SDK guardrails

The `guardrails:` block in agent frontmatter maps directly to SDK options:

| `guardrails.permissionMode` | Behavior |
|---|---|
| `default` | Each tool call → `canUseTool` → HITL banner |
| `acceptEdits` | File edits auto-approve, other tools gate |
| `plan` | Agent only proposes — never executes any tool |
| `bypassPermissions` | All tools auto-approve (sandbox only) |

Plus `maxTurns`, `allowedTools`, `disallowedTools`, `effort` (`low | medium | high | xhigh | max | <int>`).

The runtime enforces a **two-layer permission gate** before any tool call:

```
1. checkPermissions(toolName, input, permissions, guardrails, bashAllowPatterns)
   → deny             : { behavior: 'deny', message }      // SDK gives up
   → requires_approval: route to HITL banner               // forced ask
   → allow            : continue to layer 2

2. permissionMode flow (default → HITL banner; bypass → auto-allow)
```

The same gate runs for the SDK's built-in tools (`Read`, `Write`, `Edit`, `Bash`, `WebFetch`) and any future MCP-backed tools.

---

## CLI tools = real shell access, safely

When an agent declares `tools: [cli:gh.pr.create, cli:git.status]`, two things happen:

1. **The system prompt** gets a `## Available shell commands` section listing each command with its template + inputs — Claude knows exactly what's available
2. **The bash gate** gets a regex allowlist — anything not matching one of the declared `cli:*` tool templates is denied with an actionable message

The starter registry in [`packages/core/src/cli-tools.ts`](packages/core/src/cli-tools.ts) ships 15 commands across `gh` / `git` / `gcloud` / `stripe` / `kubectl`. Community publishers extend it via `~/.flowstate/tools/cli/*.yaml` (loader follows in a later commit).

---

## Project structure

```
flow-state/
├── apps/
│   └── desktop/                       Electron 33 + React 18 + Vite 5 + Tailwind 4
│       ├── electron/
│       │   ├── main/index.ts          Window, IPC, agent runtime + permission gate wiring
│       │   ├── main/agent-runtime.ts  Claude Agent SDK query() wrapper
│       │   ├── main/agent-orchestrator.ts   Drives a single AgentRun lifecycle
│       │   ├── main/run-registry.ts   In-memory run store (M1 swaps for SQLite)
│       │   ├── main/workspace-db.ts   better-sqlite3 — workspaces + app_state tables
│       │   ├── main/paths.ts          ~/.flowstate path resolution (prod + dev)
│       │   ├── main/conductor/        Intent-routing orchestrator over the SDK
│       │   │   ├── runtime.ts         query() loop, tool dispatch, redaction
│       │   │   ├── server.ts          IPC server for conductor sessions
│       │   │   ├── sessions.ts        Per-thread session state
│       │   │   ├── system-prompt.ts   Router system prompt
│       │   │   ├── tools.ts           Built-in tools the router can call
│       │   │   ├── hooks.ts           Lifecycle hooks
│       │   │   ├── redaction.ts       Secret scrubbing on transcripts
│       │   │   └── subagents/         planner · installer · authenticator · agent-writer
│       │   └── preload/index.ts       Typed window.flowstate bridge
│       ├── src/
│       │   ├── App.tsx                Boot → Shell → view router
│       │   ├── agents/                Bundled example agents (.md + .yaml + nested folders)
│       │   ├── lib/
│       │   │   ├── agent-prompt.ts    assembleSystemPrompt + bashAllowPatternsFor
│       │   │   ├── sdk-runner.ts      Renderer → IPC adapter (with mock fallback)
│       │   │   ├── mock-runner.ts     Realistic-trace generator for offline demo
│       │   │   └── run-store.ts       useSyncExternalStore + HITL approvals
│       │   ├── components/
│       │   │   ├── splash/            Loading screen with purple hero band
│       │   │   ├── shell/             Title bar + workspace switcher + left rail nav
│       │   │   ├── home/              Conductor composer + thread + prompt cards
│       │   │   ├── agents/            Directory + Inspector + Source + Edit + Create modal
│       │   │   ├── tools/             Tool directory + MCP marketplace + CLI marketplace
│       │   │   ├── runs/              List + flow detail + approval banner
│       │   │   ├── settings/          Provider + ModelPicker + workspace + privacy
│       │   │   ├── prose/             Markdown renderer + CodeMirror editor + Prism
│       │   │   ├── ui/                shadcn/ui primitives (Button, etc.) on Cohere tokens
│       │   │   └── brand/             FlowstateMark + ClaudeMark
│       │   └── styles/globals.css     Cohere design tokens + shadcn semantic vars
│       └── DESIGN.md                  ← from `npx getdesign add cohere` + shadcn mapping
├── packages/
│   └── core/                          Shared spec + IR
│       └── src/
│           ├── schema.ts              Zod schemas — Agent v1.0 + Trigger + Permissions + Guardrails
│           ├── types/                 Agent · ToolManifest · AgentRun · RunStep · Workspace
│           ├── loader.ts              parseAgentMarkdown / parseAgentYaml / FileRegistry
│           ├── capabilities.ts        ~80-tag controlled vocabulary across 14 domains
│           ├── tool-adapter.ts        ToolAdapter interface + per-kind configs
│           ├── resolver.ts            resolveCapabilities + checkPermissions
│           ├── settings.ts            Settings schema + atomic read/write helpers
│           ├── cli-tools.ts           CliToolDef + STARTER_CLI_TOOLS + resolveCliTools
│           ├── cli-catalog.ts         CLI tool family catalog (15 brands, install + auth metadata)
│           ├── mcp-servers.ts         MCP server registry + resolveMcpServers
│           └── mcp-marketplace.ts     Official + Glama registry fetch / normalize / cache
├── SPEC.md                            The canonical agent + tool + guardrails contract
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Electron 33 + Node 20 | Local-first, OS integration, real CLI access |
| UI | React 18 + Vite 5 + TypeScript 5 (strict, `noUncheckedIndexedAccess`) | Fast HMR, strict types |
| Styling | Tailwind 4 (CSS-first `@theme`) | 10× faster than v3, no PostCSS dance |
| Design system | Cohere via `getdesign` | Pure white, Interaction Blue, 22px signature radius |
| Component primitives | `radix-ui` + shadcn/ui (mapped onto Cohere tokens) | Accessible primitives, project-owned variants |
| Fonts | Space Grotesk · Inter · JetBrains Mono | DESIGN.md-prescribed fallbacks |
| Brand icons | `simple-icons` (3.4k brand SVGs) | Real brand assets, tree-shaken |
| Flow viz | `@xyflow/react` (React Flow 12) | Customizable nodes, fast canvas |
| Editor | `@uiw/react-codemirror` + `@codemirror/lang-markdown` + `@codemirror/lang-yaml` | In-app editing of agent files |
| Markdown | `react-markdown` + `remark-gfm` | Beautiful agent body rendering |
| Highlighting | `prism-react-renderer` with custom Cohere theme | Source view + read-only inspector |
| Motion | `motion` (formerly framer-motion) | Spring physics, layout animation |
| Schema | `zod` 4 | Runtime validation + TS type inference |
| YAML | `yaml` (eemeli) | Spec-compliant, browser-safe |
| Local persistence | `better-sqlite3` (WAL) | Sync API, native perf, zero server |
| Agent runtime | `@anthropic-ai/claude-agent-sdk` | Claude Code subscription · API key · local LLM |

---

## Roadmap

**Done** — agent IR, design system, six views, real SDK execution with mock fallback, settings persistence, in-app create + edit + save, capability ontology v1, permission gate (network / fs / bash allowlist), HITL approvals (mock + real SDK), CLI tool registry + bash gate, spec v1.0, MCP server pool + lifecycle, MCP marketplace, CLI marketplace, SQLite-backed workspaces, Conductor intent-routing orchestrator, shadcn/ui primitives, [SPEC.md](SPEC.md).

**Path to v0.2** (in dependency order):

**M1 — Finish persistence.** Replace the in-memory 100-run cap with `runs` + `run_steps` tables in `flowstate.db`, append-only JSONL journals at `~/.flowstate/runs/<run-id>.jsonl`, and a chokidar watcher on `~/.flowstate/agents/` that pushes `agents:changed` to the renderer for live reload.

**M2 — Triggers fire.** New `electron/main/triggers/` module with `webhook.ts` (Fastify), `cron.ts` (node-cron + persisted catch-up), `watch.ts` (chokidar). Trigger registry hooks into agent save/delete; on app boot, hydrate all triggers from disk. `manual` already works; `event` ships as a stub for cross-agent events later.

**M3 — Agent marketplace.** `flowstate add github:publisher/agent` clones, validates against Spec v1.0, renders the SPEC.md §6 pre-install screen (permissions / capabilities / secrets / budget), writes to `~/.flowstate/agents/<publisher>/<id>/`. Third tab in the tools pane alongside MCP + CLI.

**M4 — Run analytics.** Now that runs live on disk: latency baselines by tool, cost trend by day, failure-rate ranking, p50/p95 durations. Per-step tokens + costUsd surface on React Flow nodes. Run diff viewer for two runs of the same agent.

**M5 — v0.2 release cut.** Bump versions, write CHANGELOG, refresh this table, drop the "wait for v0.2" license caveat, tag + GitHub release.

**Beyond v0.2** — multi-machine federation (control plane + runners), self-improving agents (every failure becomes a PR to its own `.md`), sub-agent orchestration via the SDK's AgentDefinition (the Conductor proves the pattern internally — opening it up to user-authored sub-agents is the next step).

---

## Design notes

The visual identity follows [`apps/desktop/DESIGN.md`](apps/desktop/DESIGN.md), generated by `npx getdesign add cohere`. Key signatures preserved from Cohere:

- Pure white canvas with cool gray hairline borders
- Cohere Black (`#000000`) for primary text, Near Black for body
- Interaction Blue (`#1863dc`) as the **sole** chromatic accent — hover/focus only
- Focus Purple (`#9b60aa`) for input focus borders (the composer turns purple when you click in)
- 22px signature card radius on every primary surface
- Almost shadow-free — depth from contrast and 1px borders
- Single body weight (400); size + spacing carry hierarchy
- Mono uppercase eyebrows with `0.18em` tracking for section markers
- Deep purple-violet hero bands for dramatic full-width sections (the splash)

What flowstate adds on top: the italic light `flow` + roman `state` wordmark, a sigmoid flow curve as the app icon, an editorial-magazine layout philosophy (asymmetric grids, marginalia, generous negative space), and Cohere-purple as the accent color for the HITL approval surface.

---

## License

MIT — but please wait for the v0.2 cut before depending on it. The spec is at v1.0 and stable; the runtime is still moving.
