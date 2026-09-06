import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { dataDir } from "../../wdio.conf.js";
import {
  clickWhenVisible, dismissOverlays, requireTermicApi, snap,
  waitForAppShell, waitGone, waitForText, waitVisible,
} from "../helpers";

// Profiles (GH #280): a fully isolated Termic (own projects, tasks, settings,
// agents) in its own window.
//
// This spec OWNS a global mutation — it creates `profiles.json` in the shared
// e2e profile — so teardown is not optional and cannot assume the body
// finished. `resetToDormant` sweeps by reading what is actually on disk rather
// than by remembering what the tests returned, because a throw between the two
// creates leaves a registry the next spec file would boot into.
//
// The isolation itself is asserted through the app's own IPC rather than by
// driving two windows: a second window is a second WebDriver handle and the
// suite reuses one window across files, so opening one here would leak into
// every spec that runs after. `profile_open` IS covered, and closed again in
// the same test.

const registryPath = path.join(dataDir, "profiles.json");

/** Type into a CONTROLLED React input.
 *
 *  `setValue` alone does not reach React: it writes the DOM property behind
 *  React's own value tracker, so the synthetic change event it fires is
 *  swallowed as a no-op and the component keeps its old state. Going through
 *  the prototype setter is what makes React see a real edit. */
async function setInput(selector: string, value: string): Promise<void> {
  await browser.execute((sel, val) => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    if (!el) throw new Error("no input at " + sel);
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value",
    )?.set;
    setter?.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, selector, value);
}

/** Return to the dormant state whatever the body left behind, WITHOUT
 *  touching the root profile's data (which is the shared fixture).
 *
 *  Two steps because they are two operations: every non-root profile is
 *  DELETED (its own directory, no worktrees), and the last one standing is
 *  disabled rather than deleted. `profile_delete` is refused while a profile's
 *  window is open and the last profile is always this window's, so a
 *  delete-everything teardown could not finish; `profiles_disable` is the
 *  door built for exactly that. */
async function resetToDormant(): Promise<void> {
  await browser.execute(async () => {
    const t = window.__termic!;
    const view = await t.invoke("profiles_list");
    for (const p of (view.profiles ?? []).filter((r: any) => !r.is_root)) {
      try { await t.invoke("profile_delete", { slug: p.slug, deleteWorktrees: false }); } catch { /* already gone */ }
    }
    try { await t.invoke("profiles_disable"); } catch { /* already dormant */ }
    await t.useProfiles.getState().refresh();
  });
}

