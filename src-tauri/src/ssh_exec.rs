// SSH execution layer for remote projects (a Project that is an SSH
// host + repo combo). Owns EVERYTHING ssh: argv construction, shell
// quoting, the ControlMaster socket path, timeouts, and error
// classification. Nothing outside this module builds an `ssh` command
// line, and the frontend never sees ssh details beyond the `ssh: `
// error prefix.
//
// Transport is the system `ssh` binary with ControlMaster multiplexing:
// every non-PTY operation (git, file ops, scripts) shares one
// authenticated connection per target, so a `git status` poll costs a
// mux-channel open, not a key exchange. PTY tabs reuse the same
// ControlPath but run WITHOUT BatchMode, so an interactive terminal tab
// is also the recovery path that can re-authenticate and revive the
// master for the panel operations.

use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::shell_env;

/// Connection descriptor for a remote project, persisted on both the
/// Project (source of truth, editable) and the Workspace (frozen copy
/// taken at create time, same pattern as the sandbox lists). Empty /
/// zero fields defer to the user's `~/.ssh/config` for that setting,
/// so a bare `host` that names a config alias picks up User / Port /
/// IdentityFile / ProxyJump from there.
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq, Eq, Hash)]
#[serde(default)]
pub struct SshTarget {
    /// Hostname, IP, or `~/.ssh/config` alias. Required.
    pub host: String,
    /// Login user. Empty = defer to ssh config / local username.
    pub user: String,
    /// Port. 0 = defer to ssh config (default 22).
    pub port: u16,
    /// Local path to a private key. When set it is passed as `-i` with
    /// `IdentitiesOnly=yes`, overriding whatever the ssh config would
    /// pick for this host. Empty = defer to config / agent.
    pub identity_file: String,
    /// Base directory on the HOST under which worktrees are created,
    /// e.g. "~/termic/workspaces". Empty = that default. Tilde is
    /// expanded remotely at workspace-create time.
    pub remote_workspaces_path: String,
}

impl SshTarget {
    /// `user@host` (or just `host`) for UI copy and error messages.
    pub fn label(&self) -> String {
        if self.user.is_empty() {
            self.host.clone()
        } else {
            format!("{}@{}", self.user, self.host)
        }
    }

    /// The ssh destination argument.
    pub fn destination(&self) -> String {
        self.label()
    }

    /// Key for per-target caches (probe results, dedup at app exit).
    pub fn cache_key(&self) -> String {
        format!("{}|{}|{}|{}", self.host, self.port, self.user, self.identity_file)
    }
}

/// Where a workspace's processes and files live. Threaded through the
/// git / file / script helpers so every call site states its host
/// explicitly instead of assuming local disk.
#[derive(Clone, Copy, Debug)]
pub enum ExecHost<'a> {
    Local,
    Remote(&'a SshTarget),
}

impl<'a> ExecHost<'a> {
    pub fn is_remote(&self) -> bool {
        matches!(self, ExecHost::Remote(_))
    }
}

/// POSIX single-quote escaping: wraps `s` in single quotes, with any
/// embedded single quote rendered as `'\''`. Safe for any byte sequence
/// except NUL (which cannot appear in an argv anyway). Every token that
/// crosses the wire into a remote shell MUST pass through here.
pub fn shq(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        if c == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(c);
        }
    }
    out.push('\'');
    out
}

/// Directory holding ControlMaster sockets: `~/termic/ssh` (0700).
/// Deliberately NOT the Tauri app-data dir — `~/Library/Application
/// Support/...` plus a socket name flirts with the 104-byte `sun_path`
/// limit on macOS. Combined with ssh's own `%C` hash token the full
/// path stays short and unique per (host, port, user).
fn control_path_dir() -> Result<PathBuf> {
    let dir = dirs::home_dir()
        .ok_or_else(|| anyhow!("no home directory"))?
        .join(crate::APP_DIR)
        .join("ssh");
    std::fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    Ok(dir)
}

fn control_path_opt() -> String {
    match control_path_dir() {
        Ok(d) => format!("ControlPath={}/cm-%C", d.display()),
        // Fall back to no multiplexing rather than failing the call.
        Err(_) => "ControlPath=none".into(),
    }
}

