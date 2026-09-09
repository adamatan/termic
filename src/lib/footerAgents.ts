// Which agents the task footer answers for (GH #277 follow-up).
//
// The footer's usage/account chip used to be hard-bound to `task.cli`, the
// agent the task was CREATED with. A task can hold several agent tabs, and a
// claude tab sitting next to a codex tab showed one chip for codex and nothing
// for claude: the footer had no idea the other agent existed. Reported on #277
// by a user running exactly that pair.
//
// So the footer asks these two questions instead: which agents does this task
// actually run (one chip each, each self-hiding when its agent has nothing to
// report), and which one is the user looking at right now (the one that
// survives a footer too narrow to hold both).

import type { Tab, TerminalTab } from "@/lib/types";

/** An AGENT terminal, as opposed to a plain shell or a custom command. Same
 *  predicate the PR comment watcher uses to find a task's agents. */
function isAgentTab(t: Tab): t is TerminalTab {
  return t.type === "terminal" && t.cli !== "shell" && t.cli !== "custom";
}

/** Separator for the packed agent list. NUL, because the ids being packed are
 *  user-typed: an agent entry is named in Settings, where a comma or a space
 *  is perfectly legal and a NUL is not. */
export const AGENT_SEP = "\u0000";

/** Every distinct agent this task runs, the task's own agent first, packed
 *  into ONE string.
 *
 *  A string rather than the array the caller actually wants, because this runs
 *  inside a zustand selector: an array built per call is a fresh reference
 *  every time, which re-renders the footer on every store write in the window
 *  (docs/performance.md bear trap 8, pinned by store/selectorFanout.test.ts).
 *  The single-agent case - which is every task until somebody opens a second
 *  agent in one - returns `primary` itself and allocates nothing at all.
 *
 *  The primary leads whether or not it has a tab yet: it is the agent the task
 *  IS, and a task whose terminals have not spawned still has an account to
 *  name and a quota to show. Everything else follows in tab order, which is
 *  the order the user put them in - deliberately NOT reordered by which tab is
 *  focused, because a chip that moves when you switch tabs is a chip you have
 *  to find again every time. */
export function footerAgentKey(tabs: Tab[], primary: string): string {
  let extra: string[] | null = null;
  for (const t of tabs) {
    if (!isAgentTab(t) || t.cli === primary) continue;
    if (extra === null) extra = [t.cli];
    else if (!extra.includes(t.cli)) extra.push(t.cli);
  }
  return extra === null ? primary : primary + AGENT_SEP + extra.join(AGENT_SEP);
}

/** Unpack what `footerAgentKey` returned. Called in render, not in a selector,
 *  so the array it allocates costs a render and not a store write. */
export function footerAgentIds(key: string): string[] {
  return key.split(AGENT_SEP);
}

/** The agent whose tab is on screen right now.
 *
 *  Falls back to the primary for any non-agent tab (a diff, an editor, a
 *  shell): those say nothing about which quota the user is spending, so the
 *  footer keeps naming the task's own agent rather than blanking. */
export function activeFooterAgent(
  tabs: Tab[], activeTabId: string | null | undefined, primary: string,
): string {
  const active = tabs.find(t => t.id === activeTabId);
  return active && isAgentTab(active) ? active.cli : primary;
}
