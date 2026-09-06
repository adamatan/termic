# Agent credentials: several accounts per agent, swapped in the OS store

Status: approved 2026-09-05 in
[#278](https://github.com/simion/termic/issues/278).

**Phase 2 of two, and a separate delivery.** Phase 1 is
[profiles.md](profiles.md). The two features compose but neither blocks the
other: profiles ship with the single shared login every agent already has,
and this lands afterwards without changing anything in the profiles data
model. Do not merge the two into one release.

Profiles answer "keep my work and personal contexts apart". This answers "my
account hit its 5-hour limit and I want to keep going, in this conversation,
right now".

## Settled

From the #278 thread. These are decisions.

1. **Swap the credential, never the history.** The session transcript must
   not move: the user is mid-conversation when they hit the limit. A profile
   does get its own config dir, because that is the only thing the credential
   store is keyed by, but the dir is a container for the credential and
   nothing else. `projects/` and `history.jsonl` are symlinks to the primary,
   so conversations are shared across every profile and every account, and a
   switch never relocates a session file. Revised 2026-09-05: an earlier
   draft banned relocation outright, which is the right instinct aimed at the
   wrong target.
2. **Each profile has its own set of credentials, with a default one**, and
   therefore its own config dir, because the credential store is keyed by
   the config dir and there is no other way to hold two live accounts. The
   dir carries ONLY the credential and identity: everything else is
   symlinked back to `~/.claude`, so no setting is ever duplicated. See "The
   profile dir is a symlink farm".
3. **An account is added once per REALM, and shared by name.** Revised
   2026-09-06: the store is keyed by the account's name
   (`logins/<agent>/<name>/`), so two profiles using the same name resolve to
   the same directory and the second is already signed in. Re-entering the
   same account per profile stays rejected, for the reason it always was: the
   copies drift and one profile ends up on a stale token. What DOES require a
   second sign-in is the other realm, because Docker never reads the host's
   config dir. See "Where it lives, and how a login is keyed".
4. **Optional auto-switch when a limit is reached**, and **the rotation pool
   is per profile**. A work profile rotates among work accounts and never
   falls back to a personal one, because that mixes billing and defeats the
   reason the profiles exist. The per-profile config dir makes this
   enforceable rather than advisory: a profile can only ever stage a
   credential into its own store.
5. **The UI says which account a session is on**, and says so again when a
   switch happens. Picking the account with the most headroom is a bonus
   over "the next one that is not maxed out"; the latter already solves the
   pain.

## The shape of the feature: an account switcher, nothing wider

Directed 2026-09-06. This ships as a **credentials / account switcher**. The
only noun the user or the code models is a LOGIN. Config-dir relocation is the
private mechanism that realises one, and it must not surface as a concept, a
setting, or an abstraction anyone can reach.

That distinction is easy to lose, because the mechanism is genuinely general:
every agent is isolated by pointing an env var at a directory, and it would be
a short step to ship "per-agent environment overlays" and call accounts a use
case. **Do not.** A generic config switcher is a bigger surface, a worse
explanation, and it invites states nobody designed (half-shared dirs, an
account pointing at a path the user typed). termic already has the general
thing for people who want it, in agent CLONES with their own `env` map.

Concretely, in scope:

- add an account, remove an account, list accounts, choose the default
- see which account a session is running on, and switch a live one

Concretely NOT in scope, and each of these is a way the feature would drift:

- any UI naming a directory, a path or an env var
- adopting an existing config dir as an account
- exporting, backing up or importing a credential
- per-account settings, models, or anything that is not a login

### The rule that makes it small: termic never handles a secret

Adding an account creates an EMPTY store and runs **the agent's own login
command** inside it. The agent then writes its own credential wherever it
likes, file or keychain, exactly as it does normally. Removing an account runs
the agent's own logout and drops the store.

termic never reads, copies, seeds or writes a credential. That is what the
earlier draft got wrong: it contemplated staging `.credentials.json` and
writing Keychain items directly, which is the part that carried the access
prompts, the lock-interleaving worry, and most of the ToS exposure. None of
that is needed to switch accounts, so none of it should be built.

It also collapses the per-agent difference to two facts: where to point the
agent, and what its login command is called. An agent nobody has mapped in
detail still works if it has a relocation variable.

## Where it lives, and how a login is keyed

Directed 2026-09-06.

**Accounts hang off the AGENT, not a global Accounts page.** Adding a second
login is a per-agent decision, so the surface is the agent's own card in
Settings -> Agents: a row directly under the card header (icon, name, id,
`extends` badge) and above the command fields. "Who is this signed in as" reads
before "how does it run", and there is no separate page to find.

**The credential set is defined once per agent.** The list of account names and
which one is default live on the agent entry, so they are profile-scoped for
free: `settings.agents[]` is already per profile after phase 1, and a work
profile naming a different default is the whole point.

### The store is keyed by NAME, and that is what shares a login

```
<data>/logins/<agent>/<name>/               the host login
<data>/docker-agents/<agent>/<name>/        the Docker login
```

No generated ids. The name IS the key, and the sharing falls out of it: two
profiles that both use an account called "Work" resolve to the same directory,
so the second one is already signed in. Nothing selects, syncs or copies a
credential; they simply address the same path.

**Two realms means two logins, and that is expected rather than a gap.** Docker
mode deliberately never touches the host's real config dir (`docker-agents/` is
termic-owned, pinned by `the_docker_login_dir_is_termic_owned_never_the_real_home`),
so a login performed on the host is not visible inside a container and vice
versa. A user signs in once per realm, and each realm then shares that login
across every profile. Presenting this as one account with two sign-in states is
honest; presenting it as one login that mysteriously does not work in Docker is
not.