/// Common ssh options for a target. `batch` selects the non-interactive
/// profile used by every background operation (git, file ops, scripts):
/// BatchMode makes a dead or unauthenticated host fail fast instead of
/// prompting a GUI process that has no TTY to prompt on. PTY tabs pass
/// `batch = false` so ssh CAN prompt (passphrase, host key) inside the
/// visible terminal, which also revives the shared ControlMaster.
pub fn ssh_base_args(t: &SshTarget, batch: bool) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-o".into(), "ControlMaster=auto".into(),
        "-o".into(), control_path_opt(),
        "-o".into(), "ControlPersist=600".into(),
        "-o".into(), "ConnectTimeout=10".into(),
        "-o".into(), "ServerAliveInterval=5".into(),
        "-o".into(), "ServerAliveCountMax=3".into(),
    ];
    if batch {
        a.push("-o".into());
        a.push("BatchMode=yes".into());
        // First contact with a brand-new host would otherwise die on the
        // interactive host-key prompt BatchMode suppresses. accept-new
        // trusts an UNSEEN key on first use (what users answer "yes" to)
        // but still hard-fails when a KNOWN host's key changes - the
        // case that actually signals an attack.
        a.push("-o".into());
        a.push("StrictHostKeyChecking=accept-new".into());
    }
    if !t.identity_file.is_empty() {
        a.push("-i".into());
        a.push(t.identity_file.clone());
        a.push("-o".into());
        a.push("IdentitiesOnly=yes".into());
    }
    if t.port != 0 {
        a.push("-p".into());
        a.push(t.port.to_string());
    }
    a
}

/// Reasonable wall-clock budgets. Quick = status/file-sized round trips;
/// Slow = worktree add, setup scripts, greps. Both are hard kills: a
/// wedged remote command must never pin a spawn_blocking thread forever.
pub const QUICK: Duration = Duration::from_secs(25);
pub const SLOW: Duration = Duration::from_secs(180);

pub struct RemoteOutput {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub code: i32,
}

/// Run `script` on the target under POSIX `sh`. sshd hands the command
/// line to the user's LOGIN shell, which may be fish/csh — so we send
/// `sh -c '<script>'`: the single-quote escaping parses identically in
/// every common shell, and the script itself always executes under sh.
/// (Caught live: a fish login shell rejected `${f%/}` / `if..then`.)
/// Returns the raw output without judging the exit code — most callers
/// want `run_remote` below. `stdin` is streamed to the remote command's
/// stdin (used for file writes and uploads).
pub fn run_remote_raw(
    t: &SshTarget,
    script: &str,
    timeout: Duration,
    stdin: Option<&[u8]>,
) -> Result<RemoteOutput> {
    let mut cmd = Command::new("ssh");
    cmd.args(ssh_base_args(t, true));
    cmd.arg(t.destination());
    cmd.arg(format!("sh -c {}", shq(script)));
    // Same env treatment as the local `git()` helper: a GUI-launched
    // .app gets a bare launchd environment, so without the login env
    // ssh can't find SSH_AUTH_SOCK and agent auth silently fails.
    cmd.env("PATH", shell_env::resolved_path());
    for (k, v) in shell_env::login_env() {
        cmd.env(k, v);
    }
    cmd.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() });
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| anyhow!("ssh: failed to launch ssh: {e}"))?;

    // Feed stdin from its own thread so a large payload can't deadlock
    // against an unread stdout pipe.
    let stdin_handle = stdin.map(|bytes| {
        let mut pipe = child.stdin.take().expect("piped stdin");
        let owned = bytes.to_vec();
        std::thread::spawn(move || {
            let _ = pipe.write_all(&owned);
            // pipe drops here -> remote sees EOF
        })
    });
    let mut out_pipe = child.stdout.take().expect("piped stdout");
    let mut err_pipe = child.stderr.take().expect("piped stderr");
    let out_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out_pipe.read_to_end(&mut buf);
        buf
    });
    let err_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = err_pipe.read_to_end(&mut buf);
        buf
    });

    // Hard wall-clock deadline via try_wait polling; on expiry kill the
    // local ssh (the mux channel closes, the remote command gets HUP).
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait()? {
            Some(st) => break st,
            None => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(anyhow!(
                        "ssh: {} did not respond within {}s",
                        t.label(),
                        timeout.as_secs()
                    ));
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        }
    };
    if let Some(h) = stdin_handle {
        let _ = h.join();
    }
    let stdout = out_thread.join().unwrap_or_default();
    let stderr = String::from_utf8_lossy(&err_thread.join().unwrap_or_default()).into_owned();
    Ok(RemoteOutput { stdout, stderr, code: status.code().unwrap_or(-1) })
}

