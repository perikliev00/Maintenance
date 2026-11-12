/**
 * Surfaces offline outbox conflicts/failures: dismiss, rebase onto current
 * server version (when `canRebaseConflict`), or retry failed actions.
 * Hidden when both counts are zero; subscribes to offline store for live updates.
 */
import { useCallback, useEffect, useState } from "react";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  canRebaseConflict,
  // List item in import/export/params.
  entityIdFromQueued,
  // List item in import/export/params.
  listQueuedActions,
  // List item in import/export/params.
  parseConflictDetails,
  // List item in import/export/params.
  resolveQueuedAction,
  // List item in import/export/params.
  retryQueuedAction,
  // List item in import/export/params.
  subscribeOffline,
  // Local type alias shaping data.
  type QueuedAction,
// Offline / online path.
} from "../offline/session";
// Import dependency used by this module.
import { t } from "../i18n";

// Local type alias shaping data.
type Props = {
  // Field/property in this shape.
  locale?: "bg" | "en";
  // Field/property in this shape.
  conflictCount: number;
  // Field/property in this shape.
  failedCount: number;
};

/** Human label for a queue command type. */
function typeLabel(locale: "bg" | "en", type: QueuedAction["type"]): string {
  // Local constant binding.
  const map: Record<QueuedAction["type"], [string, string]> = {
    // Continue multi-line list/arguments.
    "cleaning.start": ["Старт почистване", "Start cleaning"],
    // Continue multi-line list/arguments.
    "cleaning.complete": ["Край почистване", "Complete cleaning"],
    // Continue multi-line list/arguments.
    "ticket.start": ["Старт тикет", "Start ticket"],
    // Continue multi-line list/arguments.
    "ticket.wait": ["Изчакване тикет", "Wait ticket"],
    // Continue multi-line list/arguments.
    "ticket.resume": ["Възобновяване тикет", "Resume ticket"],
    // Continue multi-line list/arguments.
    "ticket.resolve": ["Решаване тикет", "Resolve ticket"],
    // Continue multi-line list/arguments.
    "ticket.report": ["Докладване", "Report ticket"],
    // Continue multi-line list/arguments.
    "ticket.assign": ["Назначаване тикет", "Assign ticket"],
    // Continue multi-line list/arguments.
    "ticket.close": ["Затваряне тикет", "Close ticket"],
    // Continue multi-line list/arguments.
    "ticket.reopen": ["Повторно отваряне", "Reopen ticket"],
  };
  // Local constant binding.
  const pair = map[type];
  // Early / value return.
  return locale === "en" ? pair[1] : pair[0];
}

