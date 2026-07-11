// Helpers for remote (SSH host + repo) projects and workspaces
// (issue #82). Frontend counterpart of src-tauri/src/ssh_exec.rs; keep
// the label logic in sync with SshTarget::label().

import type { Project, SshTarget, Workspace } from "@/lib/types";

export function isRemoteProject(p: Project | null | undefined): boolean {
  return !!p?.ssh;
}

export function isRemoteWorkspace(w: Workspace | null | undefined): boolean {
  return !!w?.ssh;
}

/** `user@host` (or just `host`) for badges, tooltips, and error copy. */
export function sshLabel(t: SshTarget | null | undefined): string {
  if (!t) return "";
  return t.user ? `${t.user}@${t.host}` : t.host;
}

/** True when an IPC rejection came from the ssh transport (host
 *  unreachable / auth), as opposed to the remote command failing. The
 *  Rust side prefixes exactly these with "ssh: ". */
export function isSshError(err: unknown): boolean {
  return typeof err === "string" && err.startsWith("ssh: ");
}
