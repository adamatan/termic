# Profiles

One termic, several fully separate instances. A **profile** owns its own
projects, tasks, settings and agent registry, and lives in its own window; two
profiles can be open on two monitors at once and neither can see the other's
work. Shipped in phase 1 of [#280](https://github.com/simion/termic/issues/280);
phase 2 (a separate account per profile for each agent) is
[#278](https://github.com/simion/termic/issues/278) and
[docs/plans/agent-credentials.md](plans/agent-credentials.md).

## The one rule everything follows

**The profile rides the DATA, not the call.**

Records are loaded from every profile and tagged in memory with the directory
they came from, so a by-id lookup needs no profile at all and a write goes back
where the record came from. Only LISTING and CREATION name a profile.

This is the second answer to the question, and the first one is worth knowing
because it looks obviously right and is not. Deriving the profile from the
calling window (`window: tauri::Window`, label `profile-<slug>`,
`profile_dir(&window)`) does not survive the call graph:

```
load_tasks_all()        99 call sites   (90 of them by-id lookups)
load_projects_all()     54
load_settings_inner()   45
```

None of the three caches, and a large minority of those sites are in
`cli_server.rs`, `mcp_server.rs`, file watchers and per-task background threads,
which have no window to take. Meanwhile a task id is a UUID, so it is already
unique across profiles and those 90 lookups do not care which profile a record
came from.

Consequences worth stating explicitly:

- **`load_tasks_all` / `load_projects_all`** span every profile and tag each
  record. This is what the port allocator needs: one process draws from one port
  space, so a per-profile view would hand two profiles the same block.
- **`load_tasks_in` / `load_projects_in`** are scoped, for anything that becomes
  a list in one window.
- **There is no bare `load_tasks`.** The split forces every call site to declare
  which it means, so leaking another profile's tasks into a window is something
  you have to type rather than something you get by forgetting.
- **`save_task(&t)` writes to `t.profile`.** `save_projects` groups a mixed list
  by tag, so the common load-all / edit-one / save shape cannot drag other
  profiles' projects into one directory.
- **The tag is `#[serde(skip)]`.** Nothing reaches disk, so there is no schema
  bump and an existing install's files stay byte-identical.

A window is consulted in exactly two places, both of which genuinely cannot
resolve from a record: `projects_list` (which profile does this sidebar show)
and `project_add` (which profile does a new project join). Tasks never need it,
because a task's profile is its project's.

## Dormant until asked for

`profiles.json` does not exist until the first profile is created, and is
unlinked again when the last one goes. Its ABSENCE is the "this feature does not
exist yet" state, not a missing file to heal:

- No strip in the sidebar, no name, no color. The footer's profile button is the
  whole surface, and it opens Settings to Profiles.
- Every path resolves exactly as it did before profiles existed.
- `localStorage` keys are unprefixed (see below).

Creating the FIRST profile also adopts the install that already exists, in the
same write: that is the moment the current setup becomes "a profile" and it
needs a name then, or the strip reads "Default" forever. Both entries land
together, so the registry is never seen naming one of two profiles.

## Data layout

```
~/Library/Application Support/termic/     (termic_dev in debug builds)
├── profiles.json          the registry. ABSENT while dormant.
├── settings.json          the ROOT profile's. Not moved.
├── projects.json          same
├── tasks/                 same
├── scratch/               same
├── profiles/
│   └── <slug>/            every profile EXCEPT the root one
│       ├── settings.json
│       ├── projects.json
│       ├── tasks/
│       └── scratch/
├── docker/ docker-agents/ docker-forge/ servers/ backups/   GLOBAL
├── cli-token / mcp-token                                    GLOBAL
```

```
~/termic/
├── tasks/                        the root profile, exactly as today
├── workspaces/                   pre-rename legacy
└── profiles/<slug>/tasks/<project>/<name>/
```

**The root profile IS the app data dir.** It has no directory of its own and no
slug on disk, which is what makes the feature migration-free.
`Registry::root_slug` names which profile owns it, and may be `None` once that
profile is deleted: nothing is promoted and nothing moves.

**One identifier, the slug, keyed the same way in both trees**, and it is also
the window label. Frozen at creation and never renamed, because CWD-resume
agents key sessions to the working directory and relocating a worktree would
orphan every conversation under it. The `profiles/` level namespaces slugs: a
profile called "tasks" or "workspaces" would otherwise land on the two
directories under `~/termic/` that already mean something.

**`global_dir()` vs `profile_dir(id)`.** `data_dir()` was renamed `global_dir()`
so a caller that wants machine-wide state has to say so: the CLI and MCP tokens,
the docker image and agent dirs, the downloaded LSP `servers/` cache, `backups/`,
and the sandbox's own deny rule, which must cover EVERY profile and is therefore
anchored at the root.

**App data does NOT move under `~/termic`.** The Seatbelt profile ends with a
last-match-wins `(deny file-read* (subpath <data_dir>))` protecting the CLI
token, while a worktree under `~/termic` must stay readable by the agent.
Nesting the denied dir inside the worktrees tree would put an allow and a deny
in one subtree.

## Windows

One window per profile, 1:1, and switching IS opening a window. `profile_open`
focuses the window if it is up and builds it if it is not; from the user's side
that is one action, which is why the popover does not distinguish them.

`build_profile_window` is the single builder for every profile, extracted from
`setup` so the root window and a second profile's window cannot drift: same size
clamp, same cursor-monitor placement, same restore, same close behaviour.

**The root profile keeps the literal `main` label.** `tauri-plugin-window-state`
keys saved frames by label, so a pre-profiles install must find its geometry
where it left it, and the automation bridge hardcodes `main` besides. Other
profiles are `profile-<slug>`.

**Closing one window while others are up just closes that window.** The
close-action setting (menu bar / quit / ask) is about the LAST window going
away. A non-root profile destroys rather than hides, so the popover shows it
closed and reopening rebuilds it.

**Windowless is app-wide.** It gates the drop to `ActivationPolicy::Accessory`,
so hiding only `main` while another profile stayed visible would take the Dock
icon out from under a window the user can still see. `enter_windowless` hides
every profile window; `leave_windowless` restores them all and focuses one.

**Launch restores what was open.** `Profile::open_at_quit` is set when a window
is built and cleared when the USER closes one; app quit does not clear it, which
is what makes restore work. Least recently focused first, so the window the user
was in ends up frontmost. Not under `feature = "e2e"`: the suite reuses one
window across spec files and asserts on handle counts.

## Event routing

54 `.emit(` sites and zero `emit_to` before this. With one window a broadcast was
correct and free; with one per profile every profile's webview would receive
every other profile's PTY bytes, setup logs, grep hits and CLI requests.

Routing is derivable (task → project → profile → window), so nothing is tracked,
but the derivation must not touch disk on a hot path:

- **`pty://` and `pty-exit://` resolve at SPAWN.** `pty_spawn` already loads the
  task for the Docker branch, so the hottest path in the app pays nothing per
  chunk.
- **Everything else goes through `emit_scoped`,** which parses the task id out
  of the TOPIC (`setup-done://<id>`, `script-output://<id>:<member>:<kind>`,
  `grep-done://<id>`) and looks it up in a memo. A task never changes profile,
  so an entry is permanent; the memo is dropped when a task is deleted or the
  registry changes, the only two ways a cached label goes stale.
- **An unresolvable id BROADCASTS.** That is the pre-profiles behaviour, and a
  far better failure than an event reaching no window at all.
- **`docker-build://` and `termic://windowless` stay broadcasts.** One image and
  one activation policy per machine, so every window should hear them.

**Deep links are routed at queue time.** `deep_link_take_pending` was a
`std::mem::take`, so whichever webview drained first swallowed every queued URL
including another profile's; the queue is now keyed by target label. Rust still
does not parse these URLs beyond reading ONE query parameter, `project`, which
is the minimum needed to pick a window. Unresolvable goes to the most recently
focused open profile.

**The tray merges.** Each window computes attention from its own profile, so the
last writer would erase every other profile's rows, which is the opposite of
what the menu-bar item is for. `TRAY_ATTENTION` is keyed by window label; rows
group by profile then project, and the profile heading appears only when there
IS more than one, so a single-profile install's menu is unchanged. A tray click
raises the owning window before routing `termic://focus-task` to it.

## localStorage

Every profile window is a webview on the same origin, so localStorage is shared
whether we want it or not. `src/lib/profileScope.ts` namespaces the keys a
profile owns.

**The namespace is the window label, read synchronously** off the Tauri bridge.
That matters: stores read their keys at module-init, so an async
`profiles_list` would be a frame too late and every store would boot from the
wrong state.

**The root profile's keys are UNPREFIXED.** Its label is `main`, which maps to
the empty namespace, so an existing install reads its collapse state, folder
colors and prompt library from exactly the keys they are already in. No
migration, and nothing resets on the release that ships this.

Scoped: project/task/group collapse state, folder colors, `taskExpandMode`,
`hideInactiveProjects`, `newTaskLast*`, member modes, the prompt library.

**NOT scoped, on purpose:** theme, fonts, terminal and editor settings, shortcut
bindings. Those are machine-level (muscle memory does not change per identity)
and are shared by every window. `purgeProfileKeys(slug)` runs on delete, or a
recreated profile with the same slug inherits a dead one's state.

## Deleting, and backing out

These are two different operations and conflating them is a trap:

**`profile_delete`** is destructive and is REFUSED while the profile's window is
open. That is a precondition the user can act on rather than a race to handle,
and it means no PTY is running under the profile at the moment of deletion, so
live agents are never killed behind their back. Metadata is backed up first to
`backups/pre-profile-delete-<slug>-<ts>/`. Worktrees go through
`git worktree remove --force`, never `remove_dir_all`, or the user's own repo is
left with a dangling `.git/worktrees/` registration until someone runs
`git worktree prune`. Main checkouts are skipped and branches are never deleted.

**`profile_close`** closes a profile's window. It exists because the delete
dialog told you to close it and gave you no way to, and the window may be on
another Space or another monitor. It refuses to close the CALLING window, which
is the red button's job, and it clears `open_at_quit` so launch restore does not
bring back a window you deliberately closed.

**`profiles_disable`** stops using profiles and keeps every byte of data. It has
to exist: a delete is refused while the window is open, and the LAST remaining
profile is always the one whose window you are in, so "delete everything" could
never finish from inside the app. It unlinks `profiles.json` and touches nothing
else. Refused while more than one profile exists, because then what happens to
the other profiles' data is a real question the user has to answer.

`profile_delete_preview` supplies the counts the dialog needs (tasks, dirty,
unpushed, main checkouts, worktrees path, window open). Counts, not prose: they
are what make it a decision rather than a leap, and they are the same
information the user would otherwise have to open the profile to find.

## The CLI

`--profile <name>` is global on every verb, matching a slug OR a display name
case-insensitively: the user sees the name in the strip and the slug on disk and
should not have to know which one the flag wants.

An unknown name is a `BadRequest` naming the profiles that do exist, **never a
fallback to another one** — the server already refuses to guess for an unknown
project, and guessing here would act on the wrong profile's data.

Omitted, a request routes by the `taskId` or `projectId` in its params, and a
request naming neither (`list_agents`, `list_prompts`) goes to the most recently
focused open window.

Two globals carry the value, each correct for its scope and wrong anywhere else:
a `OnceLock` in the CLI, which is a single-shot process with one `--profile` for
its whole run, and a thread-local in `cli_server`, where one connection is served
start to finish on its own thread and the target has to reach `rpc_target_label`
several frames down.

## Agent logins

Phase 1 does nothing here, and that is the whole story: **every profile shares
the one login each agent already has**, because it reads the same config dir and
the same credential store it always did. Nothing is copied, nothing syncs,
nothing can drift.

Agent hooks need no work either, and structurally so: a hook reports by printing
an OSC escape into `$TERMIC_PTY`, the PTY termic spawned for that task, so the
signal rides a stream already routed to one window. `agent_hooks.rs` has zero
`global_dir()` call sites, writing only into the agent's own config dir, so one
install serves every profile.

Profile creation must NOT offer to relocate a config dir. That is the one action
that would hand a new profile a logged-out agent, and it is not how the second
account arrives: phase 2 does that, by giving each profile its own agent config
dir holding the credential and symlinking settings, skills, commands and history
back to the primary. See [plans/agent-credentials.md](plans/agent-credentials.md).

## Known gaps

- **The perf budget multiplies.** N profile windows is N webviews, N WebGL
  terminal renderers, N sets of mounted tasks. `make perf` measures one window.
  The multi-window idle budget is undecided, and so is whether a background
  profile's window should aggressively unmount (`display: none`, never
  `visibility: hidden`, applies per window as well as per pane).
- **Closing a window with running agents.** PTYs live in Rust and survive, so
  the tasks become unmounted-but-running and the menu-bar item is their only
  surface. How much Rust buffers for replay on reopen is unconfirmed.
- **`schema_version` forks.** Each profile's `settings.json` migrates
  independently, so migration code must tolerate profiles at different versions
  after a downgrade/upgrade cycle.
- **Multiple windows per profile** is deferred. It needs Rust to become
  authoritative for UI state and forces either two WebGL terminals on one PTY or
  scrollback replay on every move.
- **A project can live in several profiles.** Decision 4 allows it; the
  tie-break is most recently focused. What "move this project to another
  profile" should do with its tasks is undecided.
