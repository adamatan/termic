import { describe, it, expect } from "vitest";
import { pillVisible, pillLabel, pillOrder, pillText } from "@/lib/accountPill";
import type { AgentAccountsView } from "@/lib/types";

const view = (names: string[], opts: Partial<AgentAccountsView> = {}): AgentAccountsView => ({
  adoptedAccount: null,
  reportsUsage: false,
  autoSwitch: false,
  unsupportedReason: null,
  agentId: "claude",
  supported: true,
  envVar: "CLAUDE_CONFIG_DIR",
  envIsSharedRoot: false,
  accounts: names.map((name, i) => ({ name, signedIn: i === 0, isDefault: i === 0 })),
  ...opts,
});

describe("the account pill's rules", () => {
  it("stays hidden with no accounts, because there is no account concept yet", () => {
    // The user has "whatever the agent is logged into" and has never named it.
    // A pill would have to invent a label, which is the "Default forever" trap
    // the profiles strip avoids by not existing until the first profile does.
    expect(pillVisible(view([]))).toBe(false);
    expect(pillVisible(null)).toBe(false);
  });

  it("appears as soon as ONE account is named", () => {
    // The threshold was two, on the grounds that one account is nothing to
    // switch between. Wrong in use: naming a credential set is the moment the
    // user starts thinking in accounts, and a footer that stayed empty
    // afterwards read as the feature not having worked. The pill also carries
    // "add another", so at one account it is what gets you to two.
    expect(pillVisible(view(["Personal"]))).toBe(true);
  });

  it("appears at two", () => {
    expect(pillVisible(view(["Personal", "Work"]))).toBe(true);
  });

  it("stays hidden for an agent whose login cannot be relocated", () => {
    // Offering a switch that silently shares one credential between two
    // "accounts" is worse than offering nothing.
    expect(pillVisible(view(["Personal", "Work"], { supported: false }))).toBe(false);
  });

  it("names the task's own account once it has been switched", () => {
    const v = view(["Personal", "Work"]);            // Personal is the default
    expect(pillLabel(v, null)).toBe("Personal");
    expect(pillLabel(v, "Work")).toBe("Work");
  });

  it("falls back to nothing rather than guessing when there is no default", () => {
    const v = view(["Personal", "Work"]);
    v.accounts.forEach(a => { a.isDefault = false; });
    expect(pillLabel(v, null)).toBeNull();
  });

  it("never reorders, whichever account is in use", () => {
    // It used to float the one in use to the top. That reads well in a
    // screenshot and badly in use: the list rearranges itself under the cursor
    // on every switch, so the row you want is never where it was and muscle
    // memory never forms. The tick answers "which am I on" without moving
    // anything.
    const v = view(["Personal", "Work"]);
    expect(pillOrder(v).map(a => a.name)).toEqual(["Personal", "Work"]);
  });

  it("keeps every account in the list", () => {
    // The popover is the only place to switch, so dropping one strands it.
    const v = view(["A", "B", "C"]);
    expect(pillOrder(v).map(a => a.name)).toEqual(["A", "B", "C"]);
  });
});

describe("pillText", () => {
  const v = view(["Work", "Personal"], { accounts: [
    { name: "Work", signedIn: true, isDefault: true },
    { name: "Personal", signedIn: true, isDefault: false },
  ] });

  it("names one account when nothing is staged", () => {
    expect(pillText(v, null, "Work")).toEqual({ now: "Work", next: null });
  });

  it("reports the running account and the staged one separately", () => {
    // Only `now` is printed. It is the RUNNING account, because the usage
    // numbers beside the pill are its numbers: showing "Personal" there would
    // caption Work's percentage with Personal's name. `next` exists for the
    // tooltip, which is where a state that lasts seconds belongs.
    expect(pillText(v, "Personal", "Work")).toEqual({ now: "Work", next: "Personal" });
  });

  it("names the ADOPTED account for a process on the ordinary login", () => {
    // `running === null` is a real answer: the agent's ordinary login, which
    // the adopted account is the name for. Falling through to the CONFIGURED
    // account was a lie, and a visible one: with a switch staged and not yet
    // restarted, the pill claimed the new account while the process had never
    // run as it.
    const v = view(["Personal", "Work"], { adoptedAccount: "Personal" });
    expect(pillText(v, "Work", null)).toEqual({ now: "Personal", next: "Work" });
  });

  it("collapses to one name once the restart has happened", () => {
    expect(pillText(v, "Personal", "Personal")).toEqual({ now: "Personal", next: null });
  });

  it("falls back to the configured account before anything has spawned", () => {
    // Nothing is running, so there is no second name to show and the
    // configured account is the only honest answer.
    expect(pillText(v, "Personal", null)).toEqual({ now: "Personal", next: null });
  });

  it("says default when there is nothing to name at all", () => {
    expect(pillText(null, null, null)).toEqual({ now: "default", next: null });
  });
});

// The rule the footer hook applies, as a function, because getting it wrong is
// invisible in a diff and very visible in use.
const usageAccount = (live: string | null | undefined, configured: string | null) =>
  live === undefined ? configured : live;

describe("which account the footer's numbers belong to", () => {
  it("uses the RUNNING account, not the configured one", () => {
    // A switch applies on the next spawn, so between the click and the restart
    // the two differ, and the numbers belong to the old one.
    expect(usageAccount("Work", "Personal")).toBe("Work");
  });

  it("treats a running process with NO account as an answer, not an absence", () => {
    // THE BUG. Every process spawned before the user names a credential set is
    // running on the agent's ordinary login, which is `null`. Collapsing that
    // into "nothing has spawned yet" with `??` re-keyed a running task's chip
    // to the newly named default, and its usage vanished mid-session.
    expect(usageAccount(null, "Default")).toBeNull();
  });

  it("falls back to the configured account only before anything has spawned", () => {
    // Nothing is running, so there is no reading to misattribute, and keying
    // to the unnamed login would show the wrong account's percentage for as
    // long as the agent took to boot.
    expect(usageAccount(undefined, "Work")).toBe("Work");
    expect(usageAccount(undefined, null)).toBeNull();
  });
});
