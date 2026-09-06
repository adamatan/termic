import { describe, it, expect } from "vitest";
import { bulkAddSummary, pathsToAdd, type BulkAddResult } from "@/lib/bulkAdd";

const ok = (name: string): BulkAddResult => ({ path: `/r/${name}`, name });
const bad = (name: string, error: string): BulkAddResult => ({ path: `/r/${name}`, name, error });

describe("bulkAddSummary", () => {
  it("names the project when exactly one was added", () => {
    // "Added 1 projects" is the tell of a lazy plural, and one repo is the
    // common case: the count says nothing the name does not say better.
    expect(bulkAddSummary([ok("app")])).toEqual({ text: "Added app", ok: true });
  });

  it("counts them when several were added", () => {
    expect(bulkAddSummary([ok("a"), ok("b"), ok("c")]).text).toBe("Added 3 projects");
  });

  it("reports a partial sweep as both numbers", () => {
    // The case the whole function exists for. Neither "Added 2" nor
    // "Could not add 1" is honest on its own, and making the user subtract
    // to find the failures is worse than either.
    const r = bulkAddSummary([ok("a"), ok("b"), bad("c", "already added")]);
    expect(r).toEqual({ text: "Added 2, 1 failed", ok: false });
  });

  it("gives the reason when the only repo failed", () => {
    expect(bulkAddSummary([bad("c", "not a git repo")]).text)
      .toBe("Could not add c: not a git repo");
  });

  it("does not paste every reason when several failed", () => {
    const r = bulkAddSummary([bad("a", "x"), bad("b", "y"), bad("c", "z")]);
    expect(r.text).toBe("Could not add 3 projects");
    expect(r.ok).toBe(false);
  });
});

describe("pathsToAdd", () => {
  const available = [{ path: "/r/a" }, { path: "/r/b" }];

  it("keeps only what is still on offer", () => {
    // A selection outlives the list it was made from: hiding a repo, or an
    // earlier add refreshing discovery, can retire a checked path. Sending it
    // anyway produces an error about something the user can no longer see.
    expect(pathsToAdd(["/r/a", "/r/gone"], available)).toEqual(["/r/a"]);
  });

  it("never sends the same path twice", () => {
    expect(pathsToAdd(["/r/a", "/r/a", "/r/b"], available)).toEqual(["/r/a", "/r/b"]);
  });

  it("answers empty when nothing survives", () => {
    expect(pathsToAdd(["/r/gone"], available)).toEqual([]);
    expect(pathsToAdd([], available)).toEqual([]);
  });
});
