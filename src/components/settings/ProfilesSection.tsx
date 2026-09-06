// Settings -> Profiles (GH #280). Where profiles are created, renamed,
// recolored and deleted.
//
// This page exists even while the feature is dormant: the sidebar footer's
// profile button lands here, and it is where the first profile is made. That
// is the whole surface until one exists, which is what keeps someone who never
// uses profiles from ever seeing a strip, a name or a color.

import { useEffect, useState } from "react";
import { Plus, Trash2, Check } from "lucide-react";
import { useProfiles } from "@/store/profiles";
import { useUI } from "@/store/ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { profileAccentCss } from "@/lib/accents";
import { AccentDots } from "@/components/ui/AccentDots";
import { profileOpen, profileUpdate, profilesDisable } from "@/lib/ipc";
import { monogram } from "@/components/sidebar/ProfileStrip";
import { cn } from "@/lib/utils";

export function ProfilesSection() {
  const profiles = useProfiles(s => s.profiles);
  const current = useProfiles(s => s.current);
  const refresh = useProfiles(s => s.refresh);
  const openNewProfile = useUI(s => s.openNewProfile);
  const setDeleteSlug = useUI(s => s.setDeleteProfileSlug);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-[15px] font-semibold">Profiles</h2>
        <p className="mt-1 max-w-prose text-[12.5px] text-[var(--color-fg-dim)]">
          A profile is a fully separate Termic: its own projects, tasks,
          settings and agents, in its own window. Two profiles can be open side
          by side and neither can see the other's work.
        </p>
      </div>

      {profiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-6 text-center">
          <p className="text-[13px] text-[var(--color-fg-dim)]">
            You have one setup, and no profiles yet.
          </p>
          <p className="mx-auto mt-1 max-w-md text-[12px] text-[var(--color-fg-faint)]">
            Creating your first profile also names the one you are using now,
            so you can tell the two windows apart. Nothing moves and nothing is
            re-detected: your agents stay logged in.
          </p>
          <Button className="mt-4" onClick={openNewProfile} data-testid="profiles-create-first">
            <Plus className="mr-1.5 h-4 w-4" /> Create a profile
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {profiles.map(p => (
            <ProfileRow
              key={p.slug}
              slug={p.slug}
              name={p.name}
              accent={p.accent}
              isCurrent={p.slug === current}
              isOpen={p.open}
              onChanged={() => void refresh()}
              onDelete={() => setDeleteSlug(p.slug)}
              onSwitch={() => { void profileOpen(p.slug).then(() => refresh()).catch(() => {}); }}
            />
          ))}
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={openNewProfile} data-testid="profiles-create">
              <Plus className="mr-1.5 h-4 w-4" /> New profile
            </Button>
            {/* Backing out of the feature is its own door, and it has to be:
                deleting a profile is refused while its window is open, and the
                last remaining profile is always the one you are looking at.
                This keeps every byte of data; it only stops naming it. */}
            {profiles.length === 1 && (
              <Button
                variant="ghost"
                data-testid="profiles-disable"
                onClick={() => void profilesDisable().then(() => refresh()).catch(() => {})}
              >
                Stop using profiles
              </Button>
            )}
          </div>
        </div>
      )}

      {profiles.length === 1 && (
        <p className="max-w-prose text-[11.5px] text-[var(--color-fg-faint)]">
          "Stop using profiles" keeps every project, task and setting exactly
          where it is. It only stops giving this window a name.
        </p>
      )}

      <p className="max-w-prose text-[11.5px] text-[var(--color-fg-faint)]">
        Every profile signs in to your agents with the same account today.
        Separate accounts per profile are a separate piece of work.
      </p>
    </div>
  );
}

function ProfileRow({ slug, name, accent, isCurrent, isOpen, onChanged, onDelete, onSwitch }: {
  slug: string; name: string; accent: string;
  isCurrent: boolean; isOpen: boolean;
  onChanged: () => void; onDelete: () => void; onSwitch: () => void;
}) {
  const [draft, setDraft] = useState(name);
  // Re-seed when the store changes underneath (another window renamed it).
  useEffect(() => { setDraft(name); }, [name]);

  const commitName = () => {
    const next = draft.trim();
    if (!next || next === name) { setDraft(name); return; }
    void profileUpdate(slug, next).then(onChanged).catch(() => setDraft(name));
  };

  return (
    <div
      data-testid={`profile-settings-row-${slug}`}
      className="flex items-center gap-3 rounded-lg border border-[var(--color-border-soft)] p-3"
    >
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white"
        style={{ backgroundColor: profileAccentCss(accent) }}
      >{monogram(name)}</span>

      <div className="min-w-0 flex-1">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={e => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") { setDraft(name); (e.target as HTMLInputElement).blur(); }
          }}
          data-testid={`profile-name-${slug}`}
          className="h-7"
        />
        <div className="mt-1.5">
          <AccentDots
            value={accent}
            idPrefix={`profile-${slug}`}
            onChange={next => void profileUpdate(slug, undefined, next).then(onChanged).catch(() => {})}
          />
        </div>
        {/* The slug is frozen and visible on purpose: it names the folders on
            disk, so someone looking for their worktrees can find them. */}
        <div className="mt-1 text-[11px] text-[var(--color-fg-faint)]">
          <code className="mono">{slug}</code>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {isCurrent ? (
          <span className="flex items-center gap-1 text-[11.5px] text-[var(--color-fg-dim)]">
            <Check className="h-3.5 w-3.5" /> This window
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={onSwitch} data-testid={`profile-switch-${slug}`}>
            {isOpen ? "Focus" : "Open"}
          </Button>
        )}
        {/* Deleting the profile you are IN is refused by Rust (its window is
            open), so the button is disabled here rather than failing later. */}
        <Button
          size="icon"
          variant="icon"
          title={isCurrent ? "Close this window first" : "Delete profile"}
          disabled={isCurrent}
          onClick={onDelete}
          data-testid={`profile-delete-${slug}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