### The name is frozen at creation, for a measured reason

Keying on the name means the name is a path, and for claude the path is
load-bearing beyond the filesystem: its Keychain service is
`Claude Code-credentials-<sha256(config_dir)[..8]>`. Rename the account, the
directory moves, the hash changes, and the credential can no longer be found.
The user is silently logged out of an account that is still perfectly valid.

So renaming is not offered. Remove and add, which is honest about what it costs
(one sign-in) instead of hiding a logout behind an edit. This is the same rule
as a profile's slug, arrived at from a different direction: both are names that
key a directory something else is derived from.

Names are slugified the same way profile slugs are (lowercase, filesystem-safe,
deduped), for the same reason: they become a path segment.

### Three surfaces, and which one discovers what

**The usage popover is the primary discovery vector**, and it is the best one
available because of WHEN it is open: a user clicks the usage chip when they
are near a limit, which is the exact moment a second account becomes
interesting. It gets a row: **"Add a different set of credentials..."**, opening
Settings at that agent's card.

`UsageChip` already anticipates this. Its icon comment says "two DIFFERENT
agents are told apart right here... two accounts of the SAME agent are told
apart in the popover", and its `agentId` prop is documented as "the agent ENTRY
id (a clone keeps its own), which is the account key". That clone-as-account-key
is precisely the workaround this feature replaces, so the popover becomes the
account surface it was already described as, and the key becomes
(agent, account) instead of the entry id.

It also already solves the realm problem: the `docker` prop exists because a
caged codex "logs in INSIDE the container, so its quota belongs to the config
dir termic mounts there, not to the host's `~/.codex`. Reporting the host's
would put another account's number under this task's name." That is the same
two-realm rule this document arrived at separately, already implemented.

**But it cannot be the only vector.** The chip renders `null` until an account
has actually reported, deliberately, so that an agent with no usage feed costs
the footer nothing. Today only claude (status line) and codex (app-server)
report, so six of the eight built-ins never show it at all.

| Surface | Job | Covers |
|---|---|---|
| Usage popover row | discovery at the moment of need | claude, codex |
| Row at the top of the agent's card | discovery and management | all eight |
| Account pill, appears at 2+ | see which account, switch it | all eight |

### Why the pill is not always visible

Tempting, and it was considered: a permanently visible pill would make the
feature obvious. It founders on naming.

Before a second credential set exists there is no account concept at all. The
user has "whatever claude is logged into" and has never named it, so an
always-visible pill has to invent a label for it. Calling it "Default" is
exactly the trap profiles avoided: the strip there does not exist until the
first profile is created, and creating it NAMES the existing install in the
same step.

Accounts take the same answer for the same reason. The pill appears when the
second credential set is added, and that flow names the existing login at the
same moment ("your current login" becomes "Personal", or whatever the user
calls it). Nothing is ever labelled with a name the user did not choose, and
the footer costs no width for the single-login case, which is the
overwhelmingly common one and the case `UsageChip`'s own self-hiding rule was
written for.

### What a profile actually owns

Not logins. It owns the list of account names offered for an agent and which is
default. An account named in a profile that has never been signed in on this
machine is a legitimate state and must read as "not signed in" rather than
fail: that is exactly what a second machine, or the Docker realm before its
first login, looks like.

## What is measured

Reproduced 2026-09-03 against `claude 2.1.259`. This is the evidence the
design has to survive.

### A claude credential is two halves, in two places

- **The token** is a macOS Keychain item. Service name is
  `Claude Code-credentials` for the default config dir (and
  `Claude Code-credentials-<sha256(config_dir)[..8]>` for a relocated one,
  which decision 1 means we will never produce). The blob holds
  `accessToken`, `refreshToken`, `scopes`, `subscriptionType` and
  `rateLimitTier`.
