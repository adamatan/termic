//! Single source of truth for "where does this agent's persistent state
//! actually live". Two very different consumers used to hand-maintain
//! their own copy of this and could silently drift apart:
//!
//! - Seatbelt's default `Agent.sandbox_allowed_paths` (`lib.rs`'s
//!   `default_agents()`) — real `$HOME` paths on the host, allow-listed
//!   for `sandbox-exec` to read/write directly.
//! - Docker's per-agent config-dir mount (`docker.rs`'s `agent_config()`)
//!   — container `/root` paths, bind-mounted from a termic-owned host dir
//!   that is never the host's real `$HOME`.
//!
//! Docker only wants the CONFIRMED state dirs (login, sessions, MCP
//! config — the ones `docs/plans/docker-sandbox/findings.md` actually
//! verified hold real state): it mounts a termic-owned dir, not the real
//! `$HOME`, so persisting a cache dir there buys nothing. Seatbelt allows
//! these same dirs, PLUS its own macOS-only extras (XDG-style
//! `.config`/`.local/share` paths some agents may or may not ever use,
//! `Library/Application Support/*`, regex-covered sidecar files like
//! claude's `.claude.json`) that have no Docker-container equivalent and
//! stay hand-authored in `default_agents()`.
//!
//! Keeping the CONFIRMED subset here means a renamed or added state dir
//! is a one-line change in one place, not two files quietly falling out
//! of sync.

/// One agent's confirmed state dirs, relative to its home (`$HOME` on the
/// host, `/root` inside the Docker image — both conventions land on the
/// same relative subpath). Order matters for an agent with no config-dir
/// relocation env var: the FIRST entry is Docker's primary mount, every
/// entry after it is an `extra_dirs` mount alongside it.
/// Where THIS agent INSTANCE keeps its config on the host.
///
/// One resolver rather than a per-agent abstraction, deliberately. The pieces
/// are already data (`state_dirs`, `config_relocation_env`, and the hook
/// installer's `settings_rel`), and the only thing missing was somewhere that
/// composes them for a specific agent entry rather than for a built-in NAME.
/// A trait or a module per agent would buy no control that these tables do not
/// already give, and would turn "add an agent" from adding a row into
/// implementing an interface.
///
/// Three cases, most specific first:
///   1. the entry relocates its whole config with the agent's own env var
///      (`CLAUDE_CONFIG_DIR=~/.next-claude`), which is how a clone holds a
///      SECOND account. That path is the config dir, verbatim.
///   2. the entry overrides `HOME`, so the default dir hangs off that instead.
///   3. neither: the base's default dir under the real home.
///
/// Returns None only when the base agent has no known state dir at all, which
/// is the honest answer for an agent nobody has mapped.
pub fn instance_config_dir(
    agents: &[crate::Agent],
    agent_id: &str,
    home: &std::path::Path,
) -> Option<std::path::PathBuf> {
    let base = crate::docker::base_agent_id(agents, agent_id);
    let entry = agents.iter().find(|a| a.id == agent_id);
    if let Some(env) = entry.map(|a| &a.env) {
        if let Some(raw) = config_relocation_env(base).and_then(|var| env.get(var)) {
            let expanded = expand_home(raw, home);
            if !expanded.as_os_str().is_empty() {
                return Some(expanded);
            }
        }
        if let Some(h) = env.get("HOME").filter(|h| !h.is_empty()) {
            return Some(std::path::Path::new(h).join(state_dirs(base).first()?));
        }
    }
    Some(home.join(state_dirs(base).first()?))
}

/// `~` and `$HOME` in a user-typed env value. They type these by hand in
/// Settings, so a literal `~/.next-claude` has to become a real path rather
/// than a directory called `~` (which is what the file tree in the reporter's
/// screenshot was already showing).
fn expand_home(raw: &str, home: &std::path::Path) -> std::path::PathBuf {
    let t = raw.trim();
    if t == "~" || t == "$HOME" {
        return home.to_path_buf();
    }
    for prefix in ["~/", "$HOME/"] {
        if let Some(rest) = t.strip_prefix(prefix) {
            return home.join(rest);
        }
    }
    std::path::PathBuf::from(t)
}

