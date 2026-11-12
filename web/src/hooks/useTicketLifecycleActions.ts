/**
 * Shared assign / close / report / reopen wiring for offline-aware ticket
 * actions. Screen-specific permission gates and which buttons to show stay
 * with the caller; this hook only owns busy-gate + queue + refresh feedback.
 */
import { useCallback, useMemo, useRef } from "react";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  assignTicketQueued,
  // List item in import/export/params.
  closeTicketQueued,
  // List item in import/export/params.
  reopenTicketQueued,
  // List item in import/export/params.
  reportTicketQueued,
// Close multi-line construct with trailing syntax.
} from "../offline/mutations";
// Import dependency used by this module.
import { t } from "../i18n";

// Export type alias for consumers.
export type TicketLifecycleActionDeps = {
  // Arrow function / callback body.
  beginBusy: (id: string) => boolean;
  // Arrow function / callback body.
  endBusy: (id: string) => void;
  // Arrow function / callback body.
  setError: (msg: string | null) => void;
  // Arrow function / callback body.
  setMessage: (msg: string | null) => void;
  /** Optional follow-up refresh after a successful online apply. */
  refresh?: () => Promise<void>;
  /** Called when refresh after a successful mutate fails. */
  setRefreshWarning?: (msg: string | null) => void;
  // Field/property in this shape.
  locale?: "bg" | "en";
};

// Local type alias shaping data.
type QueuedResult = { queued: boolean };

// Function definition.
async function runQueuedAction(
  // Field/property in this shape.
  deps: TicketLifecycleActionDeps,
  // Field/property in this shape.
  busyKey: string,
  // Arrow function / callback body.
  action: () => Promise<QueuedResult>,
  // Field/property in this shape.
  successMessage: string,
  // Field/property in this shape.
  queuedMessage: string,
// Open multi-line construct.
): Promise<QueuedResult | null> {
  // Conditional branch for this case.
  if (!deps.beginBusy(busyKey)) return null;
  // Invoke helper or pass arguments.
  deps.setError(null);
  // Invoke helper or pass arguments.
  deps.setRefreshWarning?.(null);
  // Guard fallible work.
  try {
    // Local constant binding.
    const result = await action();
    // Local constant binding.
    const okMessage = result.queued ? queuedMessage : successMessage;
    // Conditional branch for this case.
    if (result.queued || !deps.refresh) {
      // Invoke helper or pass arguments.
      deps.setMessage(okMessage);
      // Return computed result to caller.
      return result;
    }
    // Guard fallible work.
    try {
      // Await async work before continuing.
      await deps.refresh();
      // Invoke helper or pass arguments.
      deps.setMessage(okMessage);
      // Invoke helper or pass arguments.
      deps.setRefreshWarning?.(null);
    // Invoke helper or pass arguments.
    } catch (err) {
      // Invoke helper or pass arguments.
      deps.setMessage(okMessage);
      // Open multi-line construct.
      deps.setRefreshWarning?.(
        // Continue multi-line list/arguments.
        err instanceof Error ? err.message : "Failed to refresh",
      );
    }
    // Return computed result to caller.
    return result;
  // Invoke helper or pass arguments.
  } catch (err) {
    // Invoke helper or pass arguments.
    deps.setError(err instanceof Error ? err.message : "Action failed");
    // Return computed result to caller.
    return null;
  // Open multi-line construct.
  } finally {
    // Invoke helper or pass arguments.
    deps.endBusy(busyKey);
  }
}

/**
 * Returns assign/close/reopen/report helpers bound to the given busy/message
 * callbacks. Keep TicketLifecycleActions for start/wait/resume/resolve.
 */
