// @vitest-environment happy-dom
//
// The remembered "open with" pick: its codec, and the rule that every
// unhonourable value degrades to the file manager rather than throwing.
// This is parsed at module load, before first paint, so a corrupt value must
// never be able to stop the app starting.

import { describe, it, expect } from "vitest";
import {
  FILE_MANAGER_KEY, FILE_MANAGER_PICK, encodeOpenWithPick, groupApps,
  openWithIcon, openWithLabel, parseOpenWithPick, pickFromApp,
} from "@/lib/openWith";
import { FILE_MANAGER } from "@/lib/openExternal";
import type { ExternalAppInfo } from "@/lib/types";

const cursor = { key: "cursor", label: "Cursor", kind: "editor" as const };

describe("parseOpenWithPick", () => {
  it("round-trips a real pick", () => {
    expect(parseOpenWithPick(encodeOpenWithPick(cursor))).toEqual(cursor);
  });

  it("defaults to the file manager when nothing is stored", () => {
    // The pre-picker behaviour: the button opened the file manager.
    for (const raw of [null, undefined, ""]) {
      expect(parseOpenWithPick(raw)).toEqual(FILE_MANAGER_PICK);
    }
  });

  it("falls back instead of throwing on a corrupt blob", () => {
    // Runs at module load. A throw here is a white window, not a bad button.
    for (const raw of ["{", "not json", "[]", "null", '"cursor"', "42"]) {
      expect(parseOpenWithPick(raw)).toEqual(FILE_MANAGER_PICK);
    }
  });

  it("rejects a partial or wrongly-typed record", () => {
    const bad = [
      { label: "Cursor", kind: "editor" },            // no key
      { key: "cursor", kind: "editor" },              // no label
      { key: "cursor", label: "Cursor" },             // no kind
      { key: "cursor", label: "Cursor", kind: "ide" },// kind not in the union
      { key: "", label: "Cursor", kind: "editor" },   // empty key
      { key: "cursor", label: "", kind: "editor" },   // empty label
      { key: 7, label: "Cursor", kind: "editor" },    // key not a string
    ];
    for (const v of bad) {
      expect(parseOpenWithPick(JSON.stringify(v))).toEqual(FILE_MANAGER_PICK);
    }
  });

  it("re-derives the file manager's label rather than trusting the stored one", () => {
    // A profile carried between a Mac and a Linux box must not keep saying
    // "Finder" on the machine that has none. FILE_MANAGER is the ONE
    // definition of that word (openExternal.ts).
    const stale = JSON.stringify({ key: FILE_MANAGER_KEY, label: "Explorer", kind: "file-manager" });
    expect(parseOpenWithPick(stale).label).toBe(FILE_MANAGER);
  });

  it("hands back a frozen shared default, not a fresh object", () => {
    // The store takes this as its initial value and the title bar selects it
    // directly. A new object per read would invalidate that selector on every
    // unrelated prefs write (docs/performance.md bear trap 5).
    expect(parseOpenWithPick(null)).toBe(parseOpenWithPick("{"));
    expect(Object.isFrozen(FILE_MANAGER_PICK)).toBe(true);
  });
});

describe("openWithLabel", () => {
  it("names the app, and the file manager per platform", () => {
    expect(openWithLabel(cursor)).toBe("Cursor");
    expect(openWithLabel(FILE_MANAGER_PICK)).toBe(FILE_MANAGER);
  });

  it("ignores a stored file-manager label even if one slips through", () => {
    expect(openWithLabel({ key: FILE_MANAGER_KEY, label: "Nautilus", kind: "file-manager" }))
      .toBe(FILE_MANAGER);
  });
});

describe("pickFromApp", () => {
  it("takes the label from Rust for a real app", () => {
    expect(pickFromApp({ key: "warp", label: "Warp", kind: "terminal" })).toEqual({
      key: "warp", label: "Warp", kind: "terminal",
    });
  });

  it("substitutes the frontend's word for the file manager", () => {
    // Rust sends "Finder" unconditionally; the frontend owns the wording so
    // this menu and the file context menu cannot disagree.
    expect(pickFromApp({ key: FILE_MANAGER_KEY, label: "Finder", kind: "file-manager" }))
      .toBe(FILE_MANAGER_PICK);
  });
});

describe("openWithIcon", () => {
  it("gives each group its own glyph", () => {
    const icons = [
      openWithIcon("file-manager"), openWithIcon("editor"), openWithIcon("terminal"),
    ];
    expect(new Set(icons).size).toBe(3);
  });
});

describe("groupApps", () => {
  const app = (key: string, kind: ExternalAppInfo["kind"]): ExternalAppInfo =>
    ({ key, label: key, kind });

  it("orders the groups file manager, editors, terminals", () => {
    // The menu draws one separator per boundary, so a terminal sorted among
    // the editors would put a separator in the middle of them.
    const groups = groupApps([
      app("warp", "terminal"),
      app("cursor", "editor"),
      app("file-manager", "file-manager"),
      app("zed", "editor"),
    ]);
    expect(groups.map(g => g[0].kind)).toEqual(["file-manager", "editor", "terminal"]);
    expect(groups[1].map(a => a.key)).toEqual(["cursor", "zed"]);
  });

  it("drops empty groups so two separators never render in a row", () => {
    const groups = groupApps([app("file-manager", "file-manager"), app("warp", "terminal")]);
    expect(groups).toHaveLength(2);
  });

  it("survives an empty list", () => {
    // openWithApps() rejecting leaves the menu with [].
    expect(groupApps([])).toEqual([]);
  });
});
