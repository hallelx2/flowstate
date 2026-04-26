---
id: customer-onboarding
name: Onboard a new customer
description: A reusable skill — verifies the customer, provisions their workspace, and kicks off the welcome series.

# No trigger config means this is callable as a sub-skill from other agents.
trigger:
  kind: manual

# This skill declares CAPABILITIES, not specific tools — the resolver picks
# the best available tool per capability at bind time. Same skill works
# whether the user has Gmail or Outlook, Stripe or Paddle, etc.
tools: []

needs:
  - payment.customer.verify
  - workspace.provision
  - communication.email.send
  - note.page.create

budget:
  tokens: 40000
  usd: 0.30
---

## Goal

Take a new signup all the way from "they paid" to "they're inside the product
and have received the welcome email."

## Steps

### 1. Verify the customer
Confirm the payment cleared and the customer email is reachable. If the
payment is in `pending` status, wait up to 10 minutes; otherwise escalate.

### 2. Provision their workspace
Create the workspace, generate the initial API key, and add the user as the
sole admin. Tag the workspace with the plan name so billing reconciles
correctly.

### 3. Send welcome email
Use the welcome template. Personalize with the user's first name and the
plan they bought. Include their workspace URL and the quick-start guide link.

### 4. Note their preferences
If they answered the optional survey at checkout, write the answers to their
profile in the CRM as searchable tags.

## Composability

This skill is callable from any agent — pass the customer ID as input,
get a workspace URL back. It's the building block other onboarding flows
(enterprise tier, free trial, etc.) wrap with their own logic.
