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

/** Profiles always render an accent (the strip is tinted by it), so they need
 *  a fallback where groups fall back to "no styling". */
export const PROFILE_ACCENT_FALLBACK = "var(--color-fg-faint)";
export const profileAccentCss = (key: string | undefined): string =>
  accentCss(key) ?? PROFILE_ACCENT_FALLBACK;
