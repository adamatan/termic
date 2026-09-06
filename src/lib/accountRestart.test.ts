// @vitest-environment happy-dom
// Restarting a task's agent onto another account (GH #278).
//
// happy-dom because the restart schedules its waits with `window.setTimeout`,
// the same as `runPrompt`.
//
// The riskiest code in the account switcher: it SIGKILLs a live agent and then
// types into whatever comes back. Every failure mode here costs the user a
// running conversation or puts a message somewhere it does not belong, and
// none of it is visible in a diff, so it is pinned with fake timers rather
// than left to manual testing.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ptyKill = vi.fn(async (_id: string) => {});
const sendMessageToPty = vi.fn();
const markPendingPtyRestart = vi.fn();

vi.mock("@/lib/ipc", () => ({ ptyKill: (id: string) => ptyKill(id) }));
vi.mock("@/lib/agentSend", () => ({
  sendMessageToPty: (pty: string, msg: string) => sendMessageToPty(pty, msg),
}));
vi.mock("@/store/ui", () => ({
  useUI: { getState: () => ({ markPendingPtyRestart }) },
}));

/** A minimal tabs store, the only part of useApp this touches. */
let tabs: any[] = [];
const patchTab = vi.fn((_t: string, tabId: string, patch: any) => {
  tabs = tabs.map(t => (t.id === tabId ? { ...t, ...patch } : t));
});
vi.mock("@/store/app", () => ({
  useApp: { getState: () => ({ tabs: { t1: tabs }, patchTab }) },
}));

const agentTab = (over: any = {}) => ({
  id: "tab1", type: "terminal", cli: "claude", ptyId: "pty-old", ...over,
});

let restartAgentForAccount: typeof import("@/lib/accountRestart").restartAgentForAccount;

beforeEach(async () => {
  vi.useFakeTimers();
  tabs = [agentTab()];
  ptyKill.mockClear(); sendMessageToPty.mockClear();
  markPendingPtyRestart.mockClear(); patchTab.mockClear();
  ({ restartAgentForAccount } = await import("@/lib/accountRestart"));
});
afterEach(() => { vi.useRealTimers(); });

describe("restartAgentForAccount", () => {
  it("flags the task BEFORE killing, so the respawn is automatic", () => {
    // Order matters: `TerminalPane`'s exit handler consumes the flag. Killing
    // first races it, and the user gets the "exited / Restart" overlay on an
    // agent they never stopped.
    expect(restartAgentForAccount("t1", "claude")).toBe(true);
    expect(markPendingPtyRestart).toHaveBeenCalledWith("t1");
    expect(ptyKill).toHaveBeenCalledWith("pty-old");
    expect(markPendingPtyRestart.mock.invocationCallOrder[0])
      .toBeLessThan(ptyKill.mock.invocationCallOrder[0]);
  });

  it("does nothing when there is no live agent to restart", () => {
    tabs = [agentTab({ ptyId: undefined })];
    expect(restartAgentForAccount("t1", "claude")).toBe(false);
    expect(ptyKill).not.toHaveBeenCalled();
    expect(markPendingPtyRestart).not.toHaveBeenCalled();
  });

  it("ignores tabs belonging to a DIFFERENT agent", () => {
    // A task can hold several agent tabs. Switching claude's account must not
    // kill the codex sitting beside it.
    tabs = [agentTab({ id: "other", cli: "codex", ptyId: "pty-codex" })];
    expect(restartAgentForAccount("t1", "claude")).toBe(false);
    expect(ptyKill).not.toHaveBeenCalled();
  });

  it("shows no overlay for a plain restart", () => {
    // The overlay's copy is "Sending X when it is ready", and the code that
    // clears it lives on the send path. Shown without a message it announced
    // something that would never happen and never went away: the tab sat under
    // a spinner for the rest of the session.
    restartAgentForAccount("t1", "claude");
    vi.advanceTimersByTime(30_000);
    expect(patchTab).not.toHaveBeenCalledWith("t1", "tab1",
      expect.objectContaining({ promptPendingTitle: expect.anything() }));
  });

  it("waits for a DIFFERENT pty before sending, never the one it killed", () => {
    // THE trap. The old id stays on the tab until the respawn patches it, so
    // "has a ptyId" is true the whole time: a check for presence would write
    // the message into the process just killed, where nobody would ever see
    // it and the new agent would sit idle.
    restartAgentForAccount("t1", "claude", { message: "continue" });
    // Still inside the respawn deadline, and the tab still carries the OLD id.
    vi.advanceTimersByTime(3_000);
    expect(sendMessageToPty).not.toHaveBeenCalled();

    tabs = [agentTab({ ptyId: "pty-new" })];
    vi.advanceTimersByTime(10_000);
    expect(sendMessageToPty).toHaveBeenCalledTimes(1);
    expect(sendMessageToPty).toHaveBeenCalledWith("pty-new", "continue");
  });

  it("re-reads the tab after the settle, so a second restart is not typed into", () => {
    // The settle window is seconds long. A tab closed or restarted again in
    // that gap must not receive the message meant for the pty that existed
    // when the timer was set.
    restartAgentForAccount("t1", "claude", { message: "continue" });
    tabs = [agentTab({ ptyId: "pty-new" })];
    vi.advanceTimersByTime(500);          // the respawn is seen...
    tabs = [agentTab({ ptyId: undefined })]; // ...and then it dies again
    vi.advanceTimersByTime(30_000);
    expect(sendMessageToPty).not.toHaveBeenCalled();
  });

  it("drops the overlay when the agent never comes back", () => {
    // Otherwise a failed respawn leaves the tab covered by a spinner with no
    // way out but closing it.
    restartAgentForAccount("t1", "claude", { message: "continue" });
    vi.advanceTimersByTime(60_000);
    expect(patchTab).toHaveBeenCalledWith("t1", "tab1", { promptPendingTitle: null });
    expect(sendMessageToPty).not.toHaveBeenCalled();
  });
});