/** Map opaque/server sync errors into actionable localized copy. */
function formatQueueError(locale: "bg" | "en", message: string): string {
  // Local constant binding.
  const normalized = message.trim();
  // Conditional branch for this case.
  if (/^Temporary command failure$/i.test(normalized)) {
    // Return computed result to caller.
    return t(
      // List item in import/export/params.
      locale,
      // Continue multi-line list/arguments.
      "Временна грешка при синхронизация. Натиснете „Опитай пак“ — действието няма да се дублира.",
      // Continue multi-line list/arguments.
      "Temporary sync error. Tap Retry — the action will not be duplicated.",
    );
  }
  // Conditional branch for this case.
  if (/^Invalid command payload$/i.test(normalized)) {
    // Return computed result to caller.
    return t(
      // List item in import/export/params.
      locale,
      // Continue multi-line list/arguments.
      "Невалидни данни в командата. Отхвърлете я и извършете действието отново.",
      // Continue multi-line list/arguments.
      "Invalid command payload. Dismiss it and perform the action again.",
    );
  }
  // Conditional branch for this case.
  if (/^Referenced record was not found$/i.test(normalized)) {
    // Return computed result to caller.
    return t(
      // List item in import/export/params.
      locale,
      // Invoke helper or pass arguments.
      "Свързаният запис липсва (стая/тикет). Отхвърлете командата или проверете данните.",
      // Invoke helper or pass arguments.
      "A related record is missing (room/ticket). Dismiss the command or check the data.",
    );
  }
  // Conditional branch for this case.
  if (/^Command could not be applied$/i.test(normalized)) {
    // Return computed result to caller.
    return t(
      // List item in import/export/params.
      locale,
      // Continue multi-line list/arguments.
      "Командата не може да бъде приложена. Проверете състоянието и опитайте отново или я отхвърлете.",
      // Continue multi-line list/arguments.
      "The command could not be applied. Check state, then retry or dismiss.",
    );
  }
  // Conditional branch for this case.
  if (/^Unknown command type/i.test(normalized)) {
    // Return computed result to caller.
    return t(
      // List item in import/export/params.
      locale,
      // Continue multi-line list/arguments.
      "Непознат тип команда. Обновете приложението или отхвърлете записа.",
      // Continue multi-line list/arguments.
      "Unknown command type. Update the app or dismiss this entry.",
    );
  }
  // Conditional branch for this case.
  if (/active (duplicate )?ticket already exists/i.test(normalized)) {
    // Return computed result to caller.
    return t(
      // List item in import/export/params.
      locale,
      // Continue multi-line list/arguments.
      "Вече има активен тикет за същия проблем. Отхвърлете командата или докладвайте с изрично потвърждение онлайн.",
      // Continue multi-line list/arguments.
      "An active ticket already exists for this issue. Dismiss the command or report with an explicit override online.",
    );
  }
  // Conditional branch for this case.
  if (/related open ticket exists/i.test(normalized)) {
    // Return computed result to caller.
    return t(
      // List item in import/export/params.
      locale,
      // Continue multi-line list/arguments.
      "Възможен свързан тикет. Потвърдете онлайн, че това е отделен проблем, или отхвърлете командата.",
      // Continue multi-line list/arguments.
      "A related open ticket may exist. Confirm online that this is a separate issue, or dismiss the command.",
    );
  }
  // Return computed result to caller.
  return normalized;
}

/** One-line summary of what the local outbox row intended to do. */
function localIntentSummary(
  // Field/property in this shape.
  locale: "bg" | "en",
  // Field/property in this shape.
  item: QueuedAction,
// Open multi-line construct.
): string {
  // Local constant binding.
  const parts: string[] = [typeLabel(locale, item.type)];
  // Local constant binding.
  const entityId = entityIdFromQueued(item.type, item.url, item.body);
  // Branch: conditional gate.
  if (entityId) {
    // Invoke helper or pass arguments.
    parts.push(`${entityId.slice(0, 8)}…`);
  }
  // Local constant binding.
  const expected = item.body.expectedVersion;
  // Branch: conditional gate.
  if (typeof expected === "number") {
    // Open multi-line construct.
    parts.push(
      // Invoke helper or pass arguments.
      t(locale, `локална v${expected}`, `local v${expected}`),
    );
  }
  // Branch: conditional gate.
  if (typeof item.body.notes === "string" && item.body.notes.trim()) {
    // Local constant binding.
    const notes = item.body.notes.trim();
    // Invoke helper or pass arguments.
    parts.push(notes.length > 40 ? `${notes.slice(0, 40)}…` : notes);
  }
  // Early / value return.
  return parts.join(" · ");
}

/**
 * OutboxIssuesPanel React component / page.
 */
