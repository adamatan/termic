// Profiles (GH #280): the registry as this window sees it.
//
// Deliberately tiny and NOT part of the app store. Profiles change about once
// a month, and folding them into `useApp` would put a rarely-changing slice
// behind the same subscription every task row already re-runs against
// (docs/performance.md bear trap 8). A separate store means a profile rename
// re-renders the strip and nothing else.

import { create } from "zustand";
import { profilesList } from "@/lib/ipc";
import type { ProfileView } from "@/lib/types";

interface ProfilesState {
  profiles: ProfileView[];
  /** This window's slug. `null` while loading AND in the dormant state; use
   *  `loaded` to tell them apart, because the strip must not flash. */
  current: string | null;
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const useProfiles = create<ProfilesState>((set) => ({
  profiles: [],
  current: null,
  loaded: false,
  refresh: async () => {
    try {
      const v = await profilesList();
      set({ profiles: v.profiles, current: v.current, loaded: true });
    } catch {
      // A failed read leaves the feature dormant rather than breaking the
      // sidebar: the strip is additive, so showing nothing is a safe floor.
      set({ loaded: true });
    }
  },
}));

/** The profile this window is, or `null` in the dormant state. */
export function currentProfile(): ProfileView | null {
  const { profiles, current } = useProfiles.getState();
  return profiles.find((p) => p.slug === current) ?? null;
}