export function useTicketLifecycleActions(deps: TicketLifecycleActionDeps) {
  // Local constant binding.
  const depsRef = useRef(deps);
  // Assign value for subsequent use.
  depsRef.current = deps;
  // Local constant binding.
  const locale = deps.locale ?? "bg";

  // Local constant binding.
  const assign = useCallback(
    // Arrow function / callback body.
    (ticketId: string, assigneeId: string) =>
      // Open multi-line construct.
      runQueuedAction(
        // Continue multi-line list/arguments.
        depsRef.current,
        // List item in import/export/params.
        ticketId,
        // Arrow function / callback body.
        () => assignTicketQueued(ticketId, assigneeId),
        // Invoke helper or pass arguments.
        t(locale, "Назначен", "Assigned"),
        // Invoke helper or pass arguments.
        t(locale, "Назначаване в опашката", "Assign queued"),
      ),
    // Continue multi-line list/arguments.
    [locale],
  );

  // Local constant binding.
  const close = useCallback(
    // Arrow function / callback body.
    (ticketId: string) =>
      // Open multi-line construct.
      runQueuedAction(
        // Continue multi-line list/arguments.
        depsRef.current,
        // List item in import/export/params.
        ticketId,
        // Arrow function / callback body.
        () => closeTicketQueued(ticketId),
        // Invoke helper or pass arguments.
        t(locale, "Затворен", "Closed"),
        // Invoke helper or pass arguments.
        t(locale, "Затваряне в опашката", "Close queued"),
      ),
    // Continue multi-line list/arguments.
    [locale],
  );

  // Local constant binding.
  const reopen = useCallback(
    // Arrow function / callback body.
    (ticketId: string, reason?: string) =>
      // Open multi-line construct.
      runQueuedAction(
        // Continue multi-line list/arguments.
        depsRef.current,
        // List item in import/export/params.
        ticketId,
        // Arrow function / callback body.
        () => reopenTicketQueued(ticketId, reason),
        // Invoke helper or pass arguments.
        t(locale, "Повторно отворен", "Issue reopened"),
        // Invoke helper or pass arguments.
        t(locale, "Повторно отваряне в опашката", "Reopen queued"),
      ),
    // Continue multi-line list/arguments.
    [locale],
  );

  // Local constant binding.
  const report = useCallback(
    // Open multi-line construct.
    (
      // Field/property in this shape.
      payload: Parameters<typeof reportTicketQueued>[0],
      // Field/property in this shape.
      busyKey: string,
      // Field/property in this shape.
      messages?: { success?: string; queued?: string },
    // Arrow function / callback body.
    ) =>
      // Open multi-line construct.
      runQueuedAction(
        // Continue multi-line list/arguments.
        depsRef.current,
        // List item in import/export/params.
        busyKey,
        // Arrow function / callback body.
        () => reportTicketQueued(payload),
        // Invoke helper or pass arguments.
        messages?.success ?? t(locale, "Сигналът е подаден", "Issue reported"),
        // Invoke helper or pass arguments.
        messages?.queued ?? t(locale, "Сигнал в опашката", "Report queued"),
      ),
    // Continue multi-line list/arguments.
    [locale],
  );

  // Local constant binding.
  const runAction = useCallback(
    // Open multi-line construct.
    (
      // Field/property in this shape.
      ticketId: string,
      // Arrow function / callback body.
      action: () => Promise<QueuedResult>,
      // Field/property in this shape.
      successMessage: string,
      // Field/property in this shape.
      queuedMessage: string,
    // Arrow function / callback body.
    ) =>
      // Open multi-line construct.
      runQueuedAction(
        // Continue multi-line list/arguments.
        depsRef.current,
        // List item in import/export/params.
        ticketId,
        // List item in import/export/params.
        action,
        // List item in import/export/params.
        successMessage,
        // List item in import/export/params.
        queuedMessage,
      ),
    // Continue multi-line list/arguments.
    [],
  );

  // Return computed result to caller.
  return useMemo(
    // Arrow function / callback body.
    () => ({ assign, close, reopen, report, runAction }),
    // Continue multi-line list/arguments.
    [assign, close, reopen, report, runAction],
  );
}
