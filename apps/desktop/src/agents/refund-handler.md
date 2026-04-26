---
id: refund-handler
name: Refund handler
description: Process customer refund requests within the 30-day window.

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
---

## Goal

When a refund request lands at `/refund`, verify the order is within the
30-day window, issue the refund through Stripe, email the customer
confirmation, and post a record to `#ops-billing`.

## Steps

### 1. Verify the request
Pull the order ID from the webhook payload. Look up the order in Stripe and
check the purchase date. If older than 30 days, reply `{ status: "denied",
reason: "outside refund window" }` and stop.

### 2. Issue the refund
Refund the original payment intent in full. Use `reason: customer_request`.

### 3. Notify the customer
Send a confirmation email summarizing the refund amount, the original order,
and expected funds-availability window (5–10 business days).

### 4. Post to ops
Drop a single line into `#ops-billing` with the customer name, amount, and
the Stripe refund ID.

## On failure

If Stripe rejects the refund (insufficient balance, dispute already filed,
etc.), do **not** retry automatically. Escalate to `#ops-billing` with the
full Stripe error and the original request payload.
