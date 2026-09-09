// The title bar's "open with" picker: which app opens the task's worktree.
//
// The button used to be a fixed "Open in Finder". It now launches whichever
// app was picked last, with a menu of everything detected on the machine
// behind a chevron. Rust owns the app TABLE and the launching
// (`open_with_apps` / `open_with_app` in lib.rs); this module owns the
// remembered pick and how a pick is rendered.
//
// Split from the component so the codec and the fallback are testable
// without mounting React, the same reason openExternal.ts exists.

import { Code2, FolderOpen, SquareTerminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FILE_MANAGER } from "@/lib/openExternal";
import type { ExternalAppInfo, OpenWithKind, OpenWithPick } from "@/lib/types";

/** The file manager's key, mirroring `FILE_MANAGER_KEY` in lib.rs. It is the
 *  one entry that needs no detection, so it is also the fallback for every
 *  "we cannot honour the remembered pick" path. */
export const FILE_MANAGER_KEY = "file-manager";

/** The default pick, and where a bad or unhonourable one reverts to. Frozen
 *  and shared: it is handed to the store as an initial value, and a fresh
 *  object per read would invalidate every subscriber on an unrelated write
 *  (docs/performance.md bear trap 5). */
export const FILE_MANAGER_PICK: OpenWithPick = Object.freeze({
  key: FILE_MANAGER_KEY,
  label: FILE_MANAGER,
  kind: "file-manager" as const,
});

const KINDS: readonly OpenWithKind[] = ["file-manager", "editor", "terminal"];

const isKind = (v: unknown): v is OpenWithKind =>
  typeof v === "string" && (KINDS as readonly string[]).includes(v);

/** Decode the stored pick. Anything unrecognisable becomes the file manager
 *  rather than throwing: this runs at module load, and a corrupt value must
 *  degrade to the behaviour that shipped before the picker existed, not stop
 *  the app from starting. */
export function parseOpenWithPick(raw: string | null | undefined): OpenWithPick {
  if (!raw) return FILE_MANAGER_PICK;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return FILE_MANAGER_PICK;
    const { key, label, kind } = v as Record<string, unknown>;
    if (typeof key !== "string" || !key) return FILE_MANAGER_PICK;
    if (typeof label !== "string" || !label) return FILE_MANAGER_PICK;
    if (!isKind(kind)) return FILE_MANAGER_PICK;
    // A stored file-manager pick re-derives its label from FILE_MANAGER, so a
    // profile carried between a Mac and a Linux box does not keep saying
    // "Finder" on the machine that has none.
    if (key === FILE_MANAGER_KEY) return FILE_MANAGER_PICK;
    return { key, label, kind };
  } catch {
    return FILE_MANAGER_PICK;
  }
}

export const encodeOpenWithPick = (p: OpenWithPick): string => JSON.stringify(p);

/** A detected app as the menu offers it. The file manager's label comes from
 *  FILE_MANAGER, not from Rust: that constant is the ONE definition of
 *  "Finder" vs "File Manager" (openExternal.ts), and two sources would let
 *  this menu and the file context menu disagree about the word. */
export const pickFromApp = (app: ExternalAppInfo): OpenWithPick =>
  app.key === FILE_MANAGER_KEY
    ? FILE_MANAGER_PICK
    : { key: app.key, label: app.label, kind: app.kind };

/** What the menu row and the button tooltip read. */
export const openWithLabel = (pick: OpenWithPick): string =>
  pick.key === FILE_MANAGER_KEY ? FILE_MANAGER : pick.label;

/** One icon per GROUP, not per app. lucide ships no Cursor or Warp glyph, and
 *  eight brand SVGs is a bigger change than the feature: the label carries
 *  the identity and the tooltip spells it out. */
export function openWithIcon(kind: OpenWithKind): LucideIcon {
  switch (kind) {
    case "editor":
      return Code2;
    case "terminal":
      return SquareTerminal;
    default:
      return FolderOpen;
  }
}

/** Detected apps split into the menu's groups, in render order. Empty groups
 *  are dropped so the menu never draws two separators in a row. */
export function groupApps(apps: ExternalAppInfo[]): ExternalAppInfo[][] {
  return KINDS
    .map(kind => apps.filter(a => a.kind === kind))
    .filter(group => group.length > 0);
}