- **The identity** is `.claude.json` under `oauthAccount`, at `~/.claude.json`
  for the default config dir (it folds INSIDE the dir only when relocated,
  which decision 1 means never):
  `emailAddress`, `organizationName`, `accountUuid`, `organizationUuid`.
  This is what `claude auth status` prints and what any UI would show.

**Writing only the Keychain half produces a lie, and this was measured.**
`CLAUDE_SECURESTORAGE_CONFIG_DIR` is the built-in knob that splits exactly
this way, and with it pointed at a second account, `claude auth status`
reported the FIRST account's email and organization together with the SECOND
account's `subscriptionType`. Token from one, every visible identity field
from the other: requests billing one org while the screen names another.

So a switch writes **both halves**, always: the blob into the Keychain item,
and `oauthAccount` into `.claude.json`. Writing one and not the other
reproduces the measurement above. Independently corroborated: Symbioose's
switcher restores its Keychain backup AND updates `~/.claude.json`, and
claude-swap warns that a whole-file restore is wrong for the opposite reason,
since `.claude.json` also holds account-INDEPENDENT OAuth state (MCP server
logins) that an older snapshot would clobber. Patch the `oauthAccount` key,
never replace the file.

### Session ids survive, because nothing moves

Two failure modes constrain any account switch, both measured, both silent
process exits:

- `--resume <uuid>` when the file is absent from that config dir prints
  `No conversation found with session ID: <uuid>` and exits. In a PTY that
  is a dead agent tab.
- `--session-id <uuid>` when the id already exists prints
  `Error: Session ID <uuid> is already in use.` and exits.

Swapping in place sidesteps both. The config dir is unchanged, the session
file is where it was, `TerminalTab.sessionId` stays valid, and the resume
arguments do not change. This is the concrete payoff of decision 1: the
rejected alternative has to copy an up-to-11MB `.jsonl` into the other
account's tree first, and that copy re-sends the entire prior transcript to
the other account's org.

### A switch does NOT require a respawn, and that is the problem

Corrected 2026-09-05 by research into prior art. The original assumption here
was that claude reads its credential once at startup and holds it. It does
not.

