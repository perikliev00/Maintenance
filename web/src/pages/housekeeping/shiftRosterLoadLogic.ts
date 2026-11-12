/**
 * Stale-load guards for shift roster GET/PUT (MA-03).
 * Keeps day-A responses from overwriting day-B draft/editor state.
 */

/** True when a finished GET may write into the editor for `activeDate`. */
export function shouldApplyRosterLoad(input: {
  // Provide requestDate field used by this structure.
  requestDate: string;
  // Provide activeDate field used by this structure.
  activeDate: string;
  // Provide requestId field used by this structure.
  requestId: number;
  // Provide latestRequestId field used by this structure.
  latestRequestId: number;
// Support the surrounding logic for this step.
}): boolean {
  // Return the JSX/UI tree for this render path.
  return (
    // Support the surrounding logic for this step.
    input.requestDate === input.activeDate &&
    // Support the surrounding logic for this step.
    input.requestId === input.latestRequestId
  );
}

/** Save is allowed only with a successfully loaded draft for the active date. */
export function canSaveRosterDraft(input: {
  // Provide activeDate field used by this structure.
  activeDate: string;
  // Provide loadedDate field used by this structure.
  loadedDate: string | null;
  // Provide busy field used by this structure.
  busy: boolean;
// Support the surrounding logic for this step.
}): boolean {
  // Return early result or rendered output from this path.
  return !input.busy && input.loadedDate === input.activeDate;
}

/** Apply PUT result only if the editor is still on the saved hotel date. */
export function shouldApplyRosterSaveResult(input: {
  // Provide savedDate field used by this structure.
  savedDate: string;
  // Provide activeDate field used by this structure.
  activeDate: string;
  // Provide saveRequestId field used by this structure.
  saveRequestId: number;
  // Provide latestSaveRequestId field used by this structure.
  latestSaveRequestId: number;
// Support the surrounding logic for this step.
}): boolean {
  // Return the JSX/UI tree for this render path.
  return (
    // Support the surrounding logic for this step.
    input.savedDate === input.activeDate &&
    // Support the surrounding logic for this step.
    input.saveRequestId === input.latestSaveRequestId
  );
}
