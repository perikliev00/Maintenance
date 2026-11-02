/**
 * Shared assign / close / report / reopen wiring for offline-aware ticket
 * actions. Screen-specific permission gates and which buttons to show stay
 * with the caller; this hook only owns busy-gate + queue + refresh feedback.
 */
import { useCallback, useMemo, useRef } from "react";
import {
  assignTicketQueued,
  closeTicketQueued,
  reopenTicketQueued,
  reportTicketQueued,
} from "../offline/mutations";
import { t } from "../i18n";

export type TicketLifecycleActionDeps = {
  beginBusy: (id: string) => boolean;
  endBusy: (id: string) => void;
  setError: (msg: string | null) => void;
  setMessage: (msg: string | null) => void;
  /** Optional follow-up refresh after a successful online apply. */
  refresh?: () => Promise<void>;
  /** Called when refresh after a successful mutate fails. */
  setRefreshWarning?: (msg: string | null) => void;
  locale?: "bg" | "en";
};

type QueuedResult = { queued: boolean };

async function runQueuedAction(
  deps: TicketLifecycleActionDeps,
  busyKey: string,
  action: () => Promise<QueuedResult>,
  successMessage: string,
  queuedMessage: string,
): Promise<QueuedResult | null> {
  if (!deps.beginBusy(busyKey)) return null;
  deps.setError(null);
  deps.setRefreshWarning?.(null);
  try {
    const result = await action();
    const okMessage = result.queued ? queuedMessage : successMessage;
    if (result.queued || !deps.refresh) {
      deps.setMessage(okMessage);
      return result;
    }
    try {
      await deps.refresh();
      deps.setMessage(okMessage);
      deps.setRefreshWarning?.(null);
    } catch (err) {
      deps.setMessage(okMessage);
      deps.setRefreshWarning?.(
        err instanceof Error ? err.message : "Failed to refresh",
      );
    }
    return result;
  } catch (err) {
    deps.setError(err instanceof Error ? err.message : "Action failed");
    return null;
  } finally {
    deps.endBusy(busyKey);
  }
}

/**
 * Returns assign/close/reopen/report helpers bound to the given busy/message
 * callbacks. Keep TicketLifecycleActions for start/wait/resume/resolve.
 */
export function useTicketLifecycleActions(deps: TicketLifecycleActionDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const locale = deps.locale ?? "bg";

  const assign = useCallback(
    (ticketId: string, assigneeId: string) =>
      runQueuedAction(
        depsRef.current,
        ticketId,
        () => assignTicketQueued(ticketId, assigneeId),
        t(locale, "Назначен", "Assigned"),
        t(locale, "Назначаване в опашката", "Assign queued"),
      ),
    [locale],
  );

  const close = useCallback(
    (ticketId: string) =>
      runQueuedAction(
        depsRef.current,
        ticketId,
        () => closeTicketQueued(ticketId),
        t(locale, "Затворен", "Closed"),
        t(locale, "Затваряне в опашката", "Close queued"),
      ),
    [locale],
  );

  const reopen = useCallback(
    (ticketId: string, reason?: string) =>
      runQueuedAction(
        depsRef.current,
        ticketId,
        () => reopenTicketQueued(ticketId, reason),
        t(locale, "Повторно отворен", "Issue reopened"),
        t(locale, "Повторно отваряне в опашката", "Reopen queued"),
      ),
    [locale],
  );

  const report = useCallback(
    (
      payload: Parameters<typeof reportTicketQueued>[0],
      busyKey: string,
      messages?: { success?: string; queued?: string },
    ) =>
      runQueuedAction(
        depsRef.current,
        busyKey,
        () => reportTicketQueued(payload),
        messages?.success ?? t(locale, "Сигналът е подаден", "Issue reported"),
        messages?.queued ?? t(locale, "Сигнал в опашката", "Report queued"),
      ),
    [locale],
  );

  const runAction = useCallback(
    (
      ticketId: string,
      action: () => Promise<QueuedResult>,
      successMessage: string,
      queuedMessage: string,
    ) =>
      runQueuedAction(
        depsRef.current,
        ticketId,
        action,
        successMessage,
        queuedMessage,
      ),
    [],
  );

  return useMemo(
    () => ({ assign, close, reopen, report, runAction }),
    [assign, close, reopen, report, runAction],
  );
}
