// Deleting a profile (GH #280).
//
// The dangerous operation, because a profile owns worktrees and worktrees hold
// uncommitted work. The dialog ASKS, it never assumes:
//
//   - Counts, not prose. How many tasks, how many dirty, how many unpushed.
//     That is the only information that makes this a decision rather than a
//     leap, and it is the same information the user would otherwise have to
//     open the profile to find.
//   - The safe option is preselected. Keeping the worktrees loses nothing.
//   - The confirmation checkbox appears ONLY where it is load-bearing:
//     deleting worktrees when some hold uncommitted work. Everywhere else it
//     is noise, and a confirmation people always dismiss stops being one.
//   - No type-the-name gate. The counts plus a preselected safe option carry
//     the weight, and this app uses that pattern nowhere else.
//
// Branches are never deleted here, in either scope: archive asks that
// separately, and a bulk delete is the worst place to answer it for someone.

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useUI } from "@/store/ui";
import { useProfiles } from "@/store/profiles";
import { AppDialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { profileClose, profileDelete, profileDeletePreview } from "@/lib/ipc";
import { purgeProfileKeys } from "@/lib/profileScope";
import type { ProfileDeletePreview } from "@/lib/types";
import { cn } from "@/lib/utils";

function Choice({ checked, onSelect, title, detail, testid }: {
  checked: boolean; onSelect: () => void; title: string; detail: string; testid: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      data-testid={testid}
      onClick={onSelect}
      className={cn(
                // `transition-[color,background-color]`, NOT `transition-colors`.
        // The latter also transitions BORDER-COLOR, and in WKWebView a
        // border-color change between two `var()` values never repaints when
        // it is transitioned: the class swaps, aria-checked swaps, and the
        // painted border stays on the option you deselected. Verified both
        // ways in profiles.e2e.ts, which polls for 5s and then asserts the
        // colour actually moved.
        "flex w-full gap-2.5 rounded-lg border p-3 text-left transition-[color,background-color]",
        checked
          ? "border-[var(--color-accent)] bg-[var(--color-bg-2)]"
          : "border-[var(--color-border-soft)] hover:bg-[var(--color-bg-2)]",
      )}
    >
      <span className={cn(
        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
        checked ? "border-[var(--color-accent)]" : "border-[var(--color-border)]",
      )}>
        {checked && <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="mt-0.5 block text-[12px] text-[var(--color-fg-dim)]">{detail}</span>
      </span>
    </button>
  );
}

export function DeleteProfileDialog() {
  const slug = useUI(s => s.deleteProfileSlug);
  const setSlug = useUI(s => s.setDeleteProfileSlug);
  const refresh = useProfiles(s => s.refresh);

  const [preview, setPreview] = useState<ProfileDeletePreview | null>(null);
  const [deleteWorktrees, setDeleteWorktrees] = useState(false);
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) { setPreview(null); return; }
    setDeleteWorktrees(false); setAcked(false); setErr(null); setBusy(false); setPreview(null);
    let live = true;
    void profileDeletePreview(slug)
      .then(p => { if (live) setPreview(p); })
      .catch(e => { if (live) setErr(String(e)); });
    return () => { live = false; };
  }, [slug]);

  const open = slug !== null;
  // The checkbox is load-bearing only in the one case it describes.
  const needsAck = deleteWorktrees && (preview?.dirty ?? 0) > 0;
  // NOT a blocker any more: the delete closes the window itself. Kept only as
  // a warning, because "your window disappears and whatever was running in it
  // stops" is worth knowing before pressing a red button.
  const windowOpen = preview?.windowOpen ?? false;
  const canDelete = !!preview && !busy && (!needsAck || acked);

  const run = async () => {
    if (!slug || !canDelete) return;
    setBusy(true); setErr(null);
    try {
      await profileDelete(slug, deleteWorktrees);
      // Prune this profile's localStorage in the same operation, or a
      // recreated profile with the same slug inherits a dead one's collapse
      // state and folder colors.
      purgeProfileKeys(slug);
      await refresh();
      setSlug(null);
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) setSlug(null); }}
      title={preview ? `Delete profile "${preview.name}"?` : "Delete profile"}
      className="max-w-lg"
    >
      <div className="flex flex-col gap-4" data-testid="delete-profile-dialog">
        {!preview && !err && (
          <div className="text-[13px] text-[var(--color-fg-dim)]">Checking what this profile owns...</div>
        )}

        {windowOpen && (
          <div className="flex gap-2 rounded-lg border border-[var(--color-warning)] p-3 text-[12.5px]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
            <span>
              This profile's window is open. Deleting closes it, and anything
              running in it stops.
            </span>
          </div>
        )}

        {preview && (
          <>
            {/* Counts, not prose. */}
            <div
              data-testid="delete-profile-counts"
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-[var(--color-bg-2)] px-3 py-2 text-[12.5px]"
            >
              <span>{preview.tasks} {preview.tasks === 1 ? "task" : "tasks"}</span>
              {preview.dirty > 0 && (<><span className="opacity-40">·</span>
                <span className="text-[var(--color-warning)]">{preview.dirty} with uncommitted changes</span></>)}
              {preview.unpushed > 0 && (<><span className="opacity-40">·</span>
                <span>{preview.unpushed} unpushed {preview.unpushed === 1 ? "branch" : "branches"}</span></>)}
              {preview.mainCheckouts > 0 && (<><span className="opacity-40">·</span>
                <span>{preview.mainCheckouts} open repo {preview.mainCheckouts === 1 ? "folder" : "folders"} (never removed)</span></>)}
            </div>

            <div role="radiogroup" className="flex flex-col gap-2">
              <Choice
                testid="delete-profile-keep"
                checked={!deleteWorktrees}
                onSelect={() => { setDeleteWorktrees(false); setAcked(false); }}
                title="Keep the worktrees on disk"
                detail={`${preview.worktreesHint} is left untouched.`}
              />
              <Choice
                testid="delete-profile-remove"
                checked={deleteWorktrees}
                onSelect={() => setDeleteWorktrees(true)}
                title="Delete the worktrees too"
                detail={
                  preview.tasks - preview.mainCheckouts > 0
                    ? `Removes ${preview.tasks - preview.mainCheckouts} ${preview.tasks - preview.mainCheckouts === 1 ? "worktree" : "worktrees"}. Branches are kept.`
                    : "Nothing to remove. Branches are kept."
                }
              />
            </div>

            {needsAck && (
              <label className="flex items-center gap-2 text-[12.5px]" data-testid="delete-profile-ack">
                <Checkbox checked={acked} onChange={setAcked} />
                <span>I understand {preview.dirty} {preview.dirty === 1 ? "task has" : "tasks have"} uncommitted changes</span>
              </label>
            )}
          </>
        )}

        {err && (
          <div className="rounded-md border border-[var(--color-danger)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setSlug(null)} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={() => void run()} disabled={!canDelete} data-testid="delete-profile-confirm">
            {busy ? "Deleting..." : "Delete profile"}
          </Button>
        </div>
      </div>
    </AppDialog>
  );
}
