// Helpers for remote (SSH host + repo) projects and tasks
// (issue #82). Frontend counterpart of src-tauri/src/ssh_exec.rs; keep
// the label logic in sync with SshTarget::label().

import { useEffect, useMemo } from "react";
import { useApp } from "@/store/app";
import type { SshTarget } from "@/lib/types";

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

/** Agent ids known to be MISSING on a remote project's host. Kicks off
 *  the (deduped) host probe as a side effect. Empty set for local
 *  projects, unknown projects, and while the probe is in flight — the
 *  pickers only gray agents once a probe positively reported them
 *  absent, never on "don't know yet". */
export function useRemoteMissingClis(projectId: string | null | undefined): Set<string> {
  const isRemote = useApp(s => !!(projectId && s.projects.find(p => p.id === projectId)?.ssh));
  const map = useApp(s => (projectId ? s.remoteClis[projectId] : undefined));
  useEffect(() => {
    if (isRemote && projectId) void useApp.getState().refreshRemoteClis(projectId);
  }, [isRemote, projectId]);
  return useMemo(() => {
    if (!isRemote || !map) return new Set<string>();
    return new Set(Object.values(map).filter(c => !c.found).map(c => c.name));
  }, [isRemote, map]);
}
