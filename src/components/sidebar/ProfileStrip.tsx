// The profile indicator (GH #280): a full-width strip directly ABOVE the
// sidebar footer, carrying the accent tile and the profile NAME IN CLEAR.
//
// Two states, and the first one is "this feature does not exist yet":
//
//   Dormant (no profiles created). No strip. The footer gains one icon
//   button, which opens Settings to Profiles. Anyone who never uses the
//   feature never sees a strip, a name, or a color.
//
//   Profiles exist. The strip appears, tinted with the profile's accent,
//   because it is the largest always-on surface the accent gets and the
//   accent is what people actually read at a glance. Clicking it opens the
//   popover: every profile, with the open ones marked.
//
// Switching IS opening a window (one window per profile), so clicking a
// profile focuses its window if it is up and launches it if it is not. From
// the user's side that is one action, which is why the rows do not
// distinguish them.

import { useEffect, useState } from "react";
import { Check, ChevronUp, Plus, Settings2 } from "lucide-react";
import { useProfiles } from "@/store/profiles";
import { useApp } from "@/store/app";
import { useUI } from "@/store/ui";
import { profileOpen } from "@/lib/ipc";
import { PopoverRoot, PopoverTrigger, PopoverContent } from "@/components/ui/Popover";
import { profileAccentCss } from "@/lib/accents";
import { cn } from "@/lib/utils";

/** A readable monogram for the accent tile.
 *
 *  One letter per WORD, capped at two: "Personal" is P, "Side Project" is SP.
 *  Deliberately not the first two letters of a single word, which gave PE and
 *  WO and read like ticker symbols rather than the avatar every browser's
 *  profile switcher uses. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ProfileStrip({ compact }: { compact: boolean }) {
  const profiles = useProfiles(s => s.profiles);
  const current  = useProfiles(s => s.current);
  const refresh  = useProfiles(s => s.refresh);
  const openSettings = useApp(s => s.openSettings);
  const openNewProfile = useUI(s => s.openNewProfile);
  const [open, setOpen] = useState(false);

  // Dormant: render nothing at all. The footer's profile button is the whole
  // surface until the first profile exists.
  if (profiles.length === 0) return null;

  const me = profiles.find(p => p.slug === current);
  // A window whose profile is not in the registry (deleted from another
  // window, mid-refresh) still has to render something rather than vanish.
  const name = me?.name ?? "Termic";
  const accent = profileAccentCss(me?.accent);

  const switchTo = async (slug: string) => {
    setOpen(false);
    try { await profileOpen(slug); } catch { /* the window may have just closed */ }
    void refresh();
  };

  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="profile-strip"
          title={compact ? name : undefined}
          className={cn(
            "flex w-full items-center gap-2 border-t border-[var(--color-border-soft)]",
            "text-left transition-colors hover:bg-[var(--color-bg-2)]",
            // Reuse --bottom-bar-h: this is one more bar of the same kind, not
            // a new metric. Compact keeps the rail's identity-over-controls
            // rule: tile and monogram, no name.
            compact ? "h-[var(--bottom-bar-h)] justify-center px-0" : "h-[var(--bottom-bar-h)] px-2",
          )}
          style={{
            // A wash of the accent, not a block of it: the strip sits under a
            // dense project list and a saturated bar there reads as an error
            // state. `color-mix` keeps it correct in both themes without a
            // second stored value.
            backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
          }}
        >
          <span
            aria-hidden
            data-testid="profile-tile"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[10px] font-semibold text-white"
            style={{ backgroundColor: accent }}
          >{monogram(name)}</span>
          {!compact && (
            <>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{name}</span>
              <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-50" />
            </>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent side="top" align="start" className="w-60 p-1.5" >
        <div className="px-2 pb-1.5 pt-1 text-[11px] uppercase tracking-wide opacity-50">Profiles</div>
        {profiles.map(p => (
          <button
            key={p.slug}
            type="button"
            data-testid={`profile-row-${p.slug}`}
            onClick={() => void switchTo(p.slug)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]",
              "hover:bg-[var(--color-bg-2)]",
            )}
          >
            <span
              aria-hidden
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[10px] font-semibold text-white"
              style={{ backgroundColor: profileAccentCss(p.accent) }}
            >{monogram(p.name)}</span>
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {/* "Open" is the state worth marking. Clicking is one action
                either way, so the marker is information, not a different
                button. */}
            {p.slug === current
              ? <Check className="h-3.5 w-3.5 shrink-0 opacity-70" />
              : p.open
                ? <span className="shrink-0 text-[10px] opacity-45">open</span>
                : null}
          </button>
        ))}
        <div className="my-1 h-px bg-[var(--color-border-soft)]" />
        <button
          type="button"
          data-testid="profile-new"
          onClick={() => { setOpen(false); openNewProfile(); }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[var(--color-bg-2)]"
        >
          <Plus className="h-4 w-4 opacity-60" /> New profile...
        </button>
        <button
          type="button"
          data-testid="profile-manage"
          onClick={() => { setOpen(false); openSettings("profiles"); }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[var(--color-bg-2)]"
        >
          <Settings2 className="h-4 w-4 opacity-60" /> Manage profiles
        </button>
      </PopoverContent>
    </PopoverRoot>
  );
}

/** Keeps this window's registry view fresh. Mounted once, in the sidebar. */
export function useProfilesSync() {
  const refresh = useProfiles(s => s.refresh);
  useEffect(() => {
    void refresh();
    // Any window can create, rename or delete a profile, so every window
    // listens. Rust broadcasts this one deliberately: it is genuinely global.
    let un: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("termic://profiles-changed", () => { void refresh(); }).then(f => { un = f; })
    );
    return () => un?.();
  }, [refresh]);
}
