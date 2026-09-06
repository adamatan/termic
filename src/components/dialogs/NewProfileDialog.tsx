// The New Profile wizard (GH #280).
//
// NOT WelcomeDialog. `welcomed` is a one-time onboarding flag and stays
// global, so first-run setup must never replay just because someone made a
// second profile. Two of Welcome's four steps are already answered for a
// profile and are dropped deliberately:
//
//   CLI detection  binary paths are machine facts, and a new profile's agent
//                  registry is SEEDED from the profile that already ran the
//                  detection pass (Rust: profile_create).
//   Agent hooks    installed into the agent's own config dir, which every
//                  profile shares in phase 1.
//   Theme          global. Only the ACCENT is per profile.
//
// Leaving three: identity, tasks path, and (later) projects. Projects are
// added from the new window itself rather than here, because the picker needs
// discovery against the new tasks path and a profile with no projects is a
// legitimate end state.

import { useEffect, useMemo, useState } from "react";
import { useUI } from "@/store/ui";
import { useProfiles } from "@/store/profiles";
import { AppDialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { profileCreate, profileOpen } from "@/lib/ipc";
import { ACCENTS, profileAccentCss } from "@/lib/accents";
import { monogram } from "@/components/sidebar/ProfileStrip";
import { cn } from "@/lib/utils";

/** Mirrors Rust's `profiles::slugify` closely enough to PREVIEW the paths.
 *  Rust remains authoritative (it dedupes against the registry), so this is
 *  deliberately not exported or reused for anything that decides. */
export function previewSlug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 48).replace(/^-+|-+$/g, "") || "profile";
}

function AccentPicker({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ACCENTS.map(a => (
        <button
          key={a.key}
          type="button"
          aria-label={a.label}
          aria-pressed={value === a.key}
          data-testid={`accent-${a.key}`}
          onClick={() => onChange(a.key)}
          className={cn(
            "h-6 w-6 rounded-md border transition-transform",
            value === a.key
              ? "scale-110 border-[var(--color-fg)]"
              : "border-transparent hover:scale-105",
          )}
          style={{ backgroundColor: a.css }}
        />
      ))}
    </div>
  );
}

export function NewProfileDialog() {
  const open = useUI(s => s.newProfileOpen);
  const setOpen = useUI(s => s.setNewProfileOpen);
  const profiles = useProfiles(s => s.profiles);
  const refresh = useProfiles(s => s.refresh);

  // Creating the FIRST profile turns the current install into "a profile", so
  // it needs a name and a color at that moment or the strip reads "Default"
  // forever. Chrome asks the same question on its first split.
  const isFirst = profiles.length === 0;

  const [name, setName] = useState("");
  const [accent, setAccent] = useState("blue");
  const [existingName, setExistingName] = useState("Personal");
  const [existingAccent, setExistingAccent] = useState("teal");
  const [tasksPath, setTasksPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(""); setAccent("blue");
    setExistingName("Personal"); setExistingAccent("teal");
    setTasksPath(""); setErr(null); setBusy(false);
  }, [open]);

  const slug = useMemo(() => previewSlug(name), [name]);
  const seededPath = `~/termic/profiles/${slug}/tasks`;
  const canCreate = name.trim().length > 0 && (!isFirst || existingName.trim().length > 0) && !busy;

  const create = async () => {
    if (!canCreate) return;
    setBusy(true); setErr(null);
    try {
      const p = await profileCreate({
        name: name.trim(),
        accent,
        tasksPath: tasksPath.trim(),
        existingName: isFirst ? existingName.trim() : undefined,
        existingAccent: isFirst ? existingAccent : undefined,
      });
      await refresh();
      setOpen(false);
      // A profile opens in a window. Creating one without showing it would
      // leave the user looking at the profile they were already in, wondering
      // whether anything happened.
      await profileOpen(p.slug);
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      title="New profile"
      description="A profile is its own window, with its own projects, tasks, settings and agents."
      className="max-w-lg"
    >
      <div className="flex flex-col gap-4" data-testid="new-profile-dialog">
        {isFirst && (
          <div className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg-2)] p-3">
            <div className="mb-2 text-[12.5px] text-[var(--color-fg-dim)]">
              Your current setup becomes a profile too. Give it a name so you
              can tell the two windows apart.
            </div>
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
                style={{ backgroundColor: profileAccentCss(existingAccent) }}
              >{monogram(existingName || "?")}</span>
              <Input
                value={existingName}
                onChange={e => setExistingName(e.target.value)}
                placeholder="Personal"
                data-testid="existing-profile-name"
                className="flex-1"
              />
            </div>
            <div className="mt-2"><AccentPicker value={existingAccent} onChange={setExistingAccent} /></div>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium">Name</label>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
              style={{ backgroundColor: profileAccentCss(accent) }}
            >{monogram(name || "?")}</span>
            <Input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Work"
              data-testid="new-profile-name"
              onKeyDown={e => { if (e.key === "Enter" && canCreate) void create(); }}
              className="flex-1"
            />
          </div>
          <div className="mt-2"><AccentPicker value={accent} onChange={setAccent} /></div>
        </div>

        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium">Tasks folder</label>
          <Input
            value={tasksPath}
            onChange={e => setTasksPath(e.target.value)}
            placeholder={seededPath}
            data-testid="new-profile-tasks-path"
          />
          <p className="mt-1 text-[11.5px] text-[var(--color-fg-faint)]">
            Where this profile's worktrees are created. Leave empty for{" "}
            <code className="mono">{seededPath}</code>.
          </p>
        </div>

        {err && (
          <div className="rounded-md border border-[var(--color-danger)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void create()} disabled={!canCreate} data-testid="new-profile-create">
            {busy ? "Creating..." : "Create profile"}
          </Button>
        </div>
      </div>
    </AppDialog>
  );
}
