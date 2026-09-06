// The shared accent palette: sidebar group folders and profiles (GH #280).
//
// Keys persist (localStorage for groups, profiles.json for profiles) and
// resolve to the `--color-palette-*` tokens in index.css @theme, so an accent
// stays correct across themes and a theme author can restyle every accent in
// the app at once. Storing the KEY rather than a literal hex is also what
// keeps profiles.json readable and keeps hex out of anything but @theme.
//
// An unknown stored key (hand-edited storage, a palette entry removed in a
// future version) resolves to undefined = default styling, never a crash.

export const ACCENTS: { key: string; label: string; css: string }[] = [
  { key: "red",    label: "Red",    css: "var(--color-palette-red)" },
  { key: "orange", label: "Orange", css: "var(--color-palette-orange)" },
  { key: "yellow", label: "Yellow", css: "var(--color-palette-yellow)" },
  { key: "green",  label: "Green",  css: "var(--color-palette-green)" },
  { key: "teal",   label: "Teal",   css: "var(--color-palette-teal)" },
  { key: "blue",   label: "Blue",   css: "var(--color-palette-blue)" },
  { key: "purple", label: "Purple", css: "var(--color-palette-purple)" },
  { key: "pink",   label: "Pink",   css: "var(--color-palette-pink)" },
];

export const accentCss = (key: string | undefined): string | undefined =>
  ACCENTS.find(c => c.key === key)?.css;

/** Is this stored accent a literal colour rather than a palette key?
 *
 *  Profiles may carry a hex the user picked, so the stored value is either a
 *  key from the table above or `#rgb` / `#rrggbb` / `#rrggbbaa`. Checked by
 *  shape rather than trusted: it is written straight into a `backgroundColor`,
 *  and a value that is neither has to fall back rather than paint nothing.
 *
 *  A user-chosen hex in `profiles.json` is DATA, not a hardcoded style, so it
 *  does not conflict with the rule against hex outside `@theme`: that rule is
 *  about the app's own colours, which still all come from tokens. */
export const isHexAccent = (v: string | undefined): boolean =>
  !!v && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);

/** Profiles always render an accent (the strip is tinted by it), so they need
 *  a fallback where groups fall back to "no styling". */
export const PROFILE_ACCENT_FALLBACK = "var(--color-fg-faint)";
export const profileAccentCss = (key: string | undefined): string =>
  (isHexAccent(key) ? key : accentCss(key)) ?? PROFILE_ACCENT_FALLBACK;
