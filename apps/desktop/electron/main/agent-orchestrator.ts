/**
 * Backend orchestration for agent runs.
 *
 * Pure-ish translation layer between the renderer's RunRequest contract
 * (carrying agent IR fields) and the SDK's query() options. All disk +
 * keychain reads happen here in the main process — the renderer never
 * sees decrypted secret values.
 *
 * Why split this out from index.ts?
 *   1. Testability — these helpers are unit-testable without booting Electron.
 *   2. Separation — index.ts is wire/IPC plumbing; the orchestration logic
 *      that builds an SDK config from agent declarations belongs here.
 */

import { safeStorage } from 'electron';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  STARTER_MCP_SERVERS,
  resolveCliTools,
  resolveMcpServers,
  type Budget,
  type Guardrails,
  type McpServerDef,
  type Permissions,
  type SdkMcpServerConfig,
} from '@flowstate/core';
import { installedMcpDir, secretsPath } from './paths';

// ─── Secrets keychain helpers ────────────────────────────────────────────

type SecretsFile = Record<string, string>;

async function readSecretsFile(): Promise<SecretsFile> {
  const path = secretsPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, 'utf8')) as SecretsFile;
  } catch {
    return {};
  }
}

/**
 * Decrypt one secret by NAME — returns the plaintext value or undefined
 * when the secret isn't set or can't be decrypted on this machine.
 *
 * The on-disk shape is `enc:<b64>` (safeStorage cipher) or `plain:<b64>`
 * (fallback for OSes without keychain support).
 */
export async function decryptSecret(name: string): Promise<string | undefined> {
  const file = await readSecretsFile();
  const stored = file[name];
  if (!stored) return undefined;
  if (stored.startsWith('enc:')) {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn(`[secrets] secret "${name}" is encrypted but encryption is unavailable`);
      return undefined;
    }
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    } catch (err) {
      console.warn(`[secrets] failed to decrypt "${name}"`, err);
      return undefined;
    }
  }
  if (stored.startsWith('plain:')) {
    return Buffer.from(stored.slice(6), 'base64').toString('utf8');
  }
  return undefined;
}

/** Read the user's stored Anthropic API key (or undefined if absent). */
export async function readApiKey(): Promise<string | undefined> {
  return decryptSecret('ANTHROPIC_API_KEY');
}

// ─── MCP installed-defs registry ─────────────────────────────────────────

/**
 * Load every MCP server definition the user has installed, merged with
 * the curated starter list. Installed defs win on id conflict.
 */
export async function loadInstalledMcpDefs(): Promise<McpServerDef[]> {
  const dir = installedMcpDir();
  const installed: McpServerDef[] = [];
  if (existsSync(dir)) {
    const entries = await readdir(dir);
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(dir, name), 'utf8');
        installed.push(JSON.parse(raw) as McpServerDef);
      } catch (err) {
        console.warn('[orchestrator] skipping malformed install', name, err);
      }
    }
  }
  const seen = new Set<string>();
  const merged: McpServerDef[] = [];
  for (const def of [...installed, ...STARTER_MCP_SERVERS]) {
    if (seen.has(def.id)) continue;
    seen.add(def.id);
    merged.push(def);
  }
  return merged;
}

// ─── Agent → SDK config translation ──────────────────────────────────────

/**
 * Resolve the agent's `tools: [mcp:*]` refs against the installed
 * registry and inject decrypted secrets into each server's `env`.
 *
 * Returns the SDK-shaped mcpServers map ready to pass to query().
 *
 * Secret injection: for each server's declared envVars, if a secret with
 * the same name exists, decrypt it and merge it into the server's env.
 * Existing static env entries (e.g. defaults the user typed in) are
 * preserved — secrets only fill in missing keys, so users can override
 * a stored secret per-install if needed.
 */
export async function resolveAgentMcpServers(
  agentTools: string[],
): Promise<{
  sdkServers: Record<string, SdkMcpServerConfig>;
  unresolved: string[];
  requiredEnvVars: string[];
  missingSecrets: string[];
}> {
  const registry = await loadInstalledMcpDefs();
  const resolution = resolveMcpServers(agentTools, registry);

  const out: Record<string, SdkMcpServerConfig> = {};
  const missingSecrets: string[] = [];

  for (const [id, base] of Object.entries(resolution.sdkServers)) {
    if ('command' in base) {
      // stdio transport — inject env from keychain
      const def = registry.find((d) => d.id === id);
      const env: Record<string, string> = { ...(base.env ?? {}) };
      for (const name of def?.envVars ?? []) {
        if (env[name] != null) continue; // user override wins
        const v = await decryptSecret(name);
        if (v != null) env[name] = v;
        else missingSecrets.push(`${id}:${name}`);
      }
      out[id] = Object.keys(env).length > 0 ? { ...base, env } : base;
    } else {
      // http/sse — secrets go into headers via separate keychain mapping
      // (deferred — most http MCP servers use bearer tokens via headers
      // already supplied at install time)
      out[id] = base;
    }
  }

  return {
    sdkServers: out,
    unresolved: resolution.unresolved,
    requiredEnvVars: resolution.requiredEnvVars,
    missingSecrets,
  };
}

/** Bash command allowlist derived from the agent's `cli:*` tool refs. */
export function bashAllowPatternsFromTools(agentTools: string[]): string[] {
  return resolveCliTools(agentTools).bashAllowPatterns;
}

// ─── IPC contract ────────────────────────────────────────────────────────

/**
 * The slimmed-down request shape the renderer sends to `agent:run`.
 *
 * Compared to the previous contract: the renderer no longer ships
 * `mcpServers` (would require decrypted secrets in the renderer) or
 * `bashAllowPatterns` (deterministic from `agentTools`). Main derives
 * them from `agentTools` + the keychain.
 */
export interface RunAgentRequest {
  runId: string;
  prompt: string;
  agentSystemPrompt?: string;
  cwd?: string;
  model?: string;
  /** Agent's declared tool refs (`mcp:*`, `cli:*`). Drives MCP + bash resolution. */
  agentTools?: string[];
  /** Built-in SDK tools the renderer wants to allow alongside agent tools. */
  allowedTools?: string[];
  permissions?: Permissions;
  guardrails?: Guardrails;
  budget?: Budget;
}
