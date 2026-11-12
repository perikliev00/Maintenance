/**
 * Stale-load guards for shift roster GET/PUT (MA-03).
 * Keeps day-A responses from overwriting day-B draft/editor state.
 */

/** True when a finished GET may write into the editor for `activeDate`. */
export function shouldApplyRosterLoad(input: {
  requestDate: string;
  activeDate: string;
  requestId: number;
  latestRequestId: number;
}): boolean {
  return (
    input.requestDate === input.activeDate &&
    input.requestId === input.latestRequestId
  );
}

/** Save is allowed only with a successfully loaded draft for the active date. */
export function canSaveRosterDraft(input: {
  activeDate: string;
  loadedDate: string | null;
  busy: boolean;
}): boolean {
  return !input.busy && input.loadedDate === input.activeDate;
}

/** Apply PUT result only if the editor is still on the saved hotel date. */
export function shouldApplyRosterSaveResult(input: {
  savedDate: string;
  activeDate: string;
  saveRequestId: number;
  latestSaveRequestId: number;
}): boolean {
  return (
    input.savedDate === input.activeDate &&
    input.saveRequestId === input.latestSaveRequestId
  );
}
