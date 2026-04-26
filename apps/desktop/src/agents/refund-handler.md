---
specVersion: "1.0"
id: refund-handler
name: Refund handler
description: Process customer refund requests within the 30-day window.

# ─── Marketplace metadata (required to publish) ───
publisher: flowstate-examples
version: 1.0.0
license: MIT
repository: github:flowstate/examples
tags: [stripe, refunds, billing, hitl]

trigger:
  kind: webhook
  config:
    path: /refund
    method: POST

tools:
  - mcp:stripe.customers.retrieve
  - mcp:stripe.charges.list
  - mcp:stripe.refunds.create
  - mcp:gmail.messages.send
  - composio:slack.chat.post

needs:
  - communication.email.send
  - communication.chat.post
  - payment.refund.create

# ─── Typed input contract ───
inputs:
  order_id:
    type: string
    required: true
    description: The Stripe order id from the webhook payload.
  reason:
    type: string
    required: true
    description: Customer-supplied reason for the refund.

# ─── Secrets the agent reads (keychain or env) ───
secrets:
  - STRIPE_API_KEY
  - GMAIL_TOKEN

budget:
  tokens: 50000
  usd: 0.50
  runtimeMs: 300000

permissions:
  network:
    - api.stripe.com
    - gmail.googleapis.com
    - slack.com
  env:
    - STRIPE_API_KEY
    - GMAIL_TOKEN
  # Tool refs that ALWAYS pause for human approval — surfaces in the
  # marketplace install screen + the run-time HITL banner.
  approvalRequired:
    - mcp:stripe.refunds.create

# ─── Claude Agent SDK guardrails ───
guardrails:
  permissionMode: default       # default | acceptEdits | plan | bypassPermissions
  maxTurns: 30
  effort: medium

# ─── Linked sections ──────────────────────────────────────────────────────
# Each section either inlines its body or includes an external markdown file
# from the ./refund-handler/ directory. The loader resolves these into the
# canonical AST — the runtime sees one fully-inlined Agent.

sections:
  goal:
    include: ./refund-handler/goal.md

  rules:
    - title: 30-day window
      body: { include: ./refund-handler/rules/timing-window.md }
    - title: Stripe API usage
      appliesTo: [mcp:stripe.refunds.create, mcp:stripe.charges.list]
      body: { include: ./refund-handler/rules/stripe-usage.md }

  steps:
    - id: verify
      title: Verify the request
      body: { include: ./refund-handler/steps/01-verify.md }
    - id: refund
      title: Issue the refund
      body: { include: ./refund-handler/steps/02-refund.md }
    - id: notify-customer
      title: Email the customer
      body: { include: ./refund-handler/steps/03-notify-customer.md }
    - id: notify-ops
      title: Post to ops
      body: { include: ./refund-handler/steps/04-notify-ops.md }

  onFailure:
    include: ./refund-handler/on-failure.md
---

This agent shows the **nested file structure** in action: the master file
holds metadata + section references, while each step, rule, and the goal
itself live in their own focused markdown files under `./refund-handler/`.

The runtime sees a single fully-inlined agent. The UI shows you the file
tree so you can navigate the source.
