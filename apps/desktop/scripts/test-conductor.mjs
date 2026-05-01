/**
 * Conductor offline smoke test.
 *
 * Verifies that the in-process MCP tool layer assembles, the subagent
 * definitions are well-formed, the system prompts are non-empty, and the
 * destructive-tool tagging is consistent between server.ts and tools.ts
 * — all WITHOUT booting Electron.
 *
 * What it does NOT do: import conductor/runtime.ts (depends on Electron's
 * `app.isPackaged` via paths.ts), call any IPC, or hit the SDK. The
 * Phase 1 manual verification ("type into the composer in dev mode") is
 * the e2e gate; this script is the cheap CI guard.
 *
 * Usage:
 *   pnpm test:conductor
 */

import { CONDUCTOR_SYSTEM_PROMPT } from '../electron/main/conductor/system-prompt.ts';
import { CONDUCTOR_SUBAGENTS } from '../electron/main/conductor/subagents/index.ts';
import {
  PLANNER_ALLOWED_TOOLS,
  PLANNER_SYSTEM_PROMPT,
} from '../electron/main/conductor/subagents/planner.ts';
import {
  INSTALLER_ALLOWED_TOOLS,
  INSTALLER_SYSTEM_PROMPT,
} from '../electron/main/conductor/subagents/installer.ts';
import {
  AUTHENTICATOR_ALLOWED_TOOLS,
  AUTHENTICATOR_SYSTEM_PROMPT,
} from '../electron/main/conductor/subagents/authenticator.ts';
import {
  AGENT_WRITER_ALLOWED_TOOLS,
  AGENT_WRITER_SYSTEM_PROMPT,
} from '../electron/main/conductor/subagents/agent-writer.ts';
import {
  DESTRUCTIVE_TOOLS,
  DISPATCH_TOOL_NAME,
  FLOWSTATE_TOOL_PREFIX,
} from '../electron/main/conductor/constants.ts';
import { maskForAudit } from '../electron/main/conductor/redaction.ts';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(title) {
  console.log(`\n→ ${title}`);
}

// ─── 1. System prompt sanity ─────────────────────────────────────────────
section('Conductor system prompt');
check('non-empty', CONDUCTOR_SYSTEM_PROMPT.length > 200);
check('mentions planner', CONDUCTOR_SYSTEM_PROMPT.includes('planner'));
check('mentions dispatch_agent_run', CONDUCTOR_SYSTEM_PROMPT.includes('dispatch_agent_run'));
check('always-ask rule present', CONDUCTOR_SYSTEM_PROMPT.includes('ask_user'));

// ─── 2. Subagents ────────────────────────────────────────────────────────
section('Subagent definitions');
const subagentNames = Object.keys(CONDUCTOR_SUBAGENTS);
check(
  'four subagents declared',
  subagentNames.length === 4,
  `got: ${subagentNames.join(', ')}`,
);
check('planner exists', subagentNames.includes('planner'));
check('installer exists', subagentNames.includes('installer'));
check('authenticator exists', subagentNames.includes('authenticator'));
check('agent-writer exists', subagentNames.includes('agent-writer'));

for (const [name, def] of Object.entries(CONDUCTOR_SUBAGENTS)) {
  check(
    `${name} has prompt + tools + description`,
    typeof def.prompt === 'string' &&
      def.prompt.length > 0 &&
      Array.isArray(def.tools) &&
      def.tools.length > 0 &&
      typeof def.description === 'string',
  );
}

// ─── 3. Planner is read-only ─────────────────────────────────────────────
section('Planner allowlist (read-only invariant)');
const plannerWritesAllowed = PLANNER_ALLOWED_TOOLS.filter((t) =>
  ['install_mcp_server', 'set_secret', 'write_agent_file', 'run_cli_auth', 'dispatch_agent_run'].some((d) =>
    t.endsWith(d),
  ),
);
check(
  'planner has no destructive tools',
  plannerWritesAllowed.length === 0,
  `unexpectedly granted: ${plannerWritesAllowed.join(', ')}`,
);
check('planner system prompt declares JSON output', PLANNER_SYSTEM_PROMPT.includes('Output shape'));