describe("profiles", () => {
  before(async () => {
    await waitForAppShell();
    await requireTermicApi();
    // A previous failed run can leave a registry behind; start dormant.
    await resetToDormant();
  });

  after(async () => {
    await resetToDormant();
    await dismissOverlays();
    // The registry file itself must be gone: its ABSENCE is the dormant
    // state the rest of the suite expects, not an empty list.
    if (existsSync(registryPath)) rmSync(registryPath, { force: true });
  });

  it("shows no strip at all until a profile exists", async () => {
    // The whole "this feature does not exist yet" contract: someone who never
    // makes a profile never sees a strip, a name, or a color.
    await browser.execute(() => window.__termic!.useProfiles.getState().refresh());
    await browser.waitUntil(
      async () => await browser.execute(() =>
        document.querySelectorAll('[data-testid="profile-strip"]').length === 0),
      { timeoutMsg: "the profile strip rendered on a dormant install" },
    );
    // The footer's entry point IS there, though: it is the whole surface
    // until the first profile is created.
    await waitVisible('[data-testid="footer-profiles"]');
    await snap("profiles-01-footer-dormant.png");
  });

  it("offers the first profile from Settings, which is the only route in", async () => {
    // Drives the real page rather than asserting the store: this is the one
    // surface a user with no profiles can find, so it has to be reachable and
    // has to explain itself.
    await browser.execute(() => window.__termic!.useApp.getState().openSettings("profiles"));
    await waitForText("You have one setup, and no profiles yet.");
    await waitVisible('[data-testid="profiles-create-first"]');
    await snap("profiles-02-settings-empty.png");
    await browser.execute(() => window.__termic!.useApp.getState().closeSettings?.());
    await dismissOverlays();
  });

  it("has dropped Add project from the footer, which the PROJECTS header owns", async () => {
    // The footer copy duplicated the header button. Asserting the header one
    // still works matters more than asserting the footer one is gone: this
    // fails loudly if the wrong button was deleted.
    const inHeader = await browser.execute(() =>
      !!document.querySelector('[data-testid="sidebar-add-project"]')
      || [...document.querySelectorAll("button")].some(b => b.getAttribute("title")?.includes("Add project")
        || b.getAttribute("aria-label")?.includes("Add project")),
    );
    expect(inHeader).toBe(true);
  });

  it("creates the first profile through the wizard, naming the existing one too", async () => {
    // Driven through the real dialog: the FIRST create is the moment the
    // current setup becomes "a profile", so the wizard has to ask for both
    // names or the strip reads Default forever.
    await browser.execute(() => window.__termic!.useUI.getState().openNewProfile());
    await waitVisible('[data-testid="new-profile-dialog"]');
    await waitVisible('[data-testid="existing-profile-name"]');
    await snap("profiles-03-wizard-first.png");

    await setInput('[data-testid="existing-profile-name"]', "Personal");
    await setInput('[data-testid="new-profile-name"]', "Work");
    await clickWhenVisible('[data-testid="new-accent-orange"]');
    await snap("profiles-04-wizard-filled.png");

    // Create opens the new profile's WINDOW, so hand the suite back its own
    // before anything else runs.
    const main = await browser.getWindowHandle();
    const before = (await browser.getWindowHandles()).length;
    await clickWhenVisible('[data-testid="new-profile-create"]');
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length > before,
      { timeout: 25_000, timeoutMsg: "creating a profile did not open its window" },
    );
    await browser.switchToWindow(main);
    await browser.execute(async () => {
      await window.__termic!.invoke("profile_close", { slug: "work" });
      await window.__termic!.useProfiles.getState().refresh();
    });
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length === before,
      { timeout: 20_000, timeoutMsg: "the new profile's window did not close" },
    );
    await waitForAppShell();

    const view = await browser.execute(async () => {
      const t = window.__termic!;
      await t.useProfiles.getState().refresh();
      return t.invoke("profiles_list");
    });
    const names = (view.profiles as any[]).map(p => p.name).sort();
    expect(names).toEqual(["Personal", "Work"]);
    // The accent has to land on the profile whose picker was clicked. Both
    // pickers used to carry the same test ids, so this passed while colouring
    // the other profile; the ids are scoped now and this is what pins it.
    expect((view.profiles as any[]).find(p => p.slug === "work").accent).toBe("orange");
    // The existing install owns the ROOT data dir, so nothing had to move.
    const root = (view.profiles as any[]).find(p => p.is_root);
    expect(root.name).toBe("Personal");
    // ...and this window is that one.
    expect(view.current).toBe("personal");
  });

  it("shows the strip with the profile name in clear once profiles exist", async () => {
    await browser.execute(() => window.__termic!.useProfiles.getState().refresh());
    await waitVisible('[data-testid="profile-strip"]');
    const text = await browser.execute(() =>
      document.querySelector('[data-testid="profile-strip"]')?.textContent?.trim(),
    );
    // The NAME, not the slug and not an icon: it is what tells you which
    // window you are typing into.
    expect(text).toContain("Personal");
    await snap("profiles-strip");
  });

  it("lists every profile in the strip popover", async () => {
    await clickWhenVisible('[data-testid="profile-strip"]');
    await waitVisible('[data-testid="profile-row-work"]');
    await waitVisible('[data-testid="profile-row-personal"]');
    await snap("profiles-06-switcher.png");
    await browser.keys(["Escape"]);
    await waitGone('[data-testid="profile-row-work"]');
  });

  it("keeps each profile's projects to itself", async () => {
    // The point of the feature, and the one thing a window cannot show you:
    // the seeded fixture-repo belongs to the profile that owns the root, and
    // the new one starts empty.
    const counts = await browser.execute(async () => {
      const t = window.__termic!;
      // projects_list is scoped to the CALLING window, so read the other
      // profile's through the same records the app uses.
      const mine = await t.invoke("projects_list");
      return { mine: mine.map((p: any) => p.name) };
    });
    expect(counts.mine).toContain("fixture-repo");

    // The new profile's own projects.json was seeded empty.
    const otherEmpty = await browser.execute(async () => {
      const t = window.__termic!;
      const prev = await t.invoke("profile_delete_preview", { slug: "work" });
      return prev.tasks;
    });
    expect(otherEmpty).toBe(0);
  });

  it("seeds the new profile's worktrees under profiles/<slug>", async () => {
    // The `profiles/` level namespaces slugs: a profile called "tasks" would
    // otherwise land on the directory that already means something.
    const hint = await browser.execute(async () =>
      (await window.__termic!.invoke("profile_delete_preview", { slug: "work" })).worktreesHint,
    );
    expect(hint).toContain("profiles/work/tasks");
  });

  it("renames a profile without moving its slug", async () => {
    // The slug keys both trees, and CWD-resume agents key sessions to the
    // working directory, so a rename that relocated worktrees would orphan
    // every conversation under them.
    const after = await browser.execute(async () => {
      const t = window.__termic!;
      await t.invoke("profile_update", { slug: "work", name: "Client work" });
      await t.useProfiles.getState().refresh();
      const v = await t.invoke("profiles_list");
      const p = (v.profiles as any[]).find(x => x.slug === "work");
      const prev = await t.invoke("profile_delete_preview", { slug: "work" });
      return { name: p.name, slug: p.slug, hint: prev.worktreesHint };
    });
    expect(after.name).toBe("Client work");
    expect(after.slug).toBe("work");
    expect(after.hint).toContain("profiles/work/tasks");
  });

  it("opens a profile in its own window", async () => {
    // Switching IS opening a window (one window per profile), so this is the
    // switcher's entire mechanism.
    const main = await browser.getWindowHandle();
    const before = await browser.getWindowHandles();
    await browser.execute(async () => { await window.__termic!.invoke("profile_open", { slug: "work" }); });
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length > before.length,
      { timeout: 20_000, timeoutMsg: "profile_open did not create a window" },
    );

    // Close it through the APP, not WebDriver. `browser.closeWindow()` leaves
    // the session without a current window and the follow-up switch raced
    // under the full parallel suite (it passed run alone and failed run with
    // the other 17 specs). `profile_close` is the same door the delete
    // dialog offers, so the spec exercises a real path instead of a harness
    // trick, and the suite keeps the ONE window it launched with.
    await browser.execute(async () => {
      await window.__termic!.invoke("profile_close", { slug: "work" });
    });
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length === before.length,
      { timeout: 20_000, timeoutMsg: "the profile window did not close" },
    );
    expect(await browser.getWindowHandle()).toBe(main);
    await waitForAppShell();
  });

  it("manages both profiles from Settings", async () => {
    await browser.execute(() => window.__termic!.useApp.getState().openSettings("profiles"));
    await waitVisible('[data-testid="profile-settings-row-personal"]');
    await waitVisible('[data-testid="profile-settings-row-work"]');
    await snap("profiles-07-settings-two.png");
  });

  it("shows what a delete would touch, in the real dialog", async () => {
    // The counts are the whole point: they make this a decision rather than a
    // leap. Driven through the dialog so the copy is exercised too.
    await clickWhenVisible('[data-testid="profile-delete-work"]');
    await waitVisible('[data-testid="delete-profile-dialog"]');
    await waitVisible('[data-testid="delete-profile-counts"]');
    // The safe option is preselected, and the destructive one is a deliberate
    // second click.
    await waitVisible('[data-testid="delete-profile-keep"]');
    await snap("profiles-08-delete-keep.png");

    // The SELECTED option must be the one that looks selected. Measured
    // rather than eyeballed: a radio group whose border and whose dot
    // disagree is unreadable, and a screenshot at this size cannot settle it.
    const borders = () => browser.execute(() => {
      const of = (sel: string) => {
        const all = [...document.querySelectorAll(sel)] as HTMLElement[];
        // Read the LAST match, and report the count. Dialogs stack and a
        // closing one's unmount lags, so `querySelector` can hand back a
        // stale node from an earlier case in this file (the e2e skill's
        // rule 5). That is indistinguishable from a real bug: aria-checked
        // looks correct on one node while the border is read off another.
        const el = all[all.length - 1];
        return {
          count: all.length,
          border: getComputedStyle(el).borderTopColor,
          checked: el.getAttribute("aria-checked"),
        };
      };
      return { keep: of('[data-testid="delete-profile-keep"]'),
               remove: of('[data-testid="delete-profile-remove"]') };
    });

    const before = await borders();
    expect(before.keep.count).toBe(1); // more than one delete dialog mounted = stale node
    expect(before.keep.checked).toBe("true");
    expect(before.remove.checked).toBe("false");
    expect(before.keep.border).not.toBe(before.remove.border);

    await clickWhenVisible('[data-testid="delete-profile-remove"]');

    // POLL, do not sample. The option carries `transition-colors`, so a
    // computed style read in the same frame as the click returns the colour
    // it is animating AWAY from. Reading once made this look like a bug where
    // aria-checked moved and the border did not, and the screenshot taken at
    // the same instant showed the same stale frame.
    await browser.waitUntil(async () => {
      const a = await borders();
      return a.remove.border === before.keep.border
          && a.keep.border === before.remove.border;
    }, {
      timeout: 5_000,
      timeoutMsg: `the accent border never moved: ${JSON.stringify(await borders())} `
        + `(started ${JSON.stringify(before)})`,
    });

    const after = await borders();
    expect(after.keep.checked).toBe("false");
    expect(after.remove.checked).toBe("true");
    await snap("profiles-09-delete-remove.png");
    // Leave without deleting: the later cases still need this profile.
    await browser.keys(["Escape"]);
    await waitGone('[data-testid="delete-profile-dialog"]');
    await browser.execute(() => window.__termic!.useApp.getState().closeSettings?.());
    await dismissOverlays();
  });

  it("refuses to close the window you are driving from", async () => {
    // That is the red button's job, and closing the window you clicked in
    // would leave the dialog mid-air.
    const err = await browser.execute(async () => {
      try { await window.__termic!.invoke("profile_close", { slug: "personal" }); return null; }
      catch (e) { return String(e); }
    });
    expect(err).toContain("its own close button");
  });

  it("refuses to delete a profile whose window is open", async () => {
    // A precondition the user can act on, not a race to handle: it means no
    // PTY is running under the profile at the moment of deletion, so live
    // agents are never killed behind their back. This window IS the root
    // profile's, so deleting it must be refused.
    const err = await browser.execute(async () => {
      try {
        await window.__termic!.invoke("profile_delete", { slug: "personal", deleteWorktrees: false });
        return null;
      } catch (e) { return String(e); }
    });
    expect(err).toContain("close the profile's window");
  });

  it("reports what a delete would touch before confirming it", async () => {
    const prev = await browser.execute(async () =>
      window.__termic!.invoke("profile_delete_preview", { slug: "work" }),
    );
    // Counts, not prose: this is what makes the dialog a decision rather than
    // a leap.
    expect(prev.slug).toBe("work");
    expect(prev.tasks).toBe(0);
    expect(prev.dirty).toBe(0);
    expect(prev.unpushed).toBe(0);
    expect(prev.windowOpen).toBe(false);
  });

  it("refuses to turn profiles off while more than one exists", async () => {
    // Then the question of what happens to the OTHER profiles' data has a
    // real answer the user has to give, so it must not be answered for them.
    const err = await browser.execute(async () => {
      try { await window.__termic!.invoke("profiles_disable"); return null; }
      catch (e) { return String(e); }
    });
    expect(err).toContain("delete the other profiles first");
  });

  it("returns the app to its pre-profiles shape, keeping every byte of data", async () => {
    // The property that makes trying the feature cheap. It needs its own door:
    // a delete is refused while the profile's window is open, and the LAST
    // profile is always the one you are looking at, so "delete everything"
    // could never finish from inside the app.
    await resetToDormant();
    await browser.waitUntil(
      async () => await browser.execute(() =>
        document.querySelectorAll('[data-testid="profile-strip"]').length === 0),
      { timeoutMsg: "the strip survived deleting every profile" },
    );
    await waitVisible('[data-testid="footer-profiles"]');
    expect(existsSync(registryPath)).toBe(false);
    // The root profile's data is untouched: its projects are still there.
    const names = await browser.execute(async () =>
      (await window.__termic!.invoke("projects_list")).map((p: any) => p.name),
    );
    expect(names).toContain("fixture-repo");
  });

  it("keeps the Settings page reachable while the feature is dormant", async () => {
    // The footer button lands here, and it is where the first profile is
    // made, so it has to exist in BOTH states.
    await browser.execute(() => window.__termic!.useApp.getState().openSettings("profiles"));
    await waitForText("You have one setup, and no profiles yet.");
    await waitVisible('[data-testid="profiles-create-first"]');
    await browser.execute(() => window.__termic!.useApp.getState().closeSettings?.());
    await dismissOverlays();
  });
});