/// A clone resolved against what it extends: every field it left EMPTY comes
/// from the parent, live, at read time.
///
/// A clone used to be a full COPY of the parent, made once. That is a snapshot
/// that rots: when a vendor renames a flag the built-in entry moves with the
/// app and every clone keeps the old value forever, silently, with no way for
/// the user to tell which of its seventeen fields they actually chose. It had
/// already happened here, a clone carrying the parent's literal `$HOME/.claude`
/// sandbox paths while its own config lived elsewhere, so the cage denied it
/// its own login.
///
/// EMPTY MEANS INHERIT, which is the rule `classifyAgentTitle` already uses for
/// per-field signal fallback, extended to the whole record rather than a second
/// convention. Cost of the choice, and it is the same one that doc records: "no
/// value at all" stops being expressible by clearing a field, because clearing
/// is how you ask for the parent's.
///
/// `id`, `extends`, `display_name` and `builtin` are the clone's OWN identity
/// and are never inherited. Resolution walks the chain, so a clone of a clone
/// works, and is depth-capped because ids are user-editable.
/// Per-LIST capability merge. Wholesale replacement would mean a clone that
/// overrides one flag list stops tracking the parent on every other, which is
/// the freeze this change exists to remove, one field down.
fn merge_caps(child: &mut crate::AgentCapabilities, parent: &crate::AgentCapabilities) {
    macro_rules! take_if_empty {
        ($($f:ident),* $(,)?) => { $( if child.$f.is_empty() { child.$f = parent.$f.clone(); } )* };
    }
    take_if_empty!(
        yolo_args, runtime_yolo_command, runtime_default_command,
        resume_args, session_id_args, resume_id_args, name_args,
    );
    // Signals are per-FIELD, matching `classifyAgentTitle`: overriding the
    // busy patterns must not silently drop the inherited idle ones.
    if child.signals.busy.is_empty() { child.signals.busy = parent.signals.busy.clone(); }
    if child.signals.idle.is_empty() { child.signals.idle = parent.signals.idle.clone(); }
    if child.signals.attention.is_empty() {
        child.signals.attention = parent.signals.attention.clone();
    }
    if child.signals.pending.is_empty() {
        child.signals.pending = parent.signals.pending.clone();
    }
}

/// A clone resolved against what it extends: every field it left EMPTY comes
/// from the parent, live, at read time.
///
/// A clone used to be a full COPY of the parent, made once. That is a snapshot
/// that rots: when a vendor renames a flag the built-in entry moves with the
/// app and every clone keeps the old value forever, silently, with no way for
/// the user to tell which of its seventeen fields they actually chose. It had
/// already happened here, a clone carrying the parent's literal `$HOME/.claude`
/// sandbox paths while its own config lived elsewhere, so the cage denied it
/// its own login.
///
/// EMPTY MEANS INHERIT, which is the rule `classifyAgentTitle` already uses for
/// per-field signal fallback, extended to the whole record rather than a second
/// convention. Cost of the choice, and it is the same one that doc records: "no
/// value at all" stops being expressible by clearing a field, because clearing
/// is how you ask for the parent's.
///
/// `id`, `extends`, `display_name` and `builtin` are the clone's OWN identity
/// and are never inherited. Resolution walks the chain, so a clone of a clone
/// works, and is depth-capped because ids are user-editable.


pub fn resolve_agent(agents: &[crate::Agent], id: &str) -> Option<crate::Agent> {
    let mut out = agents.iter().find(|a| a.id == id)?.clone();
    let mut cur = out.extends.clone();
    for _ in 0..8 {
        let Some(parent_id) = cur.filter(|p| !p.is_empty() && *p != out.id) else { break };
        let Some(parent) = agents.iter().find(|a| a.id == parent_id) else { break };
        if out.command.trim().is_empty() { out.command = parent.command.clone(); }
        if out.args.is_empty() { out.args = parent.args.clone(); }
        if out.icon_id.trim().is_empty() { out.icon_id = parent.icon_id.clone(); }
        if out.color.trim().is_empty() { out.color = parent.color.clone(); }
        if out.env.is_empty() { out.env = parent.env.clone(); }
        if out.docker_env.is_empty() { out.docker_env = parent.docker_env.clone(); }
        if out.sandbox_allowed_paths.is_empty() {
            out.sandbox_allowed_paths = parent.sandbox_allowed_paths.clone();
        }
        if out.sandbox_allowed_hosts.is_empty() {
            out.sandbox_allowed_hosts = parent.sandbox_allowed_hosts.clone();
        }
        if out.post_launch_capture.is_none() {
            out.post_launch_capture = parent.post_launch_capture.clone();
        }
        // Capabilities are the flags a vendor renames, so this is the field
        // the whole change is FOR. Merged per-list rather than wholesale: a
        // clone overriding `yolo_args` alone must still track the parent's
        // resume flags, or overriding one field silently freezes the rest.
        merge_caps(&mut out.capabilities, &parent.capabilities);
        if !out.work_done { out.work_done = parent.work_done; }
        cur = parent.extends.clone();
    }
    Some(out)
}

