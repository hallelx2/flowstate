/**
 * The flowstate Agent file format.
 *
 * Two surface forms — Markdown with YAML frontmatter, and pure YAML —
 * both compile to the same canonical AST defined here.
 *
 * This is the contract every loader, validator, runtime, and UI consumes.
 */

import { z } from 'zod';

// ─── Trigger ──────────────────────────────────────────────────────────────
// Discriminated union — runtime can pattern-match on `kind`.

export const TriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual') }),
  z.object({
    kind: z.literal('webhook'),
    config: z
      .object({
        path: z.string().regex(/^\//, 'Webhook path must start with /'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal('cron'),
    config: z.object({
      schedule: z.string().min(1),
      timezone: z.string().optional(),
    }),
  }),
  z.object({
    kind: z.literal('watch'),
    config: z.object({
      source: z.string().min(1), // e.g. "fs:./inbox", "drive:folder/abc"
    }),
  }),
  z.object({
    kind: z.literal('event'),
    config: z.object({ name: z.string().min(1) }),
  }),
]);

// ─── Budget ───────────────────────────────────────────────────────────────
// Hard caps. Runtime kills the agent at the limit.

export const BudgetSchema = z.object({
  tokens: z.number().int().positive().optional(),
  usd: z.number().positive().optional(),
  runtimeMs: z.number().int().positive().optional(),
});

// ─── Permissions ──────────────────────────────────────────────────────────
// Runtime enforces these at tool-resolution time. Default-deny.

export const PermissionsSchema = z.object({
  network: z.array(z.string()).optional(),
  fs: z
    .object({
      read: z.array(z.string()).optional(),
      write: z.array(z.string()).optional(),
    })
    .optional(),
  env: z.array(z.string()).optional(),
});

// ─── Tool reference ───────────────────────────────────────────────────────
// `provider:id` — e.g. `mcp:gmail.send`, `cli:gcloud.run.deploy`, `skill:notify`.

const TOOL_REF_RE = /^(mcp|cli|http|composio|skill|shell|sdk):[a-z0-9_.-]+$/i;
export const ToolRefSchema = z.string().regex(TOOL_REF_RE, 'Expected `provider:id` format');

// ─── Capability tag ───────────────────────────────────────────────────────
// Dotted path — e.g. `communication.email.send`, `payment.refund.create`.

const CAPABILITY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
export const CapabilitySchema = z.string().regex(CAPABILITY_RE, 'Expected dotted capability path');

// ─── Agent metadata ───────────────────────────────────────────────────────
// What lives in YAML frontmatter (md) or at the top level (yaml).

export const AgentMetaSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, 'id must be kebab-case (lowercase + dashes)'),
  name: z.string().min(1),
  description: z.string().optional(),

  trigger: TriggerSchema,

  /** Explicit tool references (deterministic) */
  tools: z.array(ToolRefSchema).default([]),
  /** Capability tags — resolver picks tools at bind time (semantic) */
  needs: z.array(CapabilitySchema).optional(),

  budget: BudgetSchema.optional(),
  permissions: PermissionsSchema.optional(),
});

export type AgentMeta = z.infer<typeof AgentMetaSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type Budget = z.infer<typeof BudgetSchema>;
export type Permissions = z.infer<typeof PermissionsSchema>;
