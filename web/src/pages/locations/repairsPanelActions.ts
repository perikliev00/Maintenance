/**
 * Decide whether a ticket lifecycle onDone should reload the repairs panel.
 * Queued (offline) actions keep the current list until a confirmed apply.
 */
export function shouldReloadRepairsAfterDone(result: {
  // Provide queued field used by this structure.
  queued: boolean;
// Support the surrounding logic for this step.
}): boolean {
  // Return early result or rendered output from this path.
  return result.queued === false;
}
