import { mergeMutationAndRefresh } from "../controlPageState";

export type RunTicketMutationDeps = {
  beginBusy: (id: string) => boolean;
  endBusy: (id: string) => void;
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  setError: (msg: string | null) => void;
  setMessage: (msg: string | null) => void;
  setRefreshWarning: (msg: string | null) => void;
};

export async function runTicketMutation(
  deps: RunTicketMutationDeps,
  ticketId: string,
  action: () => Promise<{ queued: boolean }>,
  successMessage: string,
  queuedMessage: string,
) {
  if (!deps.beginBusy(ticketId)) return;
  deps.setError(null);
  deps.setRefreshWarning(null);
  try {
    const result = await action();
    const okMessage = result.queued ? queuedMessage : successMessage;
    if (result.queued) {
      deps.setMessage(okMessage);
      return;
    }
    try {
      await deps.refresh({ silent: true });
      deps.setMessage(okMessage);
      deps.setRefreshWarning(null);
    } catch (err) {
      const feedback = mergeMutationAndRefresh({
        successMessage: okMessage,
        refreshError:
          err instanceof Error ? err.message : "Failed to refresh",
      });
      deps.setMessage(feedback.message);
      deps.setRefreshWarning(feedback.refreshWarning);
    }
  } catch (err) {
    deps.setError(err instanceof Error ? err.message : "Action failed");
  } finally {
    deps.endBusy(ticketId);
  }
}
