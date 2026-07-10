# Fork-local notes (adamatan/termic only)

This directory is a `git worktree` checked out on the `notes` branch, an
**orphan branch** with no shared history with `main` at all. `main` tracks
`upstream/main` (`simion/termic`), and PRs go
`adamatan:<feature-branch>` → `simion/termic`.

Anything committed here stays out of every PR because:

- `notes` has zero shared ancestry with `main`, so it can never be an
  ancestor of `main` or of any feature branch cut from `main`.
- GitHub computes a PR diff against the merge-base with the upstream branch;
  content that isn't in `main`'s ancestry can't show up there.

Rules to keep it that way:

- Only ever branch feature work off `main`, never off `notes`.
- Never merge, rebase, or cherry-pick `notes` commits into `main` or any
  feature branch.
- Push `notes` to `origin` only (`git push origin notes`) — never to
  `upstream`.

This directory is excluded via `.git/info/exclude` (local-only, not a
tracked `.gitignore` entry) so `main`'s `git status`/`git add -A` never sees
it. That means the exclude rule doesn't travel with a fresh clone — redo it
if you ever re-clone: append `.claude/notes/` to `.git/info/exclude`, then
`git worktree add .claude/notes notes` (the branch already exists on
`origin` once pushed once).

Claude reads this automatically in `termic` sessions per the pointer in
`~/.claude/CLAUDE.md` (global, machine-local, never part of this repo).
