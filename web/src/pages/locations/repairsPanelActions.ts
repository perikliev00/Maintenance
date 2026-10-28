/**
 * Decide whether a ticket lifecycle onDone should reload the repairs panel.
 * Queued (offline) actions keep the current list until a confirmed apply.
 */
export function shouldReloadRepairsAfterDone(result: {
  queued: boolean;
}): boolean {
  return result.queued === false;
}