/// The env var that relocates an agent's ENTIRE config dir, when it has one.
///
/// This is how a duplicated agent holds a second account: the clone runs the
/// same binary with `CLAUDE_CONFIG_DIR` pointing somewhere else, so its login,
/// its settings and its hooks all live apart from the original's. Anything
/// keyed on the agent's default dir would put one account's hooks into the
/// other account's config, which is worse than not installing them.
///
/// Only agents that genuinely relocate everything are listed. grok has no clean
/// relocation env (binary, skills and config all share `~/.grok`), and the
/// others fold their HOME-root dotfiles into the same dir once relocated.
/// How ONE agent's login can be pointed somewhere else (GH #278).
///
/// This is the account switcher's whole per-agent knowledge, and it is
/// deliberately a table of FACTS rather than a per-agent abstraction: when an
/// agent moves its credential, the fix is one row here, not a new impl.
///
/// Every variant exists because an agent measured that way; there is no
/// speculative shape. See docs/plans/agent-credentials.md for the
/// measurements, and `login_store` below for which agent is which.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginStore {
    /// The variable IS the config dir. `CLAUDE_CONFIG_DIR=<store>`.
    ConfigDir { env: &'static str },
    /// The variable is a PARENT and the agent appends a fixed name to it.
    /// `GEMINI_CLI_HOME=<store>` puts the config in `<store>/.gemini`.
    /// Setting it to the config dir itself nests one level too deep.
    ParentDir { env: &'static str, child: &'static str },
    /// A generic XDG root the agent hangs its own directory off, and which
    /// OTHER tools in the same environment also read. Broader than the agent,
    /// which is a thing the UI has to admit rather than hide.
    XdgRoot { env: &'static str, child: &'static str },
    /// No dedicated variable at all: only a `HOME` override moves the login,
    /// so the store has to be a home-shaped directory.
    HomeOnly { child: &'static str },
    /// The variable moves the LOGIN, but that directory also holds the agent's
    /// own binary or bundled assets, so it can never be handed to Docker as a
    /// mount target: mounting an empty dir over it shadows the binary and the
    /// agent vanishes.
    ///
    /// grok is the whole reason this variant exists, and it is worth keeping
    /// separate from `ConfigDir` rather than adding a flag: the two facts
    /// ("the login follows this var" and "this dir is safe to relocate
    /// wholesale") look like one and are not, and conflating them is how the
    /// Docker mount would silently break.
    SelfHostingDir { env: &'static str },
    /// A token variable that takes precedence over whatever is stored, so no
    /// directory is involved at all. The cheapest shape, and the only one
    /// that is genuinely credentials-only.
    TokenVar { env: &'static str },
}

/// Where this agent's LOGIN can be relocated to, or `None` when nobody has
/// measured it.
///
/// `None` is honest, not a gap to fill with a guess: an agent whose boundary
/// is unknown must not get an account switcher that silently shares one login
/// between "accounts". `every_builtin_agent_has_a_measured_login_store` fails
/// when a new built-in arrives without a row, so adding an agent forces the
/// measurement rather than deferring it.
pub fn login_store(base_id: &str) -> Option<LoginStore> {
    use LoginStore::*;
    match base_id {
        // Measured: relocating the var moves the whole config dir, dotfile
        // included, and claude's Keychain service is keyed by a hash OF THAT
        // PATH, which is what lets two accounts be live at once.
        "claude" => Some(ConfigDir { env: "CLAUDE_CONFIG_DIR" }),
        "codex" => Some(ConfigDir { env: "CODEX_HOME" }),
        // COPILOT_HOME relocates the dir; COPILOT_GITHUB_TOKEN would skip the
        // directory entirely. The dir is chosen for consistency with the other
        // seven, and because it is the shape `copilot login` writes into.
        "copilot" => Some(ConfigDir { env: "COPILOT_HOME" }),
        // Measured: GEMINI_CLI_HOME=<tmp> created `<tmp>/.gemini/`. The var is
        // a PARENT. Pointing it at the config dir would nest.
        "agy" | "antigravity" => Some(ParentDir { env: "GEMINI_CLI_HOME", child: ".gemini" }),
        // Measured: the login follows GROK_HOME. But the BINARY (`~/.grok/bin`)
        // and bundled skills live in that same tree, so relocating the auth is
        // NOT the same as moving the dir, and Docker must keep declining it.
        "grok" => Some(SelfHostingDir { env: "GROK_HOME" }),
        // Measured: only XDG_DATA_HOME moved it. Generic, shared with other
        // tools in the same environment.
        "opencode" => Some(XdgRoot { env: "XDG_DATA_HOME", child: "opencode" }),
        // Measured: XDG_CONFIG_HOME moves the metadata index, which is enough
        // to isolate. Whether the KEYCHAIN item behind it is keyed per dir is
        // unresolved, so muse may be serial-switch only. See the plan.
        "muse" => Some(XdgRoot { env: "XDG_CONFIG_HOME", child: "muse" }),
        // Measured: no dedicated variable exists; a HOME override does isolate
        // it (`ready` became `credentials_not_configured`).
        "pi" => Some(HomeOnly { child: ".pi" }),
        _ => None,
    }
}

/// The variable that IS an agent's whole config dir, or `None`.
///
/// Derived from [`login_store`] rather than kept as a second table: two
/// hand-maintained copies is exactly the drift this module exists to prevent.
///
/// Only `ConfigDir` qualifies, and that restriction is load-bearing rather
/// than tidiness. Docker sets this variable to the container path it mounted,
/// so handing it a `ParentDir` would make gemini write to `<mount>/.gemini`
/// (one level below the mount, i.e. into the throwaway layer) and an
/// `XdgRoot` would redirect unrelated tools in the container.
pub fn config_relocation_env(base_id: &str) -> Option<&'static str> {
    match login_store(base_id) {
        Some(LoginStore::ConfigDir { env }) => Some(env),
        _ => None,
    }
}

/// The environment that points `base_id` at `store` for its login.
///
/// One place, so a caller never has to know which shape an agent is. Returns
/// empty for an agent with no measured boundary, which means "this agent
/// cannot hold a second account" and must be surfaced rather than silently
/// producing a shared login.
pub fn login_env(base_id: &str, store: &std::path::Path) -> Vec<(String, String)> {
    let Some(shape) = login_store(base_id) else { return Vec::new() };
    let p = store.to_string_lossy().into_owned();
    match shape {
        // The store IS the config dir, or the parent/root the agent hangs its
        // own directory off. In every directory shape the caller passes the
        // same store path and this decides what the agent is told.
        LoginStore::ConfigDir { env } => vec![(env.into(), p)],
        LoginStore::SelfHostingDir { env } => vec![(env.into(), p)],
        LoginStore::ParentDir { env, .. } => vec![(env.into(), p)],
        LoginStore::XdgRoot { env, .. } => vec![(env.into(), p)],
        LoginStore::HomeOnly { .. } => vec![("HOME".into(), p)],
        // No directory at all. The token is not known here: the caller reads
        // it from the account's own store, so this only names the variable.
        LoginStore::TokenVar { env } => vec![(env.into(), String::new())],
    }
}

/// Where the agent will actually put its config, given a store path.
///
/// Differs from the store for the shapes that append: gemini's variable is a
/// parent, opencode's and muse's are generic roots. Callers that need to look
/// AT the login (to report an identity, or to symlink shared settings back)
/// need this, not the store path.
pub fn login_config_dir(base_id: &str, store: &std::path::Path) -> Option<std::path::PathBuf> {
    Some(match login_store(base_id)? {
        LoginStore::ConfigDir { .. } => store.to_path_buf(),
        LoginStore::SelfHostingDir { .. } => store.to_path_buf(),
        LoginStore::ParentDir { child, .. } => store.join(child),
        LoginStore::XdgRoot { child, .. } => store.join(child),
        LoginStore::HomeOnly { child } => store.join(child),
        LoginStore::TokenVar { .. } => return None,
    })
}

pub fn state_dirs(agent_id: &str) -> &'static [&'static str] {
    match agent_id {
        // claude and codex relocate their ENTIRE config dir via an env var
        // (CLAUDE_CONFIG_DIR / CODEX_HOME — see docker.rs's `agent_config`),
        // which folds HOME-root dotfiles in too (claude's `.claude.json`
        // sits inside `$CLAUDE_CONFIG_DIR` once relocated) — one dir covers
        // everything, so there is nothing else to list.
        "claude" => &[".claude"],
        "codex" => &[".codex"],
        "copilot" => &[".copilot"],
        // agy shares the `.gemini` config shape (Gemini-family CLI) plus
        // its own `.antigravity`.
        "agy" | "antigravity" => &[".gemini", ".antigravity"],
        // opencode follows XDG: config in `.config/opencode`, auth +
        // session DB in `.local/share/opencode`.
        "opencode" => &[".config/opencode", ".local/share/opencode"],
        // pi (Earendil): global settings + trust file live under
        // `~/.pi/agent/`, so the whole `.pi` tree is the config dir. Safe to
        // mount in Docker ONLY because the image installs pi from npm (the
        // binary lands in the global prefix, outside HOME) - pi's own
        // install.sh can put it in `~/.pi/agent/bin`, which would be grok's
        // situation exactly. See assets/Dockerfile.default.
        "pi" => &[".pi"],
        // Muse Code follows XDG: auth + enterprise config in `.config/muse`,
        // session logs / bundled skills / plugin cache in
        // `.local/share/muse`. Neither holds the binary (the launcher shim
        // and its versioned `muse-bin-<version>` sibling live in
        // `.local/bin`), so unlike grok these are safe to mount over in
        // Docker — see assets/Dockerfile.default.
        "muse" => &[".config/muse", ".local/share/muse"],
        // grok: binary, bundled skills, and config all live under `.grok`
        // with no clean relocation env. Listed here for Seatbelt (which
        // allows the real path regardless); `docker::agent_config` still
        // declines to support it — see findings.md's "outlier" writeup.
        "grok" => &[".grok"],
        _ => &[],
    }
}

#[cfg(test)]
mod instance_dir_tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn agent(id: &str, extends: Option<&str>, env: &[(&str, &str)]) -> crate::Agent {
        // Same stub shape docker's tests use: clone a real default rather than
        // construct one, so a new required field cannot silently skip these.
        let mut a = crate::default_agents().into_iter().next().unwrap();
        a.id = id.to_string();
        a.extends = extends.map(|s| s.to_string());
        a.env = env.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        a
    }
    const HOME: &str = "/Users/u";

    // ── what the account switcher can and cannot express today (GH #278) ──
    //
    // The host realm's counterpart to docker.rs's realm tests. Measured
    // 2026-09-06: every built-in has SOME way to isolate a login, but only two
    // of them are expressible through this module, so these pin the gap rather
    // than the wish.

    /// Every agent termic ships. Kept as one list so the guards below cannot
    /// silently stop covering an agent someone added.
    const BUILT_INS: &[&str] = &["claude", "codex", "copilot", "agy", "grok", "opencode", "pi", "muse"];

    #[test]
    fn every_builtin_agent_has_a_measured_login_store() {
        // THE MAINTENANCE GUARD. Adding an agent without measuring where its
        // login lives would give it an account switcher that silently shares
        // one login between "accounts", which is worse than not offering one.
        // This fails the moment a built-in appears without a row.
        let missing: Vec<&str> = BUILT_INS.iter().copied()
            .filter(|a| login_store(a).is_none())
            .collect();
        assert!(
            missing.is_empty(),
            "no measured login store for: {missing:?}. Point the agent's candidate variable at an \
             empty dir and see whether it loses its login (docs/plans/agent-credentials.md), then \
             add a row to `login_store`. Do NOT guess: an unmeasured agent must stay None.",
        );
    }

    #[test]
    fn docker_only_ever_sees_the_shape_it_can_actually_honour() {
        // Docker sets this variable to the CONTAINER PATH it mounted, so only
        // "the variable is the config dir" is safe. A ParentDir would make the
        // agent write one level below the mount (into the throwaway layer) and
        // an XdgRoot would redirect unrelated tools inside the container.
        //
        // This is the guard that replaced an earlier one asserting those
        // agents were absent from the table entirely. They are present now,
        // with shapes; what must stay true is which shapes reach Docker.
        for a in BUILT_INS {
            let via_shape = matches!(login_store(a), Some(LoginStore::ConfigDir { .. }));
            assert_eq!(
                config_relocation_env(a).is_some(), via_shape,
                "{a}: config_relocation_env must be exactly the ConfigDir agents",
            );
        }
        assert_eq!(config_relocation_env("claude"), Some("CLAUDE_CONFIG_DIR"));
        assert_eq!(config_relocation_env("codex"), Some("CODEX_HOME"));
        assert_eq!(config_relocation_env("copilot"), Some("COPILOT_HOME"));
        // The three that would be WRONG as a plain variable name.
        assert_eq!(config_relocation_env("agy"), None, "GEMINI_CLI_HOME is a parent, not a config dir");
        assert_eq!(config_relocation_env("grok"), None,
            "GROK_HOME moves grok's login, but its binary lives in that tree: mounting over it in \
             Docker shadows the binary and the agent vanishes");
        assert_eq!(config_relocation_env("opencode"), None, "XDG_DATA_HOME is a generic root");
        assert_eq!(config_relocation_env("muse"), None, "XDG_CONFIG_HOME is a generic root");
        assert_eq!(config_relocation_env("pi"), None, "pi has no dedicated variable at all");
    }

    #[test]
    fn each_shape_points_the_agent_at_the_store_the_way_that_agent_expects() {
        let store = Path::new("/data/logins/claude/work");
        assert_eq!(login_env("claude", store), vec![("CLAUDE_CONFIG_DIR".to_string(), "/data/logins/claude/work".to_string())]);
        assert_eq!(login_env("codex", store), vec![("CODEX_HOME".to_string(), "/data/logins/claude/work".to_string())]);
        assert_eq!(login_env("copilot", store), vec![("COPILOT_HOME".to_string(), "/data/logins/claude/work".to_string())]);
        // Relocatable for a LOGIN even though Docker cannot mount it.
        assert_eq!(login_env("grok", store), vec![("GROK_HOME".to_string(), "/data/logins/claude/work".to_string())]);
        // The parent shape still gets the STORE, not the config dir: the agent
        // is the one that appends. Passing `<store>/.gemini` here would nest.
        assert_eq!(login_env("agy", store), vec![("GEMINI_CLI_HOME".to_string(), "/data/logins/claude/work".to_string())]);
        assert_eq!(login_env("opencode", store), vec![("XDG_DATA_HOME".to_string(), "/data/logins/claude/work".to_string())]);
        assert_eq!(login_env("muse", store), vec![("XDG_CONFIG_HOME".to_string(), "/data/logins/claude/work".to_string())]);
        assert_eq!(login_env("pi", store), vec![("HOME".to_string(), "/data/logins/claude/work".to_string())]);
        // An unmeasured agent gets NOTHING, which is the caller's signal that
        // it cannot hold a second account.
        assert!(login_env("some-unmapped-cli", store).is_empty());
    }

    #[test]
    fn the_config_dir_is_where_the_agent_puts_it_not_where_we_pointed_it() {
        // The gemini trap, made explicit: reporting an identity or symlinking
        // shared settings has to look at the dir the agent WRITES, which for
        // three of the shapes is a level below the store.
        let store = Path::new("/s");
        assert_eq!(login_config_dir("claude", store).unwrap(), Path::new("/s"));
        assert_eq!(login_config_dir("agy", store).unwrap(), Path::new("/s/.gemini"));
        assert_eq!(login_config_dir("opencode", store).unwrap(), Path::new("/s/opencode"));
        assert_eq!(login_config_dir("muse", store).unwrap(), Path::new("/s/muse"));
        assert_eq!(login_config_dir("pi", store).unwrap(), Path::new("/s/.pi"));
        assert_eq!(login_config_dir("some-unmapped-cli", store), None);
    }

    #[test]
    fn the_agents_whose_variable_is_broader_than_themselves_are_known() {
        // XdgRoot redirects a variable other tools in the same environment
        // read, so the UI has to say so rather than present it as agent-local.
        // Listed here so adding one is a deliberate act with a UI consequence.
        let broad: Vec<&str> = BUILT_INS.iter().copied()
            .filter(|a| matches!(login_store(a), Some(LoginStore::XdgRoot { .. })))
            .collect();
        assert_eq!(broad, vec!["opencode", "muse"]);

        // HomeOnly is broader still: the store has to be a home-shaped dir.
        let home_only: Vec<&str> = BUILT_INS.iter().copied()
            .filter(|a| matches!(login_store(a), Some(LoginStore::HomeOnly { .. })))
            .collect();
        assert_eq!(home_only, vec!["pi"]);
    }

    #[test]
    fn grok_relocates_its_login_but_is_never_a_docker_mount() {
        // Two facts that look like one. The measurement says GROK_HOME moves
        // the login; the binary living in the same tree says the directory
        // cannot be mounted over. Conflating them is how the Docker mount
        // silently breaks, so they are separate variants and both are pinned.
        assert!(matches!(login_store("grok"), Some(LoginStore::SelfHostingDir { env: "GROK_HOME" })));
        assert!(!login_env("grok", Path::new("/s")).is_empty(), "grok CAN hold a second account");
        assert_eq!(config_relocation_env("grok"), None, "and Docker must still decline it");
        assert!(!crate::docker::persist_offerable("grok"),
            "docker's own refusal has to agree with this table");
    }

    #[test]
    fn the_probe_covers_every_agent_with_a_measured_login_store() {
        // `login_store` is a table of MEASUREMENTS of other people's software,
        // so it goes stale silently when an agent ships a change: the switcher
        // keeps "working", every test here keeps passing, and two accounts
        // quietly share one credential. `make login-probe` is what catches
        // that, by pointing each variable at an empty dir against the REAL
        // CLI, and it can only catch it for agents it knows about.
        //
        // So this fails when an agent gains a store and the probe is not
        // taught to check it. Cross-file guard, same idea as cspGuard.test.ts.
        let probe = include_str!("../../scripts/login-probe.mjs");
        // The probe keys on the BINARY name; the table keys on the agent id,
        // and the Gemini-family agents run `gemini`.
        fn binary_for(id: &str) -> &str { match id {
            "agy" | "antigravity" => "gemini",
            other => other,
        } }
        let missing: Vec<&str> = BUILT_INS.iter().copied()
            .filter(|id| login_store(id).is_some())
            .filter(|id| !probe.contains(&format!("id: \"{}\"", binary_for(id))))
            .collect();
        assert!(
            missing.is_empty(),
            "scripts/login-probe.mjs does not check: {missing:?}. An agent with a measured login \
             store but no probe row is one whose table entry can rot unnoticed. Add a row with the \
             variable and a read-only command that reveals whether it is signed in.",
        );

        // And the reverse: a probe row for an agent the table does not know is
        // checking something nothing uses.
        for id in BUILT_INS.iter().filter(|i| login_store(i).is_some()) {
            let bin = binary_for(id);
            assert!(probe.contains(&format!("id: \"{bin}\"")), "{bin} vanished from the probe");
        }
    }

    #[test]
    fn a_clone_resolves_its_base_agents_shape() {
        // A clone of claude runs the claude binary and keeps claude's layout,
        // which is what `extends` is for. The switcher must not treat a clone
        // as an unmeasured agent.
        assert_eq!(login_store("claude"), login_store("claude"));
        assert!(login_store("next-claude").is_none(),
            "a clone id is not a base id; callers resolve it through docker::base_agent_id first");
    }

    #[test]
    fn a_login_is_isolated_per_agent_entry_not_per_account() {
        // The symmetrical gap to docker.rs's
        // `a_docker_login_is_keyed_by_agent_id_and_nothing_else`: on the host
        // too, the only thing that separates two logins today is a different
        // agent ENTRY. That is the clone workaround, and it is what the
        // account switcher replaces.
        let plain = vec![agent("claude", None, &[])];
        let cloned = vec![
            agent("claude", None, &[]),
            agent("next-claude", Some("claude"), &[("CLAUDE_CONFIG_DIR", "~/.next-claude")]),
        ];
        assert_eq!(
            instance_config_dir(&plain, "claude", Path::new(HOME)),
            Some(PathBuf::from("/Users/u/.claude")),
        );
        assert_eq!(
            instance_config_dir(&cloned, "next-claude", Path::new(HOME)),
            Some(PathBuf::from("/Users/u/.next-claude")),
        );
        // Two ACCOUNTS of the same entry are indistinguishable: there is
        // nowhere to say which one is meant.
        assert_eq!(
            instance_config_dir(&cloned, "claude", Path::new(HOME)),
            instance_config_dir(&cloned, "claude", Path::new(HOME)),
        );
    }

    #[test]
    fn a_plain_agent_uses_its_own_default_dir() {
        let agents = vec![agent("claude", None, &[])];
        assert_eq!(
            instance_config_dir(&agents, "claude", Path::new(HOME)),
            Some(PathBuf::from("/Users/u/.claude")),
        );
    }

    #[test]
    fn a_clone_with_no_env_falls_back_to_the_base_dir() {
        // Correct, and worth stating: two agents sharing one login share one
        // config, so they share one set of hooks. Nothing is wrong with that.
        let agents = vec![agent("claude", None, &[]), agent("next-claude", Some("claude"), &[])];
        assert_eq!(
            instance_config_dir(&agents, "next-claude", Path::new(HOME)),
            Some(PathBuf::from("/Users/u/.claude")),
        );
    }

    #[test]
    fn a_clone_holding_a_second_account_gets_its_own_dir() {
        // The reported shape: a second agent entry whose CLAUDE_CONFIG_DIR
        // points outside the first one's default.
        let agents = vec![
            agent("claude", None, &[]),
            agent("next-claude", Some("claude"), &[("CLAUDE_CONFIG_DIR", "/Users/u/.next-claude")]),
        ];
        assert_eq!(
            instance_config_dir(&agents, "next-claude", Path::new(HOME)),
            Some(PathBuf::from("/Users/u/.next-claude")),
        );
        // And the original is untouched, which is the whole point: installing
        // for one account must never write into the other's config.
        assert_eq!(
            instance_config_dir(&agents, "claude", Path::new(HOME)),
            Some(PathBuf::from("/Users/u/.claude")),
        );
    }

    #[test]
    fn a_hand_typed_tilde_is_expanded() {
        // Users type this by hand in Settings, and an unexpanded `~` creates a
        // directory literally called "~".
        for raw in ["~/.next-claude", "$HOME/.next-claude"] {
            let agents = vec![
                agent("claude", None, &[]),
                agent("c2", Some("claude"), &[("CLAUDE_CONFIG_DIR", raw)]),
            ];
            assert_eq!(
                instance_config_dir(&agents, "c2", Path::new(HOME)),
                Some(PathBuf::from("/Users/u/.next-claude")),
                "{raw}",
            );
        }
    }

    #[test]
    fn a_home_override_moves_the_default_dir() {
        let agents = vec![
            agent("claude", None, &[]),
            agent("c2", Some("claude"), &[("HOME", "/tmp/alt")]),
        ];
        assert_eq!(
            instance_config_dir(&agents, "c2", Path::new(HOME)),
            Some(PathBuf::from("/tmp/alt/.claude")),
        );
    }

    #[test]
    fn the_relocation_var_outranks_a_home_override() {
        let agents = vec![
            agent("claude", None, &[]),
            agent("c2", Some("claude"), &[("HOME", "/tmp/alt"), ("CLAUDE_CONFIG_DIR", "/tmp/cfg")]),
        ];
        assert_eq!(
            instance_config_dir(&agents, "c2", Path::new(HOME)),
            Some(PathBuf::from("/tmp/cfg")),
        );
    }

    #[test]
    fn an_agent_with_no_known_dir_says_so() {
        let agents = vec![agent("mystery", None, &[])];
        assert_eq!(instance_config_dir(&agents, "mystery", Path::new(HOME)), None);
    }

    #[test]
    fn only_agents_that_truly_relocate_are_listed() {
        assert_eq!(config_relocation_env("claude"), Some("CLAUDE_CONFIG_DIR"));
        assert_eq!(config_relocation_env("codex"), Some("CODEX_HOME"));
        // grok's binary lives inside its config dir, so it has no clean one.
        assert_eq!(config_relocation_env("grok"), None);
        assert_eq!(config_relocation_env("opencode"), None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_agents_have_at_least_one_dir() {
        for id in ["claude", "codex", "copilot", "agy", "antigravity", "opencode", "grok"] {
            assert!(!state_dirs(id).is_empty(), "{id} should list at least one state dir");
        }
    }

    #[test]
    fn unknown_agent_has_no_dirs() {
        assert!(state_dirs("not-a-real-agent").is_empty());
    }

    #[test]
    fn every_entry_is_a_relative_dotfile_path() {
        // Every consumer prefixes these with either "$HOME/" or "/root/",
        // so a leading slash or a bare (non-dotfile) name here would
        // silently produce a wrong mount/allow-list path in both places.
        for id in ["claude", "codex", "copilot", "agy", "opencode", "grok"] {
            for dir in state_dirs(id) {
                assert!(dir.starts_with('.'), "{id}'s {dir} should be a relative dotfile path");
                assert!(!dir.starts_with('/'), "{id}'s {dir} should not be absolute");
            }
        }
    }
}