/// Run `script` remotely and return stdout as a lossy string, treating
/// any failure as an error. Exit 255 is ssh itself failing (unreachable,
/// auth, host key) and maps to the stable `ssh: cannot reach ...` shape
/// the frontend detects; any other non-zero code is the remote command
/// failing and surfaces the remote stderr.
pub fn run_remote(
    t: &SshTarget,
    script: &str,
    timeout: Duration,
    stdin: Option<&[u8]>,
) -> Result<String> {
    let out = run_remote_raw(t, script, timeout, stdin)?;
    if out.code == 255 {
        // ssh's own stderr lines already start with "ssh: " half the
        // time; strip it so our prefix doesn't read "ssh: ... ssh: ...".
        let line = out.stderr.lines().last().unwrap_or("connection failed").trim();
        let line = line.strip_prefix("ssh: ").unwrap_or(line);
        return Err(anyhow!("ssh: cannot reach {}: {}", t.label(), line));
    }
    if out.code != 0 {
        let msg = out.stderr.trim();
        return Err(anyhow!(
            "remote command failed on {} (exit {}): {}",
            t.label(),
            out.code,
            if msg.is_empty() { "(no stderr)" } else { msg }
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Git on an explicit host. `Local` delegates to the existing local
/// `git()` helper (untouched, so local behavior cannot regress);
/// `Remote` runs `git -C <cwd> ...` over the multiplexed connection.
pub fn git_on(host: ExecHost, args: &[&str], cwd: &str) -> Result<String> {
    match host {
        ExecHost::Local => crate::git(args, std::path::Path::new(cwd)),
        ExecHost::Remote(t) => {
            let mut script = format!("git -C {}", shq(cwd));
            for a in args {
                script.push(' ');
                script.push_str(&shq(a));
            }
            run_remote(t, &script, SLOW, None)
                .map_err(|e| anyhow!("git {:?} failed: {}", args, e))
        }
    }
}

/// What `probe` learns about a host, cached per target for the lifetime
/// of the app (OS and $HOME don't change; git version is informational).
#[derive(Clone, Debug, Serialize)]
pub struct ProbeInfo {
    pub os: String,
    pub git_version: String,
    pub home: String,
}

fn probe_cache() -> &'static Mutex<HashMap<String, ProbeInfo>> {
    static CACHE: OnceLock<Mutex<HashMap<String, ProbeInfo>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// One round trip validating the assumptions remote projects rest on:
/// reachable, POSIX shell, git present, and where $HOME is (needed to
/// expand `~` in remote paths ourselves, since quoted paths don't
/// tilde-expand). Used by the "Test connection" button and cached for
/// path expansion in the create path.
pub fn probe(t: &SshTarget) -> Result<ProbeInfo> {
    let raw = run_remote(
        t,
        "uname -s; git --version 2>/dev/null || echo 'git missing'; printf %s \"$HOME\"",
        QUICK,
        None,
    )?;
    let mut lines = raw.lines();
    let os = lines.next().unwrap_or("").trim().to_string();
    let git_version = lines.next().unwrap_or("").trim().to_string();
    let home = lines.next().unwrap_or("").trim().to_string();
    if git_version == "git missing" {
        return Err(anyhow!("git is not installed on {}", t.label()));
    }
    if home.is_empty() {
        return Err(anyhow!("could not resolve $HOME on {}", t.label()));
    }
    let info = ProbeInfo { os, git_version, home };
    probe_cache().lock().insert(t.cache_key(), info.clone());
    Ok(info)
}

/// Cached probe, refreshing on miss. Use for `~` expansion so repeated
/// creates don't re-round-trip.
pub fn cached_probe(t: &SshTarget) -> Result<ProbeInfo> {
    if let Some(p) = probe_cache().lock().get(&t.cache_key()).cloned() {
        return Ok(p);
    }
    probe(t)
}

/// Expand a leading `~` in a remote path against the target's $HOME.
/// Remote paths travel through `shq`, so the remote shell never gets a
/// chance to expand the tilde itself.
pub fn expand_remote_tilde(t: &SshTarget, path: &str) -> Result<String> {
    if path == "~" {
        return Ok(cached_probe(t)?.home);
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return Ok(format!("{}/{}", cached_probe(t)?.home, rest));
    }
    Ok(path.to_string())
}

/// Tear down the ControlMaster for a target (best effort, bounded).
/// Called once per distinct target at app exit; ControlPersist=600 is
/// the backstop if the app dies without running this.
pub fn control_exit(t: &SshTarget) {
    let mut cmd = Command::new("ssh");
    cmd.arg("-O").arg("exit");
    cmd.arg("-o").arg(control_path_opt());
    if t.port != 0 {
        cmd.arg("-p").arg(t.port.to_string());
    }
    cmd.arg(t.destination());
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if let Ok(mut child) = cmd.spawn() {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(25))
                }
                _ => {
                    let _ = child.kill();
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shq_plain() {
        assert_eq!(shq("abc"), "'abc'");
        assert_eq!(shq(""), "''");
    }

    #[test]
    fn shq_specials_are_inert() {
        assert_eq!(shq("a b"), "'a b'");
        assert_eq!(shq("$HOME"), "'$HOME'");
        assert_eq!(shq("`id`"), "'`id`'");
        assert_eq!(shq("a;rm -rf /"), "'a;rm -rf /'");
        assert_eq!(shq("new\nline"), "'new\nline'");
        assert_eq!(shq("tab\there"), "'tab\there'");
        assert_eq!(shq("~/repo"), "'~/repo'");
        assert_eq!(shq("uni🐟code"), "'uni🐟code'");
    }

    #[test]
    fn shq_single_quotes() {
        assert_eq!(shq("it's"), "'it'\\''s'");
        assert_eq!(shq("''"), "''\\'''\\'''");
        // Round-trip through a real shell to prove the escaping.
        for nasty in ["it's a 'test'", "a\"b'c$d`e\\f", "x'; rm -rf / #"] {
            let out = std::process::Command::new("sh")
                .arg("-c")
                .arg(format!("printf %s {}", shq(nasty)))
                .output()
                .unwrap();
            assert_eq!(String::from_utf8_lossy(&out.stdout), *nasty);
        }
    }

    #[test]
    fn base_args_shapes() {
        let t = SshTarget { host: "pi".into(), ..Default::default() };
        let a = ssh_base_args(&t, true);
        assert!(a.iter().any(|s| s == "BatchMode=yes"));
        assert!(a.iter().any(|s| s.starts_with("ControlPath=")));
        assert!(!a.iter().any(|s| s == "-p"));
        assert!(!a.iter().any(|s| s == "-i"));

        let t2 = SshTarget {
            host: "ec2".into(),
            user: "ubuntu".into(),
            port: 2222,
            identity_file: "/Users/adam/.ssh/ec2.pem".into(),
            ..Default::default()
        };
        let a2 = ssh_base_args(&t2, false);
        assert!(!a2.iter().any(|s| s == "BatchMode=yes"));
        assert!(a2.windows(2).any(|w| w[0] == "-p" && w[1] == "2222"));
        assert!(a2.windows(2).any(|w| w[0] == "-i" && w[1] == "/Users/adam/.ssh/ec2.pem"));
        assert!(a2.iter().any(|s| s == "IdentitiesOnly=yes"));
        assert_eq!(t2.label(), "ubuntu@ec2");
    }

    #[test]
    fn tilde_expansion_shapes() {
        // Only the pure-string cases (no ssh round trip).
        let t = SshTarget { host: "h".into(), ..Default::default() };
        assert_eq!(expand_remote_tilde(&t, "/abs/path").unwrap(), "/abs/path");
    }
}
