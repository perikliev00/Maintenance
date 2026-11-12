// Import module dependency from ../controlPageState.
import { mergeMutationAndRefresh } from "../controlPageState";

// Export type definition for consumers of this module.
export type RunTicketMutationDeps = {
  // Provide beginBusy field used by this structure.
  beginBusy: (id: string) => boolean;
  // Provide endBusy field used by this structure.
  endBusy: (id: string) => void;
  // Provide refresh field used by this structure.
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  // Provide setError field used by this structure.
  setError: (msg: string | null) => void;
  // Provide setMessage field used by this structure.
  setMessage: (msg: string | null) => void;
  // Provide setRefreshWarning field used by this structure.
  setRefreshWarning: (msg: string | null) => void;
};

// Export function runTicketMutation as part of this module's API.
export async function runTicketMutation(
  // Provide deps field used by this structure.
  deps: RunTicketMutationDeps,
  // Provide ticketId field used by this structure.
  ticketId: string,
  // Provide action field used by this structure.
  action: () => Promise<{ queued: boolean }>,
  // Provide successMessage field used by this structure.
  successMessage: string,
  // Provide queuedMessage field used by this structure.
  queuedMessage: string,
// Support the surrounding logic for this step.
) {
  // Conditional branch for the case described by this guard.
  if (!deps.beginBusy(ticketId)) return;
  // Invoke deps.setError to perform this step.
  deps.setError(null);
  // Invoke deps.setRefreshWarning to perform this step.
  deps.setRefreshWarning(null);
  // Begin guarded block to catch runtime failures.
  try {
    // Bind result for use in the following logic.
    const result = await action();
    // Bind okMessage for use in the following logic.
    const okMessage = result.queued ? queuedMessage : successMessage;
    // Conditional branch for the case described by this guard.
    if (result.queued) {
      // Invoke deps.setMessage to perform this step.
      deps.setMessage(okMessage);
      // Return early result or rendered output from this path.
      return;
    }
    // Begin guarded block to catch runtime failures.
    try {
      // Wait for an async operation before continuing.
      await deps.refresh({ silent: true });
      // Invoke deps.setMessage to perform this step.
      deps.setMessage(okMessage);
      // Invoke deps.setRefreshWarning to perform this step.
      deps.setRefreshWarning(null);
    // Support the surrounding logic for this step.
    } catch (err) {
      // Bind feedback for use in the following logic.
      const feedback = mergeMutationAndRefresh({
        // Provide successMessage field used by this structure.
        successMessage: okMessage,
        // Provide refreshError field used by this structure.
        refreshError:
          // Support the surrounding logic for this step.
          err instanceof Error ? err.message : "Failed to refresh",
      });
      // Invoke deps.setMessage to perform this step.
      deps.setMessage(feedback.message);
      // Invoke deps.setRefreshWarning to perform this step.
      deps.setRefreshWarning(feedback.refreshWarning);
    }
  // Support the surrounding logic for this step.
  } catch (err) {
    // Invoke deps.setError to perform this step.
    deps.setError(err instanceof Error ? err.message : "Action failed");
  // Support the surrounding logic for this step.
  } finally {
    // Invoke deps.endBusy to perform this step.
    deps.endBusy(ticketId);
  }
}
