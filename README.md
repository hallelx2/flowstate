# flowstate

> Talk to your agents like you talk to a person.

flowstate is a **markdown-driven process automation system**. Define agents in plain `.md` or `.yaml` files, give them tools (CLIs, MCP servers, skills, HTTP APIs, Composio integrations), and watch them work — with full visibility into every step they take.

It's the n8n alternative for people who'd rather write a runbook than wire a node graph.

---

## Why it exists

Most agent platforms feel like programming environments dressed up with chat. flowstate inverts that:

- **Conversation is the surface.** You describe the work the way you'd describe it to a teammate.
- **Markdown is the source of truth.** Processes are literate documents — readable, diffable, git-native.
- **The visual flow is the proof.** Every tool call, every decision, every retry — laid out spatially so nothing happens behind your back.
- **Tools come from where they already live.** Your authenticated CLIs (`gcloud`, `gh`, `stripe`, `kubectl`), MCP servers, and skills you've written — flowstate finds them and binds them at runtime.
- **Local-first.** Your data stays on your machine. The runtime uses the Claude Agent SDK with whatever credentials you already have (Claude subscription, Anthropic API key, or local LLM).

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Desktop client                       │
│              Electron · React · Tailwind 4               │
│                                                          │
│   Splash → Home → Agents → Tools → Flow                  │
│                                                          │
└────────────────────────┬─────────────────────────────────┘
                         │
              ┌──────────▼───────────┐
              │  Agent loader (core) │  .md / .yaml → Agent IR
              │  Zod-validated AST   │  one schema, two source forms
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  Tool registry       │  MCP · CLI · Skill · HTTP
              │  + capability index  │  · Composio · Shell · SDK
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  Claude Agent SDK    │  picks tools at bind time
              │  + run telemetry     │  emits steps to the Flow view
              └──────────────────────┘
```

---

## Quickstart

```bash
pnpm install
pnpm dev
```

That'll launch the Electron window with HMR. Open the **Agents** tab to see the four example agents bundled in `apps/desktop/src/agents/`, switch to **Tools** for the directory of integrations, **Flow** for the spatial trace of a sample run.

### Other commands

```bash
pnpm typecheck     # tsc across the whole workspace
pnpm build         # production builds
pnpm --filter @flowstate/desktop make    # package as platform installer
```

---

## The agent file format

Two surface forms — Markdown with YAML frontmatter, and pure YAML — both compile to the **same canonical AST** (defined in `packages/core/src/schema.ts`).

### Markdown (`.md`)

```markdown
---
id: refund-handler
name: Refund handler
description: Process customer refund requests within the 30-day window.

trigger:
  kind: webhook
  config: { path: /refund, method: POST }

tools:
  - mcp:stripe.refunds.create
  - mcp:gmail.messages.send
  - composio:slack.chat.post

needs:
  - communication.email.send
  - payment.refund.create

budget: { tokens: 50000, usd: 0.50 }

permissions:
  network: [api.stripe.com, gmail.googleapis.com]
  env: [STRIPE_API_KEY, GMAIL_TOKEN]
---

## Goal
When a refund request lands at `/refund`, verify the order is within
the 30-day window, refund through Stripe, and email the customer.

## Steps
### 1. Verify the request
…
```

### YAML (`.yaml`)

```yaml
id: inbox-triage
name: Inbox triage
description: Sort the unread morning email and draft replies.

trigger: { kind: manual }

tools:
  - mcp:gmail.messages.search
  - mcp:gmail.drafts.create

needs:
  - communication.email.read
  - communication.email.draft

budget: { tokens: 30000, usd: 0.20 }

goal: |
  Read every unread email from the last 24 hours.
  Categorize, label, draft replies for the easy ones.
