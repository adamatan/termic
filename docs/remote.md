# Remote (SSH) projects

A Project can be an **SSH host + repo combo** (issue #82): `Project.ssh:
Option<SshTarget>` holds host / user / port / identity file / remote
tasks path, and `root_path` is a path ON THAT HOST. Every task
created under a remote project lives on the host: the git worktree, the
agent process, shells, file ops, everything. The Task carries a
**frozen copy** of the target (`Task.ssh`, same freeze pattern as the
sandbox lists) so hot paths never need a project lookup and editing the
project's connection can't silently repoint live worktrees.

## Transport

System `ssh` binary + ControlMaster multiplexing. All ssh knowledge lives
in `src-tauri/src/ssh_exec.rs`; nothing else builds ssh argv.

- ControlPath is `~/termic/ssh/cm-%C` (NOT the app-data dir: macOS caps
  `sun_path` at 104 bytes). `ControlPersist=600` keeps the master alive.
- Background operations (git, file ops, scripts) run batched:
  `BatchMode=yes ConnectTimeout=10 ServerAliveInterval=5
  ServerAliveCountMax=3 StrictHostKeyChecking=accept-new`, plus a hard
  wall-clock kill in `run_remote` - a dead host fails fast, never wedges
  a spawn_blocking thread. accept-new trusts an UNSEEN host key on first
  use (BatchMode can't answer the interactive prompt) but still hard-fails
  on a CHANGED key.
- Every remote command line is wrapped `sh -c '<script>'` before it goes
  over the wire: sshd hands the command to the user's LOGIN shell, which
  may be fish/csh, and the POSIX constructs in our scripts don't parse
  there (caught live against a fish login shell). The single-quoted
  wrapper parses identically in every common shell; the payload then
  always runs under POSIX sh.
- PTY tabs use the same ControlPath WITHOUT BatchMode: an interactive
  passphrase / host-key prompt happens inside the visible terminal, and
  answering it revives the shared master for every background op.
- Auth defers to the user's `~/.ssh/config` + agent; a per-project
  identity file adds `-i <f> -o IdentitiesOnly=yes`.
- App exit runs `ssh -O exit` per distinct target (`cleanup_children`).

## Key seams

- `ssh_exec::shq()` - POSIX single-quote escaping. EVERY token that
  crosses into a remote shell goes through it. Unit-tested.
- `ssh_exec::git_on(host, args, cwd)` / `wgit(&task, args, cwd)` -
  git routed to the right machine. `ExecHost::Local` delegates to the
  untouched local `git()`.
- `run_remote(target, script, timeout, stdin)` - one bounded remote
  command; exit 255 classifies as transport failure with a stable
  `ssh: ` message prefix the frontend detects (`isSshError` in
  `src/lib/remote.ts`).
- `safe_remote_rel()` - lexical `.`/`..` normalization replacing
  `fs::canonicalize`-based `safe_task_path` for remote paths.
- PTY: `pty_spawn` rewrites a remote task's spawn into a LOCAL
  `ssh -t <host> "cd <ws> && exec env K=V... "$SHELL" -lc '<cmd>'"`.
  The PTY layer (registry, resize, kill, `pty://` events) is unchanged;
  resize rides SIGWINCH through `ssh -t`, kill kills the local ssh and
  HUPs the remote job. `SpawnArgs.remote_kind` selects the shape:
  agent / shell / custom / custom-once. Env pairs (incl. the
  TERM_PROGRAM=iTerm.app spoof) are inlined into the remote command
  because local process env does not cross ssh.

## Degradations (v1, by design)

- **Sandbox**: seatbelt is macOS-local. `effective_sandbox_mode()` is
  forced Off when `ws.ssh` is set; the UI explains this everywhere the
  sandbox would appear.
- Spotlight, send-diff-to-main, multi-repo, worktree import: not
  available for remote projects (guarded backend + hidden UI).
- Reveal in Finder: hidden; Copy path is the affordance.
- `file_fp` mtime fingerprints: skipped remotely (Viewed auto-clear
  degrades to manual).
- Committed `.termic.yaml` excludes: not read from the host (personal
  global excludes still apply).
- Git status poll: 15s for remote (4s local); transport failure keeps
  last-good data behind a reconnect banner in the right panel.

## Assumptions about the host

Linux/POSIX-ish with git installed (`project_ssh_probe` verifies and
caches `uname` / git version / `$HOME`). Remote scripts run through
`bash -lc`. The remote login shell only needs to survive
`cd x && exec env ... "$SHELL" -l` (POSIX + fish compatible).

## Testing without hardware

Enable macOS Remote Login (System Settings → Sharing) and add a remote
project pointing at `ssh localhost` + a local repo path. This exercises
the full pipeline: ControlMaster, quoting, PTY wrap, git panel, file
ops. The remote dir listing intentionally uses portable shell so it
works on BSD/macOS too.
