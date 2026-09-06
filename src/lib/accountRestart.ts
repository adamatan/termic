// Restarting a task's agent onto a different account (GH #278).
//
// A switch only ever writes a setting: a running process cannot have its
// environment changed underneath it, so the new login lands on the NEXT spawn.
// That is honest but not much use mid-session, which is why this exists.
//
// It is safe to restart only because an account's store SHARES the agent's
// transcripts (`agent_dirs::shared_config_entries`). Without that the account
// dir is a blank agent and a restart would drop the conversation, which is the
// exact thing the switcher is supposed to protect. If that sharing is ever
// removed, this has to go with it.
//
// The restart itself is the pattern `ResumeOverrideDialog` established: flag
// the task so `TerminalPane`'s exit handler auto-respawns instead of showing
// the "exited" overlay, then SIGKILL the live pty. The respawn resumes the
// session on its own.

import { useApp } from "@/store/app";
import { useUI } from "@/store/ui";
import { ptyKill } from "@/lib/ipc";
import { sendMessageToPty } from "@/lib/agentSend";
import type { TerminalTab } from "@/lib/types";

/** How long to let the agent boot before typing into it. Same reasoning and
 *  the same generosity as `runPrompt`: agents are slow to become input-ready,
 *  and a prompt that lands on a splash screen is lost. */
const SETTLE_MS = 5000;
/** Give up waiting for the fresh pty. */
const RESPAWN_DEADLINE_MS = 12000;

/** The task's primary agent tab, which is the one an account switch is about. */
export function primaryAgentTab(taskId: string, agentId: string): TerminalTab | undefined {
  const tabs = (useApp.getState().tabs[taskId] ?? []) as TerminalTab[];
  return tabs.find(t => t.type === "terminal" && t.cli === agentId && !!t.ptyId);
}

/**
 * Restart this task's agent so it picks up the account that was just chosen.
 *
 * `message` is sent once the fresh agent is up. The automatic switch uses it to
 * say "continue": the restart resumes the conversation, but the agent is then
 * sitting idle at a prompt, and the turn that hit the limit still has to be
 * asked for again. Nobody is at the keyboard when the automatic switch fires,
 * so nobody would type it.
 *
 * Returns false when there was nothing running to restart.
 */
export function restartAgentForAccount(
  taskId: string,
  agentId: string,
  opts: { message?: string } = {},
): boolean {
  const tab = primaryAgentTab(taskId, agentId);
  if (!tab?.ptyId) return false;
  const oldPty = tab.ptyId;

  useUI.getState().markPendingPtyRestart(taskId);
  // The overlay is ONLY for the case where a message follows, and it is
  // labelled with that message, because its copy reads "Sending X when it is
  // ready". Shown for a plain restart it stated something that was never going
  // to happen, and nothing cleared it: the clearing lives on the send path,
  // which a restart with no message never reaches. The tab sat under a
  // spinner for the rest of the session.
  if (opts.message) {
    useApp.getState().patchTab(taskId, tab.id, { promptPendingTitle: opts.message });
  }
  void ptyKill(oldPty).catch(() => {});

  if (!opts.message) return true;

  // Wait for a DIFFERENT pty id, not merely for one to exist: the old id is
  // still on the tab until the respawn patches it, so "has a ptyId" is true
  // the whole time and would send the message into the process we just killed.
  const deadline = Date.now() + RESPAWN_DEADLINE_MS;
  const tick = () => {
    const t = (useApp.getState().tabs[taskId] ?? []).find(t => t.id === tab.id) as TerminalTab | undefined;
    if (t?.ptyId && t.ptyId !== oldPty) {
      window.setTimeout(() => {
        // Re-read: the tab may have been closed, or restarted again, during
        // the settle window. Never write into a stale pty.
        const live = (useApp.getState().tabs[taskId] ?? []).find(x => x.id === tab.id) as TerminalTab | undefined;
        if (!live?.ptyId) return;
        sendMessageToPty(live.ptyId, opts.message!);
        useApp.getState().patchTab(taskId, tab.id, {
          lastInputAt: Date.now(),
          promptPendingTitle: null,
        });
      }, SETTLE_MS);
      return;
    }
    if (Date.now() < deadline) { window.setTimeout(tick, 150); return; }
    // Never came back. Drop the overlay rather than leaving the tab covered.
    useApp.getState().patchTab(taskId, tab.id, { promptPendingTitle: null });
  };
  window.setTimeout(tick, 300);
  return true;
}
