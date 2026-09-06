// Adding several discovered repos in one sweep (GH #280 follow-up).
//
// Pure, because the interesting part is what happens when SOME of them fail.
// A sweep that adds nine repos and hits one error must not look like a total
// failure, and must not look like a total success either: the user needs to
// know which one did not land and why, without losing the nine that did.

/** One repo's outcome. */
export interface BulkAddResult {
  path: string;
  name: string;
  error?: string;
}

/**
 * The sentence shown when a sweep finishes.
 *
 * Singular and plural are separate strings rather than a "1 project(s)" hedge,
 * and the partial case names the count on BOTH sides so "8 added, 2 failed"
 * never has to be worked out by subtraction.
 */
export function bulkAddSummary(results: BulkAddResult[]): { text: string; ok: boolean } {
  const failed = results.filter(r => r.error);
  const added = results.length - failed.length;
  if (failed.length === 0) {
    return {
      text: added === 1 ? `Added ${results[0].name}` : `Added ${added} projects`,
      ok: true,
    };
  }
  if (added === 0) {
    // Nothing landed. One failure names the reason; several would make the
    // toast a wall of text, so the count carries it and the list stays on
    // screen for a retry.
    return {
      text: failed.length === 1
        ? `Could not add ${failed[0].name}: ${failed[0].error}`
        : `Could not add ${failed.length} projects`,
      ok: false,
    };
  }
  return { text: `Added ${added}, ${failed.length} failed`, ok: false };
}

/**
 * Which of the checked paths are still worth trying.
 *
 * A selection outlives the list it was made from: repos get hidden, the filter
 * changes, and an add refreshes discovery. Anything no longer on offer is
 * dropped rather than sent, because the alternative is an error about a repo
 * the user can no longer see.
 */
export function pathsToAdd(selected: Iterable<string>, available: readonly { path: string }[]): string[] {
  const live = new Set(available.map(r => r.path));
  return [...new Set(selected)].filter(p => live.has(p));
}
