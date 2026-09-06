# Feature tips: pointing at the thing, after an upgrade

Status: **idea**, not approved. Nothing here is decided, and the open questions
at the bottom are product calls rather than engineering ones.

## The problem, with today's evidence

Termic ships features into a window that is already full. The affordance lands,
the changelog names it, and nobody finds it, because the two things never meet:
the changelog is words in a card, and the feature is a 16px control somewhere
on screen.

Three examples from one session (GH #278 / #280), all shipped, all
undiscoverable to someone who does not already know:

- the **profile chip** in the title bar, which is a bare person glyph until you
  create a profile, sitting next to another bare glyph and losing the eye to
  the badge beside it;
- the **account pill** in the task footer, which renders only once a second
  credential set exists, so the people who most need to know it exists are
  exactly the people who cannot see it;
- the **"switch automatically past 95%"** checkbox, which lives inside two
  popovers and is the entire point of the auto-switch work.

Each was argued about on its own. The argument keeps recurring because the
answer is not "make this control louder": every control cannot be loud. The
missing thing is a way to point at a control ONCE, at the moment it becomes
relevant, and then never again.

## What already exists, and must be reused rather than duplicated

Four pieces are in the tree and three of them already do part of this:

| Piece | What it does today |
|---|---|
| `sidebar/UpdateCard.tsx` | "What's new" mode: fires when `currentVersion > lastSeenVersion`, shows the release SUMMARY line, dismissible. **The upgrade trigger already exists here.** |
| `dialogs/ChangelogDialog.tsx` | The full human-authored `CHANGELOG.md`, rendered. The destination for "tell me everything". |
| `dialogs/WelcomeDialog.tsx` | The 4-step first-launch wizard, ~670 lines. The reuse target for "intro wizard". |
| `changelog.json` | Derived from `CHANGELOG.md` by `scripts/changelog.mjs`. Per-version `summary`. Never hand-edited. |

So this is not a new subsystem. It is a third rung on a ladder that already has
two: a summary sentence, and the full notes. The tip is the rung in between,
and the one that knows where the control IS.

The version comparison, the "seen" bookkeeping and the dismissal are all
already written in `UpdateCard` / `store/update.ts`. A tips system that invents
its own is a second convention, and the reason to build it at all is to stop
having several.

## Shape, roughly

A tip is authored data, not code: an id, the version it belongs to, one
sentence, and a **selector for the thing it points at**. The last field is what
makes it different from a changelog line, and it is also the whole risk (see
the traps).

Anchoring is the first real decision. A tip can:

- **point** at a live element (a spotlight / callout anchored to a `data-testid`
  or a ref), which is the most useful and the most fragile;
- **describe** the location in words ("in the task footer, next to the sandbox
  status"), which never breaks and is much weaker;
- **do neither**, and simply open the surface itself with the control already
  highlighted, which is how the usage popover's "add a second set of
  credentials" row already works and is the cheapest thing that works.

The third option deserves a real look before the first is built, because the
app already does it in one place and it costs nothing.

## Traps this has to answer before it is a plan

**Nagware.** A tip that reappears is worse than no tip. Dismissal has to be
permanent per tip id, and the ceiling per upgrade has to be small (one? three?)
or an upgrade becomes a gauntlet. The failure mode is the Clippy one, and it is
not recoverable: people learn to dismiss without reading, and then the ONE tip
that mattered is dismissed too.

**Tips for things the user already does.** Pointing at the account pill for
someone who has been switching accounts for a month is noise that teaches them
this system is noise. A tip needs a cheap "is this already in use" predicate,
which is per-feature and is real work.

**A tip that points at nothing.** Half the examples above are DORMANT until the
user does something: the profile chip is a bare icon with no profiles, the
account pill does not render below two accounts. A tip anchored to an element
that is not on screen must degrade to prose or not fire at all, and deciding
that per tip is exactly the kind of per-feature table this repo has learned to
guard (see `docs/adding-an-agent.md` §1c).

**Several windows.** Profiles made this app multi-window. A tip that fires in
every profile window at once is three copies of the same interruption, and
"seen" is per install, not per window. `emit_scoped` exists for this class of
problem and would have to be used here too.

**The e2e suite.** A tour that appears on launch covers the UI the suite is
driving, and `dismissOverlays()` already exists because leftover overlays break
pointer hit-testing (see the `e2e` skill). Anything that renders over the app
on startup has to be off under `feature = "e2e"`, or every spec grows a
dismissal step.

**Authoring cost.** If a tip is written by hand per feature, tips stop being
written the first busy release. If it is derived from `CHANGELOG.md`, it cannot
carry a selector. That tension is unresolved and is the main reason this is an
idea rather than a plan.

## The wizard reuse

`WelcomeDialog` is a 4-step first-launch wizard today, and the appeal of a
shared mechanism is real: the same "here is the thing, here is where it is"
primitive drives both a first-run tour and a post-upgrade tip. But the two have
different contracts. The wizard runs once, in order, on an empty app, and can
assume nothing is set up. Tips run out of order, on a full app, against state
the user built. Sharing the RENDERER is plausible; sharing the sequencing is
probably a mistake, and merging them before the tip half exists would be
designing the shared abstraction from one example.

## What it must not become

- A tour that runs on every launch.
- A second changelog. The changelog is the changelog; a tip is a pointer.
- A reason to ship a control that cannot be found on its own. If a feature
  needs a tip to be usable, the tip is a patch over a placement problem, and
  the placement is the thing to fix.

## Open questions

1. Point at the element, describe it in prose, or just open the surface?
2. Authored by hand per feature, or derived from the changelog?
3. How many tips may one upgrade spend? Who decides which survive the cut?
4. Is "already using this" required for v1, or is dismissal enough?
5. Shared renderer with the welcome wizard, or deliberately separate?
