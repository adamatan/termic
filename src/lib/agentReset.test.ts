// Resetting an agent must not destroy the user's credential sets (GH #278).
//
// The rules live in AgentsSection (`carriedOver` / `isModified`); this file
// pins them as functions, because getting them wrong deletes data that names
// real login directories and the failure is silent: the accounts simply stop
// being there.

import { describe, it, expect } from "vitest";
import type { Agent } from "@/lib/types";

const base = (over: Partial<Agent> = {}): Agent => ({
  id: "claude", display_name: "claude", command: "claude", args: [],
  icon_id: "claude", color: "#d97757", builtin: true, ...over,
});

/** What a reset carries across, mirroring AgentsSection.carriedOver. */
const carriedOver = (a: Agent): Partial<Agent> => ({
  env: a.env ?? {},
  accounts: a.accounts,
  default_account: a.default_account,
  adopted_account: a.adopted_account,
  auto_switch_account: a.auto_switch_account,
});

/** What "modified" ignores, mirroring AgentsSection.isModified. */
const shape = (x: Agent) => {
  const {
    env: _e, disabled: _d, accounts: _acc, default_account: _da,
    adopted_account: _aa, auto_switch_account: _as, ...rest
  } = x;
  void _e; void _d; void _acc; void _da; void _aa; void _as;
  return rest;
};
const isModified = (d: Agent, a: Agent) =>
  JSON.stringify(shape(d)) !== JSON.stringify(shape(a));

describe("resetting an agent to defaults", () => {
  it("keeps the credential sets", () => {
    // THE BUG. Reset rebuilds the entry from the ship default, which has no
    // accounts, so a reset deleted every named credential set and dropped the
    // agent back to one login. The stores stayed on disk, orphaned, with
    // nothing pointing at them.
    const mine = base({
      accounts: ["Personal", "Work"],
      default_account: "Personal",
      adopted_account: "Personal",
      auto_switch_account: true,
      command: "my-claude",
    });
    const reset = { ...base(), ...carriedOver(mine) };

    expect(reset.accounts).toEqual(["Personal", "Work"]);
    expect(reset.default_account).toBe("Personal");
    expect(reset.adopted_account).toBe("Personal");
    expect(reset.auto_switch_account).toBe(true);
    // ...while actually resetting the thing the button is about.
    expect(reset.command).toBe("claude");
  });

  it("keeps the per-agent env, as it always did", () => {
    const mine = base({ env: { CLAUDE_CODE_NO_FLICKER: "1" }, command: "x" });
    expect({ ...base(), ...carriedOver(mine) }.env).toEqual({ CLAUDE_CODE_NO_FLICKER: "1" });
  });
});

describe("the modified badge", () => {
  it("does not fire just because the user named a credential set", () => {
    // Naming an account is not a change to how the agent RUNS. Counting it as
    // one lit up the badge and armed a Reset button which, before the fix
    // above, then deleted the very thing that lit it.
    const d = base();
    expect(isModified(d, base({
      accounts: ["Personal", "Work"],
      default_account: "Work",
      adopted_account: "Personal",
      auto_switch_account: true,
    }))).toBe(false);
  });

  it("still fires for a real change to the command shape", () => {
    expect(isModified(base(), base({ command: "my-claude" }))).toBe(true);
    expect(isModified(base(), base({ args: ["--foo"] }))).toBe(true);
  });
});