```

### Schema fields

| Field | Required | Description |
|---|---|---|
| `id` | ✓ | kebab-case unique identifier |
| `name` | ✓ | Human-readable name |
| `description` | | One-line summary |
| `trigger` | ✓ | Discriminated by `kind`: `manual` · `webhook` · `cron` · `watch` · `event` |
| `tools` | | Explicit tool refs (`provider:id` — see Tool system) |
| `needs` | | Capability tags (e.g. `communication.email.send`) — runtime resolves to tools |
| `budget` | | Hard caps: `tokens`, `usd`, `runtimeMs` |
| `permissions` | | Default-deny: `network[]`, `fs.{read,write}[]`, `env[]` |

The body (markdown after the frontmatter, or YAML's `goal:` field) is the prose the agent works from.

---

## The tool system

Seven kinds of tools, one declaration format:

| Kind | Source | Auth model | When to use |
|---|---|---|---|
| `mcp` | Local MCP server | Per-server | Structured I/O, typed schemas |
| `cli` | `gcloud`, `gh`, `stripe`, `kubectl`, etc. | Ambient (your CLI auth) | Anything DevOps — zero integration tax |
| `http` | Direct REST/GraphQL | API key | One-off integrations |
| `composio` | Composio SaaS | They handle OAuth | Long tail, OAuth dance |
| `skill` | Markdown recipe (your own) | Inherited | Reusable procedures |
| `shell` | Custom script / built-in | Whatever the script needs | Company-specific logic |
| `sdk` | Native lib | API key | When type-safety matters |

Tools are addressed as `provider:id` — `mcp:gmail.send`, `cli:gcloud.run.deploy`, `skill:notify-ops`.

Capability mode (`needs:`) is the killer move: declare what the agent needs to *accomplish* (`communication.email.send`), and the resolver picks the best tool the user has installed at bind time. Same agent works for users with Gmail or Outlook, Stripe or Paddle.

---

## Project structure

```
flow-state/
├── apps/
│   └── desktop/                    Electron + React + Vite + Tailwind 4
│       ├── electron/
│       │   ├── main/index.ts       Main process (window, IPC, titlebar)
│       │   └── preload/index.ts    Typed window.flowstate bridge
│       ├── src/
│       │   ├── App.tsx             Boot → Shell → view router
│       │   ├── agents/             Bundled example agents (.md + .yaml)
│       │   ├── components/
│       │   │   ├── splash/         Loading screen with purple hero band
│       │   │   ├── shell/          Titlebar + left rail nav
│       │   │   ├── home/           Conversation entry surface
│       │   │   ├── agents/         Agent directory with parsed/source views
│       │   │   ├── tools/          Tool directory with brand SVGs
│       │   │   └── flow/           React Flow visualization
│       │   └── styles/globals.css  Cohere design tokens (CSS-first @theme)
│       └── DESIGN.md               ← from `npx getdesign add cohere`
├── packages/
│   └── core/                       Shared agent IR
│       └── src/
│           ├── schema.ts           Zod schemas for the agent format
│           ├── loader.ts           parseAgentMarkdown / parseAgentYaml
│           └── types/              Agent · ToolManifest · AgentRun
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Electron 33 + Node 20 | Local-first, OS integration |
| UI | React 18 + Vite 5 + TypeScript 5 | Fast HMR, strict types |
| Styling | Tailwind 4 (CSS-first `@theme`) | 10× faster than v3, no PostCSS dance |
| Design system | Cohere via `getdesign` | Pure white, Interaction Blue, 22px signature radius |
| Fonts | Space Grotesk · Inter · JetBrains Mono | DESIGN.md-prescribed fallbacks |
| Brand icons | `simple-icons` (3.4k brand SVGs) | Real brand assets, tree-shaken |
| Flow viz | `@xyflow/react` (React Flow 12) | Customizable nodes, fast canvas |
| Motion | `motion` (formerly framer-motion) | Spring physics, layout animation |
| Schema | `zod` | Runtime validation + TS type inference |
| YAML | `yaml` (eemeli) | Spec-compliant, browser-safe |
| Agent runtime | Claude Agent SDK | Subscription · API key · local LLM |

---

## Roadmap

What's shipping now is the **scaffold**: the design system, the agent file format, the loaders, and the four pillar views. Next:

1. **Wire the composer to the Claude Agent SDK** — the home-view `start` button currently does nothing
2. **Tool registry loader** — read `.agent/tools/**/*.{md,yaml}` from disk instead of fixtures
3. **Live RunStep streaming** — pipe runtime events into the Flow view so the canvas paints as the agent works
4. **Capability resolver** — RAG over the registry for the `needs:` declaration mode
5. **Hosted runner pattern** — local execution + cloud control plane (think GitHub Actions self-hosted runners)

---

## Design notes

The visual identity follows `apps/desktop/DESIGN.md`, generated by `npx getdesign add cohere`. Key signatures preserved from Cohere:

- Pure white canvas with cool gray hairline borders
- Cohere Black (`#000000`) for primary text, Near Black for body
- Interaction Blue (`#1863dc`) as the **sole** chromatic accent — hover/focus only
- Focus Purple (`#9b60aa`) for input focus borders
- 22px signature card radius on every primary surface
- Almost shadow-free — depth from contrast and 1px borders
- Single body weight (400); size + spacing carry hierarchy
- Mono uppercase eyebrows with `0.18em` tracking for section markers
- Deep purple-violet hero bands for dramatic full-width sections (e.g. the splash)

What flowstate adds on top: the italic light `flow` + roman `state` wordmark, and the editorial-magazine layout philosophy (asymmetric grids, marginalia, generous negative space).

---

## License

TBD — currently private.
