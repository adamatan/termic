# Making a PR (adamatan/termic → simion/termic)

`origin` = `adamatan/termic` (this fork, push access).
`upstream` = `simion/termic` (the real upstream, PRs target this).
`main` tracks `upstream/main` and is kept in sync by fetching upstream, not
by pushing local commits to it.

## Flow

1. Branch off `main` (which should be reasonably close to `upstream/main`):
   `git checkout -b feature/<name> main`
2. Commit, then push to `origin` (your fork), not `upstream`:
   `git push -u origin feature/<name>`
3. Open the PR against upstream with `gh`:
   `gh pr create --repo simion/termic --base main --head adamatan:feature/<name> --title "..." --body "..."`
   (`gh` usually infers `--repo`/`--head` correctly from the fork
   relationship since `adamatan/termic` is a real GitHub fork of
   `simion/termic` — check with `gh pr create` interactively if unsure.)
4. CI runs on the upstream repo. Address review comments with more commits
   on the same branch; `git push origin feature/<name>` updates the PR.

## Keeping `main` in sync

`main` is currently tracked as `[upstream/main: behind N]` — it does not
auto-update. Periodically:

```
git fetch upstream
git checkout main
git merge --ff-only upstream/main   # or rebase feature branches after
git push origin main                # keep the fork's main mirror current
```

## Gotcha this notes-branch setup exists to avoid

If you ever commit fork-only content directly to `main` (or anything `main`
merges from), it becomes an ancestor of every future feature branch, and
will show up as an "added file" in the next PR diff against upstream — even
though it has nothing to do with that PR. See `README.md` in this directory
for why `notes` avoids that.