export function OutboxIssuesPanel({
  // Assign value for subsequent use.
  locale = "bg",
  // List item in import/export/params.
  conflictCount,
  // List item in import/export/params.
  failedCount,
// Open multi-line construct.
}: Props) {
  // Assign value for subsequent use.
  const [items, setItems] = useState<QueuedAction[]>([]);
  // Assign value for subsequent use.
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Load only conflict/failed rows (pending drain elsewhere). */
  const reload = useCallback(async () => {
    // Local constant binding.
    const rows = await listQueuedActions(["conflict", "failed"]);
    // State transition.
    setItems(rows);
  // Close multi-line construct with trailing syntax.
  }, []);

  // Effect: sync props/state to side effects.
  useEffect(() => {
    // Fire-and-forget async call.
    void reload();
    // Re-list whenever the offline banner/store notifies.
    return subscribeOffline(() => {
      // Fire-and-forget async call.
      void reload();
    });
  // Close multi-line construct with trailing syntax.
  }, [reload]);

  // Hidden when the parent reports zero issues (avoids empty chrome).
  if (conflictCount === 0 && failedCount === 0) return null;

  /** Drop the queued mutation without retrying. */
  async function onDismiss(id: string) {
    // State transition.
    setBusyId(id);
    // Try block for fallible work.
    try {
      // Await async step.
      await resolveQueuedAction(id, { mode: "dismiss" });
      // Await async step.
      await reload();
    // Open multi-line construct.
    } finally {
      // State transition.
      setBusyId(null);
    }
  }

  /** Advance expectedVersion from conflict details and re-queue. */
  async function onRebase(id: string) {
    // State transition.
    setBusyId(id);
    // Try block for fallible work.
    try {
      // Await async step.
      await resolveQueuedAction(id, { mode: "rebase" });
      // Await async step.
      await reload();
    // Open multi-line construct.
    } finally {
      // State transition.
      setBusyId(null);
    }
  }

  /**
   * Handler `onRetryFailed` for user or form events.
   */
  async function onRetryFailed(id: string) {
    // State transition.
    setBusyId(id);
    // Try block for fallible work.
    try {
      // Await async step.
      await retryQueuedAction(id);
      // Await async step.
      await reload();
    // Open multi-line construct.
    } finally {
      // State transition.
      setBusyId(null);
    }
  }

  // Early / value return.
  return (
    // Render JSX element.
    <div className="outbox-issues">
            {conflictCount > 0 && (
        // Render JSX element.
        <div className="banner warn">
                    {t(
            // List item in import/export/params.
            locale,
            // Continue multi-line list/arguments.
            `${conflictCount} конфликта чакат разрешаване — локалните действия не са приложени`,
            // Continue multi-line list/arguments.
            `${conflictCount} conflicts need resolution — local actions were not applied`,
          )}
                </div>
      )}
            {failedCount > 0 && (
        // Render JSX element.
        <div className="banner error">
                    {t(
            // List item in import/export/params.
            locale,
            // Continue multi-line list/arguments.
            `${failedCount} действия в опашката са неуспешни`,
            // Continue multi-line list/arguments.
            `${failedCount} queued actions failed`,
          )}
                </div>
      )}
            {items.length > 0 && (
        // Render JSX element.
        <ul className="outbox-issue-list">
                    {items.map((item) => {
            // Local constant binding.
            const details = parseConflictDetails(item.conflictDetails);
            // Local constant binding.
            const message = formatQueueError(
              // List item in import/export/params.
              locale,
              // Continue multi-line list/arguments.
              item.conflictMessage ?? item.lastError ?? item.type,
            );
            // Local constant binding.
            const rebaseable =
              // Assign value for subsequent use.
              item.status === "conflict" &&
              // Invoke helper or pass arguments.
              canRebaseConflict(item.conflictCode, item.conflictDetails);
            // Const arrow/function binding.
            const existingTicketId = (() => {
              // Local constant binding.
              const raw = item.conflictDetails;
              // Conditional branch for this case.
              if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
                // Return computed result to caller.
                return undefined;
              }
              // Const arrow/function binding.
              const id = (raw as { existingTicket?: { id?: unknown } })
                // Continue module logic.
                .existingTicket?.id;
              // Return computed result to caller.
              return typeof id === "string" ? id : undefined;
            // Invoke helper or pass arguments.
            })();
            // Early / value return.
            return (
              // Render JSX element.
              <li key={item.id} className="outbox-issue-item">
                                <div className="outbox-issue-meta">
                                    <strong>
                                        {item.status === "conflict"
                      // Invoke helper or pass arguments.
                      ? t(locale, "Конфликт", "Conflict")
                      // Invoke helper or pass arguments.
                      : t(locale, "Грешка", "Failed")}
                                        {/* Render branch: item.conflictCode ? ` · $item.conflictCode` : "" */}
                                        {item.conflictCode ? ` · ${item.conflictCode}` : ""}
                                    </strong>
                                    <span className="muted">
                                        {new Date(item.updatedAt).toLocaleString()}
                                    </span>
                                    <span>{message}</span>
                                    {existingTicketId ? (
                    // Render JSX element.
                    <span className="muted">
                                            {t(locale, "Съществуващ тикет", "Existing ticket")}:{" "}
                                            <code>{existingTicketId.slice(0, 10)}…</code>
                                        </span>
                  // Close multi-line construct with trailing syntax.
                  ) : null}
                                    {item.status === "conflict" && (
                    // Continue module logic.
                    <>
                                            <span className="muted">
                                                {t(locale, "Локален intent", "Local intent")}:{" "}
                                                {localIntentSummary(locale, item)}
                                            </span>
                                            {(details?.currentVersion !== undefined ||
                        // Continue module logic.
                        details?.status ||
                        // Invoke helper or pass arguments.
                        details?.assignedEmployeeId) && (
                        // Render JSX element.
                        <span className="muted">
                                                    {t(locale, "Сървър", "Server")}:
                          {details.currentVersion !== undefined
                            // Continue module logic.
                            ? ` v${details.currentVersion}`
                            // Continue module logic.
                            : ""}
                                                    {/* Render branch: details.status ? ` · $details.status` : "" */}
                                                    {details.status ? ` · ${details.status}` : ""}
                                                    {details.assignedEmployeeId
                            // Invoke helper or pass arguments.
                            ? ` · ${t(locale, "назначен", "assignee")} ${details.assignedEmployeeId.slice(0, 8)}…`
                            // Continue module logic.
                            : ""}
                                                </span>
                      )}
                                        </>
                  )}
                                </div>
                                <div className="outbox-issue-actions">
                                    {item.status === "conflict" && rebaseable && (
                    // Render JSX element.
                    <button
                      // Assign value for subsequent use.
                      type="button"
                      // Assign value for subsequent use.
                      className="ghost"
                      // Assign value for subsequent use.
                      disabled={busyId === item.id}
                      // Arrow function / callback body.
                      onClick={() => void onRebase(item.id)}
                    >
                                            {t(
                        // List item in import/export/params.
                        locale,
                        // Continue multi-line list/arguments.
                        "Опитай с текущата версия",
                        // Continue multi-line list/arguments.
                        "Retry with current version",
                      )}
                                        </button>
                  )}
                                    {item.status === "failed" && (
                    // Render JSX element.
                    <button
                      // Assign value for subsequent use.
                      type="button"
                      // Assign value for subsequent use.
                      className="ghost"
                      // Assign value for subsequent use.
                      disabled={busyId === item.id}
                      // Arrow function / callback body.
                      onClick={() => void onRetryFailed(item.id)}
                    >
                                            {t(locale, "Опитай пак", "Retry")}
                                        </button>
                  )}
                                    <button
                    // Assign value for subsequent use.
                    type="button"
                    // Assign value for subsequent use.
                    className="ghost"
                    // Assign value for subsequent use.
                    disabled={busyId === item.id}
                    // Arrow function / callback body.
                    onClick={() => void onDismiss(item.id)}
                  >
                                        {t(locale, "Отхвърли", "Dismiss")}
                                    </button>
                                </div>
                            </li>
            );
          })}
                </ul>
      )}
        </div>
  );
}
