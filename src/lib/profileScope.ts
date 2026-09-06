// Per-profile localStorage namespacing (GH #280).
//
// Every profile window is a webview on the SAME origin, so localStorage is
// shared between them whether we want it or not. Anything keyed by task UUID
// is already safe (UUIDs are disjoint across profiles); anything keyed by a
// name, a project id or nothing at all is silently global and has to be
// namespaced by hand.
//
// The namespace is the WINDOW LABEL, which is available synchronously. That
// matters more than it looks: stores read their keys at module-init time, so
// an async `invoke("profiles_list")` would be too late and every store would
// boot from the wrong profile's state for a frame.
//
// The root profile's keys are UNPREFIXED, deliberately. Its label is `main`,
// which maps to the empty namespace, so an existing install's collapse state,
// folder colors and prompt library are read from exactly the keys they are
// already in. No migration, and no user notices anything.
//
// What is NOT scoped, and must not be: preferences. Theme, fonts, terminal
// settings, editor settings and shortcut bindings are machine-level in
// docs/plans/profiles.md's scope table ("muscle memory does not change per
// identity"), so they stay on their bare keys and are shared by every window.

/// The window label, read once. Falls back to the root namespace outside a
/// Tauri window (vitest, and the `activity.html` entry).
function windowLabel(): string {
  try {
    // Imported lazily off the global Tauri bridge rather than
    // `@tauri-apps/api/window`, so this module stays importable from a plain
    // jsdom test without pulling the whole API surface in.
    const label = (globalThis as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
      .__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
    return typeof label === "string" ? label : "main";
  } catch {
    return "main";
  }
}

/// `""` for the root profile, `"profile-<slug>:"` for every other.
export const PROFILE_NS: string = (() => {
  const label = windowLabel();
  return label === "main" || !label.startsWith("profile-") ? "" : `${label}:`;
})();

/// Namespace a PROFILE-SCOPED localStorage key.
///
/// Use for anything a profile owns: project/task collapse state, folder
/// colors, the prompt library, per-profile dialog memory. Do NOT use for
/// preferences, which are shared on purpose.
export function scoped(key: string): string {
  return PROFILE_NS + key;
}

/// Remove every `profile-<slug>:` key for one profile.
///
/// Called after a profile is deleted, or a recreated profile with the same
/// slug inherits a dead one's collapse state and folder colors.
export function purgeProfileKeys(slug: string): void {
  const prefix = `profile-${slug}:`;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    // Private windows and blocked site data throw on access. A failed purge
    // leaves stale keys, which is untidy; throwing here would break the
    // delete, which is worse.
  }
}