claude keeps the Keychain value in an in-memory cache with a **30 second
TTL** (`KEYCHAIN_CACHE_TTL_MS = 30_000`), so a running session picks up a
swapped credential once that cache expires, with no restart. `claude-swap`
documents the same behaviour from the outside ("on macOS, credentials live
in the Keychain, which Claude Code caches for about 30 seconds"), and
Linux/Windows are stricter still: credentials are a file there and claude
re-reads it whenever it changes.

The good half: a switch needs no respawn, and the session id never has to
move.

The bad half, and it is decisive: **the swap is machine-wide.** Within 30
seconds, every running claude on the machine is on the newly written
account, in every task, in every profile window. There is exactly one
Keychain item for the default config dir, and every process reads it on a
30 second loop.

## Why one shared config dir cannot work, and what replaces it

Start from the shape that looks simplest: every profile shares `~/.claude`,
and termic just writes the one Keychain item. Combined with the 30 second
cache above:

**It delivers, cleanly:**

- Switching the machine to another account without a browser login, without
  moving a directory, and without losing the conversation. The config dir
  never moves, so the session file stays where it is and `--resume` keeps
  working. This is the core ask in #278 and it works.
- Switching a session that is ALREADY RUNNING, mid-task, within 30 seconds.
  Better than the original plan assumed.
- Auto-switch on limit, since the same write is all a rotation needs.

**It cannot deliver, at all:**

- **Two profiles on two accounts at the same time.** The item is global and
  every process re-reads it every 30 seconds, so there is no such thing as
  staging a credential "for one spawn". Ten seconds after a work-profile tab
  switches accounts, the personal-profile window on the other monitor is on
  that account too. Decisions 2 and 4 describe a state this shape cannot
  hold, which is why it is not the one being built.

The Keychain service name is derived from the config dir
(`Claude Code{suffix}{dirHash}`), so the ONLY way to get two live accounts on
one machine is two config dirs. That is what every project that ships
parallel accounts does, without exception (see "Prior art"). It is also the
architecture Anthropic has publicly accepted.

**Decided 2026-09-05: per-profile config dir, and the dir holds nothing but
the credential.** The objection to config dirs is real and was measured
here: a second config dir carries its own `settings.json` (permissions,
hooks, plugins), `CLAUDE.md`, `commands/`, `agents/`, `skills/`, MCP list,
trust flags and history, and they drift silently. On the machine used for
the 2026-09-03 research, the second dir had no `permissions` block and none
of the `PreToolUse` hooks the default dir had, so every session on that
account had been running without the allowlist and without the hook, with
nothing on screen saying so.

The answer is not to avoid config dirs. It is to make the profile's dir a
**symlink farm**: it owns the credential and the identity, and every other
entry points back at `~/.claude`. This is what the projects that ship
parallel accounts actually do, and one property makes it work.

### The profile dir is a symlink farm

**Claude's settings writer follows symlinks and writes THROUGH to the
target.** An in-session `/config` change made in any profile lands in
`~/.claude/settings.json`, and every other profile sees it immediately,
because they are all the same file. Drift is not mitigated, it is
impossible: there is one copy.

The split, taken from `claude-swap`'s session bootstrap, which is the most
carefully worked example in the wild:

| Entry | Treatment | Why |
|---|---|---|
| `settings.json` | symlink | permissions, hooks, plugins. One copy or the drift measured above comes straight back. |
| `keybindings.json` | symlink | machine preference, not per account |
| `CLAUDE.md` | symlink | one set of instructions |
| `skills/`, `commands/`, `agents/` | symlink | user-authored assets, configure once |
| `projects/`, `history.jsonl` | symlink | **unified conversation history.** The `/resume` picker is cwd-scoped, so a task still only ever lists its own directory's sessions. This is what makes an account switch lossless. |
| `.credentials.json` | REAL, profile-owned | the whole point; seeded, then migrated into that dir's own Keychain item |
| `.claude.json` | REAL, profile-owned | fuses per-account identity (`oauthAccount`) with trust flags and MCP OAuth state, so it cannot be one file |
| `sessions/`, `ide/`, `shell-snapshots/`, `statsig/`, `plugins/` | NOT shared | PID tracking, instance and telemetry scoped |

Track what termic created in a manifest beside the farm, the way
`.cswap-shared.json` does, so removing a profile never deletes a symlink
target or user-accumulated data.

### The credential lands without a browser login

macOS keeps the credential in the Keychain, but `~/.claude/.credentials.json`
is a first-class fallback in the same JSON format, and **on macOS claude
consumes that file and migrates it into the Keychain item for that config
dir**. So seeding is: write the blob as `.credentials.json` in the profile's
dir, delete any stale Keychain entry for that dir's hash, and let claude
migrate it on first use. That is exactly `claude-swap`'s bootstrap, and it is
why adding an account is a one-time login (decision 3) rather than one per
profile.

It also means the file is a seed, never a store: it disappears on macOS. Do
not build anything that expects to read it back.

### What each profile gets, and what it costs

Each profile dir hashes to its own Keychain service
(`Claude Code-credentials-<sha256(dir)[..8]>`), so two profile windows hold
two live accounts with no contention, and the 30 second cache means a switch
inside one profile reaches its running tabs without a respawn and without
touching the other window.

The residual costs, both in `.claude.json` and both worth stating plainly:

- **MCP servers.** Mirror the `mcpServers` key from the primary into each
  profile's `.claude.json`, under an adoption marker so removing the mirror
  never eats a profile-local definition, and take claude's config lock while
  writing. Again, `claude-swap` already does exactly this.
- **Trust flags.** `hasTrustDialogAccepted` is per (config dir, project), so
  a new profile prompts on first open of a project the primary already
  trusts. Seed it when termic creates the profile dir, or the trust prompt
  swallows the first injected prompt.

### Also considered and dropped

- **Symlinking the credential itself**, the way `codex-accounts` re-points
  `~/.codex/auth.json` at the selected account's file. Ideal, and impossible
  for claude on macOS: the credential is a Keychain item, and the file form
  is deleted and migrated into the Keychain on first use. It stays the right
  answer for CODEX, where the credential IS a file and codex's in-place
  refresh then writes through to the account's own copy. Requires
  `cli_auth_credentials_store = "file"`.
- **One shared config dir with a machine-wide swap.** Considered and
  rejected: the Keychain item is global and every claude process re-reads it
  every 30 seconds, so an account switch in the work window drags the
  personal window with it. It cannot hold decisions 2 and 4.
- **`CLAUDE_SECURESTORAGE_CONFIG_DIR` per PTY.** Would relocate only the
  credential half, giving per-profile accounts with one shared config dir.
  Measured 2026-09-03: it reported the first account's email and organization
  with the second account's `subscriptionType`. Undocumented, absent from the
  public environment reference, removable without notice. The symlink farm
  reaches the same place on documented behaviour.
- **`CLAUDE_CODE_OAUTH_TOKEN` per PTY.** Sits above the Keychain in claude's
  credential priority order. Rejected on evidence: inference-only
  (`refreshToken: null`, `expiresAt: null`, `scopes: ['user:inference']`), so
  it cannot refresh and a long-lived task dies when it expires. `claude-swap`
  actively scrubs it from child environments to stop it hijacking the
  selected account.

## Prior art, researched 2026-09-05

Every one of these ships today. Between them they have already answered most
of the open questions in the original draft of this doc.

| Project | Switch mechanism | Parallel accounts | Notes |
|---|---|---|---|
| [claude-swap](https://github.com/realiti4/claude-swap) | Keychain slot swap | yes, via per-session `CLAUDE_CONFIG_DIR` | Ships BOTH mechanisms because neither alone does everything. Holds claude's own credential locks while writing so a swap never interleaves with a refresh. `--share-history` symlinks `projects/` + `history.jsonl` so all accounts see one history. |
| [claude-account-switcher](https://github.com/Symbioose/claude-account-switcher) | Keychain: backs accounts up under `claude-switcher:{email}`, restores into `Claude Code-credentials`, and updates `~/.claude.json` | no | Confirms the two-halves rule independently. Codex: whole `~/.codex/auth.json` backed up per email, restored at `0600`, requires `cli_auth_credentials_store = "file"`. Auto-switch at 100%, same provider only, off by default. |
| [claude-multi](https://github.com/Chamanrajragu/claude-multi) | per-account `CLAUDE_CONFIG_DIR` | yes | The closest analogue to termic (a desktop app). On a limit error it reads the reset time, marks a cooldown, COPIES the transcript to the next account and re-issues the interrupted instruction with `--resume`. |
| [ccswitch](https://github.com/vyshnavsdeepak/ccswitch) | Keychain via `security(1)` | no | Restart required, per its own docs. |
| [codex-accounts](https://github.com/omarhoumz/codex-accounts) | SYMLINKS `~/.codex/auth.json` at the account's own file | yes, via `CODEX_HOME` | The symlink is the elegant part: codex refreshes the token in place, so the write lands in the account's own file and nothing goes stale. `config.toml` stays shared by symlink. |
| [codex-multi-auth](https://github.com/ndycode/codex-multi-auth) | wrapper binary, routing state under `~/.codex/multi-auth/` | n/a | Health probes, quota cache, cooldown on repeated 5xx bursts. |

Two things worth stealing outright:

- **codex-accounts' symlink.** For codex, termic needs no env var and no
  vault: point `~/.codex/auth.json` at the selected account's file and let
  codex's own in-place refresh write through to it. Decision 1 is satisfied,
  sessions stay in `~/.codex`, and the staleness problem does not exist.
  Requires `cli_auth_credentials_store = "file"` so the credential is not in
  the OS keyring.
- **claude-swap's credential lock cooperation.** It takes claude's own lock
  while writing so a swap can never interleave with a token refresh. That is
  the shape to copy, and it replaces the "hold a lock past exec" idea an
  earlier draft of this doc had.

(Its `--share-history` symlinking of `projects/` and `history.jsonl` is
noted only for the record: it exists to undo the damage of per-account config
dirs, which this plan does not create.)

## Reaching the limit: offer, and optionally act

Directed 2026-09-06: BOTH must exist. An offer in the popover when the limit is
reached or close, and an opt-in that switches without asking.

The detection half already ships. `merge_statusline`
(`src-tauri/src/agent_hooks.rs`) claims claude's `statusLine` slot when it is
free or already ours, and claude pipes `rate_limits` (`five_hour` and
`seven_day`, each `used_percentage` plus `resets_at`) into it on every turn.
`src/lib/agentUsage.ts` parses that off the OSC channel; the codex half comes
typed from `codex app-server`.

### Session or weekly is already answered

`drivingWindow()` returns whichever window is CLOSEST TO ITS LIMIT, not
whichever is shorter, precisely so "30% of five hours next to 95% of the week"
reads as a warning. The switch trigger reads the driver, so it needs no new
logic and cannot be fooled by a fresh session window on a spent week.

### The threshold is a THIRD band, above the chip's own

`USAGE_WARN_PERCENT` is 70 and `USAGE_CRITICAL_PERCENT` is 90, and the chip
already turns red at 90. Hanging the switch offer on `critical` would make it
fire constantly and be trained away within a day. It needs its own band above
that: 95 by default, with 98 and "only when actually blocked" as the other
choices.

### Offering and acting are different mechanics, not one feature with a flag

They fire at different moments and cost different things, which is the reason
to build both rather than treat auto as offer-without-the-dialog:

| | Fires | In-flight work | Recovery |
|---|---|---|---|
| **Offer** (near the limit, e.g. 95%) | at the next TURN BOUNDARY, never mid-turn | nothing is lost: the user is not blocked yet | none needed, the switch is clean |
| **Act** (limit reached) | after the turn has already failed | already lost | switch, then resume the session |

A proactive switch must wait for the boundary, because there is nothing to
recover and interrupting a working turn to avoid a limit the user has not hit
is strictly worse than doing nothing. A reactive one happens after a failure,
where there is nothing left to lose. Auto-switching mid-turn on a THRESHOLD is
the one combination to refuse.

### The setting is per agent, like the credentials it switches

Accounts hang off the agent entry, so the threshold does too, and is
profile-scoped by the same inheritance. A work profile can auto-switch
aggressively while a personal one asks every time.

### Six of the eight agents cannot have this, and the UI must not pretend

Proactive switching needs a usage feed, and only claude and codex have one:
`UsageChip` renders nothing for the rest, and there is no number to threshold.
For those six the only honest trigger is the agent failing, and detecting THAT
means pattern-matching agent output, which is fragile enough that it should not
be the thing a promise rests on.

So: offer and auto for claude and codex, and no setting shown on an agent that
cannot honour it. An auto-switch toggle that silently never fires is worse than
its absence.

**Manual switching is universal and first-class, not the fallback for the six.**
Every agent gets multiple credential sets and a ONE-CLICK switch: the pill lists
the accounts, clicking one switches to it. No submenu, no confirmation, no trip
through Settings. Auto-switching is a convenience layered on top for the two
agents that can measure themselves; the manual path is the feature, and it is
the same interaction on all eight.

That ordering matters for the build: the switch has to work by hand for
everything before any threshold logic exists, which is why P4 (switch a live
tab) precedes P5 (auto) and does not depend on it.

### Still true from the first pass

- **Auto behind an explicit opt-in**, off by default. A false positive burns
  the second account's quota too, which is the thing the feature exists to
  protect.
- **Order the pool by headroom** when usage is known, falling back to the first
  entry that is not maxed.
- **Never leave the profile's pool.** If every account in it is maxed, say so
  and name the earliest `resets_at` rather than reaching for an account
  belonging to another profile.

## Per agent: all eight built-ins, measured 2026-09-06

All eight, copilot included (installed for this pass). Method unchanged: point
the candidate variable at an empty dir and see whether the CLI loses its login.

| Agent | Credential | Isolation boundary (measured) | Two live at once |
|---|---|---|---|
| claude | macOS Keychain, service `Claude Code-credentials-<sha256(dir)[..8]>` | `CLAUDE_CONFIG_DIR`, whole dir | **yes**, the hash keys a separate slot per dir |
| codex | `$CODEX_HOME/auth.json` | `CODEX_HOME`, whole dir | yes, plain file |
| copilot | under `$COPILOT_HOME` (default `~/.copilot`) | `COPILOT_HOME`, whole dir. **Also `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN`, which take precedence over stored credentials** | yes, by either route |
| agy / gemini | `$DIR/oauth_creds.json` + `google_accounts.json` (`{active, old[]}`) | `GEMINI_CLI_HOME`, a PARENT: it appends `.gemini` | yes, plain files |
| grok | `$GROK_HOME/auth.json`, keyed `<issuer>::<uuid>`, one entry per account carrying both halves | `GROK_HOME`. Auth follows it; the BINARY and bundled skills do not | yes, plain file |
| opencode | `$XDG_DATA_HOME/opencode/auth.json` + SQLite | `XDG_DATA_HOME` only, a generic root other tools read too | yes, but the variable is broader than the agent |
| pi | `~/.pi/agent/auth.json`, keyed by provider, `accountId` beside `access`/`refresh`/`expires` | **`HOME` override only.** No dedicated variable exists | yes, plain file |
| muse | **OS keychain.** `~/.config/muse/auth.json` is the INDEX (`storage: "keychain"`, plus `mechanism`, `obtained_via`, `user_email`); no secret is in the file | `XDG_CONFIG_HOME` moves the index, which is enough to isolate | **unresolved**, see below |

### Not one of the eight exposes an account switch

The first pass hoped the agents that model several accounts internally would
expose a switch worth driving. Measured, they do not:

- `claude auth` is `login` / `logout` / `status`.
- `grok` has `login` / `logout`, no switch, though its `auth.json` is keyed per
  account and holds several.
- `opencode auth` is `list` / `login` / `logout`.
- `pi auth` is read-only introspection (`print-api-key`, `print-bearer-token`,
  `check`); it refreshes an expired OAuth credential but selects nothing.
- gemini has no account flag, though `google_accounts.json` is literally
  `{"active": <string>, "old": []}`.

"Models several accounts" means the FILE FORMAT holds several. No CLI picks
between them. So relocation is the mechanism for every agent, and the tier that
would have avoided it does not exist. Worth stating plainly, because it is the
one thing a reader would otherwise assume from the file formats.

### muse is the open question

Its metadata file says `storage: "keychain"` and carries no secret, so the
credential is in the OS keychain like claude's. But no item under a muse-ish
service name appears in `login.keychain-db`, which claude's four
`Claude Code-credentials-<hash>` items do, so muse is likely using the
data-protection keychain that `security(1)` cannot enumerate the same way.

**What is unresolved is whether that item is keyed per config dir.** If it is,
muse behaves like claude and two accounts can be live at once. If it is one
fixed item, muse can only ever switch serially, however many config dirs exist.
Relocating `XDG_CONFIG_HOME` isolates the INDEX, which is not the same thing.
Decide this by measurement before promising muse parallel accounts.

### copilot is the easy one, and the only true credentials-only case

`COPILOT_GITHUB_TOKEN` (or `GH_TOKEN` / `GITHUB_TOKEN`) takes precedence over
whatever is stored, and a GitHub token is long-lived. That is a real
credentials-only swap with no directory involved, and it is exactly what
`CLAUDE_CODE_OAUTH_TOKEN` failed to be for claude (inference-only, no refresh).
Documented rather than measured here: the account it would authenticate is the
maintainer's, so a real login was not performed.

## Keychain access: answered, with a catch

The original draft listed "does writing claude's Keychain item prompt the
user?" as the question that gates everything. It is answered, from two
directions, and both matter:

- **No prompt, if you go through `/usr/bin/security`.** claude creates the
  item with `security add-generic-password` and no access-control arguments,
  so the trusted application on the item's ACL is the `security` binary
  itself. Any process can therefore read it
  (`security find-generic-password -s "Claude Code-credentials" -a "$USER" -w`)
  or replace it (`-U`) with no Touch ID, no password, no notification. This
  is documented as a security weakness rather than a feature
  ([Silverfort](https://www.silverfort.com/blog/skipping-the-lock-a-claude-code-cli-weakness-lets-any-macos-process-read-stored-credentials/)),
  and it is why the community switchers all shell out to `security`.
- **Prompts, and repeatedly, if you use the native Keychain APIs.** A signed
  app reading the item with `SecItemCopyMatching` gets the standard prompt,
  and "Always Allow" does not stick: claude DELETES AND RECREATES the item on
  every token refresh (roughly every 8 hours), which resets the ACL and
  re-prompts. CodexBar hit this 5-10 times a day and asked Anthropic for a
  usage cache or a `claude auth token` export;
  [the request was closed as not planned](https://github.com/anthropics/claude-code/issues/22144).

So: **shell out to `security`, never `SecItem*`**, and expect the item to be
deleted and recreated underneath termic every few hours. Anything cached by
item identity rather than re-read is wrong.

## One more risk to weigh: what Anthropic actually bans

Worth stating explicitly, since this ships in a public product. Anthropic's
position, as reported by its own Claude Code team, is that holding several
Max accounts is NOT a terms violation. What draws suspensions is routing
subscription OAuth tokens through third-party clients and relay servers that
impersonate the official client.

The architecture Anthropic has publicly accepted is the one where each
account authenticates through the official OAuth flow and the official
binary does the talking, isolated per `CLAUDE_CONFIG_DIR` (a variable
documented in Anthropic's own environment reference). termic running the
real `claude` binary keeps it on the right side of that line either way,
since termic never speaks to the API itself. But note that option 2 above is
literally the blessed pattern, while lifting the token blob out of the
Keychain and planting it elsewhere is the part no vendor has blessed. That
is a product risk to weigh, not a legal opinion.

## Macro plan

Five layers, and only the middle one is a noun anyone outside the module says.

**L1. `LoginStore`, private.** How to point one agent at one store. Six shapes,
all measured, and the list is closed by what the fleet actually does:

```
ConfigDir { env }              claude, codex, copilot, grok
ParentDir { env, suffix }      gemini / agy   (the var is a PARENT: it appends .gemini)
XdgData   { env }              opencode       (generic root, shared with other tools)
XdgConfig { env }              muse           (moves the index; see the open question)
HomeOnly                       pi             (no dedicated var; HOME override, measured)
TokenVar  { vars }             copilot        (GH token takes precedence, no dir at all)
```

This extends `agent_dirs`, which already resolves *dedicated var -> HOME
override -> default*. Two shapes it cannot express today are the parent
semantics and the token route. No UI, no account model: a pure function from
(agent, store path) to an env overlay, with a unit test per shape.

**L2. `Account`, the only public noun.**

```
Account { id, agent_id, label, identity (cached), added_at, last_used_at }
```

Note what is absent: no path, no env, no credential, no config dir. Where the
login lives is derived from the id by L1, never stored. Accounts belong to a
PROFILE, which is what makes the rotation pool per profile without a second
mechanism.

**L3. Verbs, all of them login verbs.** `account_add` creates an empty store
and spawns the agent's own login command in a PTY (termic already spawns PTYs;
this is one without a task). `account_remove` runs the agent's own logout, then
drops the store. Plus list, set-default. There is deliberately no verb that
takes a path.

**L4. Spawn integration.** `pty_spawn` already composes an env overlay for an
agent entry. It gains one line: the selected account's overlay from L1. This is
the whole runtime cost of the feature.

**L5. Non-duplication.** For the agents whose store is a whole config dir, the
new dir gets symlinks back to the primary for settings, instructions, skills,
commands and history, so a second account does not fork the user's setup. This
is invisible: the user never learns a directory exists.

### P1 has shipped, and how it survives agents changing under us

`agent_dirs::login_store` is the table, with six measured shapes
(`ConfigDir`, `SelfHostingDir`, `ParentDir`, `XdgRoot`, `HomeOnly`,
`TokenVar`), plus `login_env` (what to set) and `login_config_dir` (where the
agent will actually write, which differs from the store for the three shapes
that append). `config_relocation_env` is DERIVED from it rather than kept as a
second table.

`SelfHostingDir` exists because grok forced a distinction that looked like one
fact and is two: `GROK_HOME` does move grok's login (measured), but its binary
and bundled skills live in that same tree, so the directory can never be a
Docker mount target. An existing test caught the conflation the moment grok
was typed as a plain `ConfigDir`.

Three guards keep this honest as agents ship changes, which is the whole
maintenance risk of a table describing other people's software:

- **`every_builtin_agent_has_a_measured_login_store`** fails when a built-in
  is added without a row, so adding an agent forces the measurement instead of
  deferring it. `None` stays a legitimate answer: an agent whose boundary
  nobody has measured must NOT get a switcher that silently shares one login.
- **`docker_only_ever_sees_the_shape_it_can_actually_honour`** pins that only
  `ConfigDir` reaches `config_relocation_env`. Docker sets that variable to
  the container path it mounted, so a `ParentDir` would write one level below
  the mount and an `XdgRoot` would redirect unrelated tools in the container.
- **`make login-probe`** is the one that catches REAL drift. Unit tests only
  prove the table is self-consistent; the probe points each variable at an
  empty directory against the actual installed CLI and asserts it reports
  itself signed out. Local only, never CI, same rule as `make lsp-smoke`,
  because it needs the CLIs installed and logged in. It reads no credential:
  it only observes whether the agent thinks it has one.
  `the_probe_covers_every_agent_with_a_measured_login_store` fails when the
  table gains an agent the probe does not check, so the two cannot drift apart.

Run on 2026-09-06: seven agents probed, zero drift, copilot skipped (it has no
read-only auth command; `COPILOT_HOME` is documented rather than measured).

### Order, and what each step is worth alone

| | Step | Ships what |
|---|---|---|
| P0 | Measure muse's keychain keying | decides parallel vs serial for one agent; blocks promising either |
| P1 | L1 tables + resolution | nothing user-visible, fully unit-tested |
| P2 | L2 + L3: accounts, add / remove / list | a user can hold two logins for an agent |
| P3 | L4 + "signed in as" in the UI | new tasks and tabs run on a chosen account |
| P4 | Switch a LIVE tab and resume | the actual #278 ask |
| P5 | Auto-switch on limit (optional) | the convenience on top |

P4 is the point of the feature and P1 to P3 exist to make it possible, so the
plan is not done at P3 even though P3 demos well.

### Known rough edges, carried forward rather than discovered later

- **opencode** rides `XDG_DATA_HOME`, which other tools in the same shell read.
  Setting it for an agent spawn is broader than the agent, and the UI should
  say so rather than pretend it is agent-local.
- **pi** has only a `HOME` override, so its store has to be a home-shaped
  directory with enough in it that the agent does not misbehave for reasons
  unrelated to login.
- **muse** is unresolved (P0).
- **copilot** can go the token route with no directory at all, which is
  cheaper, but it is a different auth path from `copilot login`. Decide whether
  consistency with the other seven is worth more than skipping the directory.

## Open, in the order that decides the design

1. **Claude's own credential lock.** `claude-swap` holds it so a swap never
   interleaves with a refresh, and claude's refresh path is a three-stage
   check ending in a file lock with 1000-2000ms jittered backoff and five
   retries. Find the lock's path and take it the same way. Writing the item
   without it races an 8-hourly refresh.
2. **Refresh-token rotation:** does claude invalidate the previous refresh
   token when it rotates? If it does, a stored blob for an account in use
   elsewhere goes dead rather than merely stale.
3. **Blind writes:** can a blob be written for an account that has never
   logged in on this machine, or does the first use need a real login? It
   decides how "add an account" feels.
4. **Failure UI:** rejected blob, expired token, an account deleted from
   Settings while a tab is running on it. Note the precedent: Symbioose's
   switcher refuses to restore a stale codex session and demands a re-login
   rather than half-restoring it.
