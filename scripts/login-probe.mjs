#!/usr/bin/env node
// Does each agent's login STILL follow the variable we think it does?
//
// The account switcher (GH #278) rests on one table: `agent_dirs::login_store`
// says which environment variable relocates each agent's credential. That
// table is a set of MEASUREMENTS of other people's software, so it goes stale
// silently when an agent ships a change: the switcher keeps "working", every
// unit test keeps passing, and two accounts quietly share one login.
//
// This is the check that catches it. For each installed agent it points the
// measured variable at an EMPTY directory and asserts the CLI reports itself
// signed out. A CLI that still answers is one whose login no longer follows
// that variable.
//
// Local only, never CI, exactly like `make lsp-smoke`: it needs the real CLIs
// installed and really logged in, which no runner has. Run it when an agent
// updates, or when the switcher starts behaving oddly for one agent.
//
// NOTHING HERE READS A CREDENTIAL. It only observes whether the agent thinks
// it has one.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Mirrors `agent_dirs::login_store`. Kept in step by
 *  `the_probe_covers_every_agent_with_a_measured_store` in agent_dirs.rs,
 *  which fails when an agent gains a store and is not listed here. */
const AGENTS = [
  { id: "claude",   env: "CLAUDE_CONFIG_DIR", probe: ["auth", "status"],                   signedOut: /(?:"loggedIn":\s*false|not (?:signed|logged) in)/i },
  { id: "codex",    env: "CODEX_HOME",        probe: ["login", "status"],                  signedOut: /not (?:signed|logged) in|no credentials/i },
  { id: "copilot",  env: "COPILOT_HOME",      probe: ["--version"],                        signedOut: null, note: "no read-only auth probe; COPILOT_HOME is documented" },
  { id: "gemini",   env: "GEMINI_CLI_HOME",   probe: ["-p", "say OK"],                     signedOut: /auth|sign|login|credential/i },
  { id: "grok",     env: "GROK_HOME",         probe: ["-p", "say OK"],                     signedOut: /not signed in|grok login/i },
  // opencode PRINTS the store it resolved plus a count, so the count is the
  // signal: "0 credentials" under a relocated root means the login followed.
  { id: "opencode", env: "XDG_DATA_HOME",     probe: ["auth", "list"],                     signedOut: /\b0 credentials\b|no (?:credentials|providers)/i },
  { id: "pi",       env: "HOME",              probe: ["auth", "check", "--provider", "openai-codex", "--json"], signedOut: /credentials_not_configured|not_ready/i },
  { id: "muse",     env: "XDG_CONFIG_HOME",   probe: ["exec", "say OK"],                   signedOut: /missing .* credentials|muse login/i },
];

const TIMEOUT_MS = 45_000;

function have(bin) {
  try { execFileSync("command", ["-v", bin], { shell: true, stdio: "pipe" }); return true; }
  catch { return false; }
}

function run(bin, args, env) {
  try {
    return execFileSync(bin, args, {
      env: { ...process.env, ...env },
      timeout: TIMEOUT_MS, stdio: "pipe", encoding: "utf8",
    });
  } catch (e) {
    // A signed-out CLI usually exits non-zero and says so on stderr, which is
    // the answer rather than a failure to report.
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

const only = process.argv[2];
let checked = 0, drifted = 0, skipped = 0;

for (const a of AGENTS) {
  if (only && a.id !== only) continue;
  if (!have(a.id)) { console.log(`  –  ${a.id.padEnd(9)} not installed`); skipped++; continue; }
  if (!a.signedOut) { console.log(`  –  ${a.id.padEnd(9)} ${a.note}`); skipped++; continue; }

  const dir = mkdtempSync(join(tmpdir(), `termic-login-probe-${a.id}-`));
  try {
    const out = run(a.id, a.probe, { [a.env]: dir });
    checked++;
    if (a.signedOut.test(out)) {
      console.log(`  ok ${a.id.padEnd(9)} login follows ${a.env}`);
    } else {
      drifted++;
      console.log(`  DRIFT ${a.id.padEnd(6)} still answered with ${a.env} pointed at an empty dir.`);
      console.log(`         Its login no longer follows that variable, so agent_dirs::login_store`);
      console.log(`         is stale and two "accounts" would share one credential.`);
      console.log(`         Re-measure, then update the row. Output was:`);
      console.log(out.split("\n").slice(0, 4).map(l => `           ${l}`).join("\n"));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${checked} probed, ${drifted} drifted, ${skipped} skipped.`);
process.exit(drifted === 0 ? 0 : 1);