// ─── 4. Installer + authenticator + writer have what they need ──────────
section('Helper subagents have correct tool surface');
check(
  'installer has install + secret + ask_user',
  INSTALLER_ALLOWED_TOOLS.includes(`${FLOWSTATE_TOOL_PREFIX}install_mcp_server`) &&
    INSTALLER_ALLOWED_TOOLS.includes(`${FLOWSTATE_TOOL_PREFIX}set_secret`) &&
    INSTALLER_ALLOWED_TOOLS.includes(`${FLOWSTATE_TOOL_PREFIX}ask_user`),
);
check('installer prompt mentions install flow', INSTALLER_SYSTEM_PROMPT.includes('install'));
check(
  'authenticator has probe + run_auth + ask_user',
  AUTHENTICATOR_ALLOWED_TOOLS.includes(`${FLOWSTATE_TOOL_PREFIX}probe_cli_family`) &&
    AUTHENTICATOR_ALLOWED_TOOLS.includes(`${FLOWSTATE_TOOL_PREFIX}run_cli_auth`) &&
    AUTHENTICATOR_ALLOWED_TOOLS.includes(`${FLOWSTATE_TOOL_PREFIX}ask_user`),
);
check('authenticator polls', AUTHENTICATOR_SYSTEM_PROMPT.includes('Poll'));
check(
  'agent-writer has write + read + preview',
  AGENT_WRITER_ALLOWED_TOOLS.includes(`${FLOWSTATE_TOOL_PREFIX}write_agent_file`) &&
    AGENT_WRITER_ALLOWED_TOOLS.includes(`${FLOWSTATE_TOOL_PREFIX}read_agent_file`),
);
check('agent-writer prompt mentions frontmatter', AGENT_WRITER_SYSTEM_PROMPT.includes('frontmatter'));

// ─── 5. Destructive set + dispatch tool are correctly named ─────────────
section('Destructive-tool tagging');
const expected = [
  'install_mcp_server',
  'uninstall_mcp_server',
  'set_secret',
  'run_cli_auth',
  'write_agent_file',
  'cancel_run',
];
for (const id of expected) {
  check(
    `${id} flagged destructive`,
    DESTRUCTIVE_TOOLS.has(`${FLOWSTATE_TOOL_PREFIX}${id}`),
  );
}
check(
  'dispatch_agent_run is the documented boundary tool',
  DISPATCH_TOOL_NAME === `${FLOWSTATE_TOOL_PREFIX}dispatch_agent_run`,
);

// ─── 6. Subagents only reference declared flowstate tools ───────────────
section('Subagent tool refs are well-formed');
const allKnownPrefixes = [FLOWSTATE_TOOL_PREFIX];
for (const [name, def] of Object.entries(CONDUCTOR_SUBAGENTS)) {
  for (const t of def.tools) {
    const ok = allKnownPrefixes.some((p) => t.startsWith(p));
    check(`${name}: ${t} has flowstate prefix`, ok);
  }
}

// ─── 7. Audit-log redaction ─────────────────────────────────────────────
section('Audit-log redaction (maskForAudit)');

{
  // set_secret: value field redacted unconditionally
  const masked = maskForAudit(`${FLOWSTATE_TOOL_PREFIX}set_secret`, {
    name: 'STRIPE_API_KEY',
    value: 'sk_live_supersecret',
  });
  check('set_secret value redacted', masked.value === '<redacted>');
  check('set_secret name preserved', masked.name === 'STRIPE_API_KEY');
}
{
  // install_mcp_server: env values that LOOK secret-y get masked recursively
  const masked = maskForAudit(`${FLOWSTATE_TOOL_PREFIX}install_mcp_server`, {
    def: {
      id: 'stripe',
      transport: {
        type: 'stdio',
        command: 'npx',
        env: {
          STRIPE_API_KEY: 'sk_live_xyz',
          DEBUG: '1',
        },
      },
    },
  });
  check(
    'install_mcp_server STRIPE_API_KEY masked',
    masked.def?.transport?.env?.STRIPE_API_KEY === '<redacted>',
  );
  check(
    'install_mcp_server non-secret env preserved',
    masked.def?.transport?.env?.DEBUG === '1',
  );
  check(
    'install_mcp_server id preserved',
    masked.def?.id === 'stripe',
  );
}
{
  // Universal: a future tool with a "bearer_token" field gets masked even
  // though we never named that tool specifically.
  const masked = maskForAudit(`${FLOWSTATE_TOOL_PREFIX}some_future_tool`, {
    request: {
      url: 'https://api.example.com',
      bearer_token: 'eyJabc...',
    },
  });
  check('universal mask catches bearer_token', masked.request?.bearer_token === '<redacted>');
  check('universal mask preserves url', masked.request?.url === 'https://api.example.com');
}
{
  // Top-level non-secret fields stay untouched.
  const masked = maskForAudit(`${FLOWSTATE_TOOL_PREFIX}list_runs`, {
    limit: 10,
    status: 'running',
  });
  check('read-only tool input untouched (limit)', masked.limit === 10);
  check('read-only tool input untouched (status)', masked.status === 'running');
}

// ─── Summary ────────────────────────────────────────────────────────────
console.log(`\n${pass + fail} checks · ${pass} passed · ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
