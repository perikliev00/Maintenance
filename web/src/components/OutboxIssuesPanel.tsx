/**
 * Surfaces offline outbox conflicts/failures: dismiss, rebase onto current
 * server version (when `canRebaseConflict`), or retry failed actions.
 * Hidden when both counts are zero; subscribes to offline store for live updates.
 */
import { useCallback, useEffect, useState } from "react";
import {
  canRebaseConflict,
  entityIdFromQueued,
  listQueuedActions,
  parseConflictDetails,
  resolveQueuedAction,
  retryQueuedAction,
  subscribeOffline,
  type QueuedAction,
// Offline / online path.
} from "../offline/session";
import { t } from "../i18n";

type Props = {
  locale?: "bg" | "en";
  conflictCount: number;
  failedCount: number;
};

/** Human label for a queue command type. */
function typeLabel(locale: "bg" | "en", type: QueuedAction["type"]): string {
  const map: Record<QueuedAction["type"], [string, string]> = {
    "cleaning.start": ["Старт почистване", "Start cleaning"],
    "cleaning.complete": ["Край почистване", "Complete cleaning"],
    "ticket.start": ["Старт тикет", "Start ticket"],
    "ticket.wait": ["Изчакване тикет", "Wait ticket"],
    "ticket.resume": ["Възобновяване тикет", "Resume ticket"],
    "ticket.resolve": ["Решаване тикет", "Resolve ticket"],
    "ticket.report": ["Докладване", "Report ticket"],
    "ticket.assign": ["Назначаване тикет", "Assign ticket"],
    "ticket.close": ["Затваряне тикет", "Close ticket"],
    "ticket.reopen": ["Повторно отваряне", "Reopen ticket"],
  };
  const pair = map[type];
  // Early / value return.
  return locale === "en" ? pair[1] : pair[0];
}

/** Map opaque/server sync errors into actionable localized copy. */
function formatQueueError(locale: "bg" | "en", message: string): string {
  const normalized = message.trim();
  if (/^Temporary command failure$/i.test(normalized)) {
    return t(
      locale,
      "Временна грешка при синхронизация. Натиснете „Опитай пак“ — действието няма да се дублира.",
      "Temporary sync error. Tap Retry — the action will not be duplicated.",
    );
  }
  if (/^Invalid command payload$/i.test(normalized)) {
    return t(
      locale,
      "Невалидни данни в командата. Отхвърлете я и извършете действието отново.",
      "Invalid command payload. Dismiss it and perform the action again.",
    );
  }
  if (/^Referenced record was not found$/i.test(normalized)) {
    return t(
      locale,
      "Свързаният запис липсва (стая/тикет). Отхвърлете командата или проверете данните.",
      "A related record is missing (room/ticket). Dismiss the command or check the data.",
    );
  }
  if (/^Command could not be applied$/i.test(normalized)) {
    return t(
      locale,
      "Командата не може да бъде приложена. Проверете състоянието и опитайте отново или я отхвърлете.",
      "The command could not be applied. Check state, then retry or dismiss.",
    );
  }
  if (/^Unknown command type/i.test(normalized)) {
    return t(
      locale,
      "Непознат тип команда. Обновете приложението или отхвърлете записа.",
      "Unknown command type. Update the app or dismiss this entry.",
    );
  }
  if (/active (duplicate )?ticket already exists/i.test(normalized)) {
    return t(
      locale,
      "Вече има активен тикет за същия проблем. Отхвърлете командата или докладвайте с изрично потвърждение онлайн.",
      "An active ticket already exists for this issue. Dismiss the command or report with an explicit override online.",
    );
  }
  if (/related open ticket exists/i.test(normalized)) {
    return t(
      locale,
      "Възможен свързан тикет. Потвърдете онлайн, че това е отделен проблем, или отхвърлете командата.",
      "A related open ticket may exist. Confirm online that this is a separate issue, or dismiss the command.",
    );
  }
  return normalized;
}

/** One-line summary of what the local outbox row intended to do. */
function localIntentSummary(
  locale: "bg" | "en",
  item: QueuedAction,
): string {
  const parts: string[] = [typeLabel(locale, item.type)];
  const entityId = entityIdFromQueued(item.type, item.url, item.body);
  // Branch: conditional gate.
  if (entityId) {
    parts.push(`${entityId.slice(0, 8)}…`);
  }
  const expected = item.body.expectedVersion;
  // Branch: conditional gate.
  if (typeof expected === "number") {
    parts.push(
      t(locale, `локална v${expected}`, `local v${expected}`),
    );
  }
  // Branch: conditional gate.
  if (typeof item.body.notes === "string" && item.body.notes.trim()) {
    const notes = item.body.notes.trim();
    parts.push(notes.length > 40 ? `${notes.slice(0, 40)}…` : notes);
  }
  // Early / value return.
  return parts.join(" · ");
}

/**
 * OutboxIssuesPanel React component / page.
 */
export function OutboxIssuesPanel({
  locale = "bg",
  conflictCount,
  failedCount,
}: Props) {
  const [items, setItems] = useState<QueuedAction[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Load only conflict/failed rows (pending drain elsewhere). */
  const reload = useCallback(async () => {
    const rows = await listQueuedActions(["conflict", "failed"]);
    // State transition.
    setItems(rows);
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
    } finally {
      // State transition.
      setBusyId(null);
    }
  }

  // Early / value return.
  return (
    <div className="outbox-issues">
      {conflictCount > 0 && (
        <div className="banner warn">
          {t(
            locale,
            `${conflictCount} конфликта чакат разрешаване — локалните действия не са приложени`,
            `${conflictCount} conflicts need resolution — local actions were not applied`,
          )}
        </div>
      )}
      {failedCount > 0 && (
        <div className="banner error">
          {t(
            locale,
            `${failedCount} действия в опашката са неуспешни`,
            `${failedCount} queued actions failed`,
          )}
        </div>
      )}
      {items.length > 0 && (
        <ul className="outbox-issue-list">
          {items.map((item) => {
            const details = parseConflictDetails(item.conflictDetails);
            const message = formatQueueError(
              locale,
              item.conflictMessage ?? item.lastError ?? item.type,
            );
            const rebaseable =
              item.status === "conflict" &&
              canRebaseConflict(item.conflictCode, item.conflictDetails);
            const existingTicketId = (() => {
              const raw = item.conflictDetails;
              if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
                return undefined;
              }
              const id = (raw as { existingTicket?: { id?: unknown } })
                .existingTicket?.id;
              return typeof id === "string" ? id : undefined;
            })();
            // Early / value return.
            return (
              <li key={item.id} className="outbox-issue-item">
                <div className="outbox-issue-meta">
                  <strong>
                    {item.status === "conflict"
                      ? t(locale, "Конфликт", "Conflict")
                      : t(locale, "Грешка", "Failed")}
                    {/* Render branch: item.conflictCode ? ` · $item.conflictCode` : "" */}
                    {item.conflictCode ? ` · ${item.conflictCode}` : ""}
                  </strong>
                  <span className="muted">
                    {new Date(item.updatedAt).toLocaleString()}
                  </span>
                  <span>{message}</span>
                  {existingTicketId ? (
                    <span className="muted">
                      {t(locale, "Съществуващ тикет", "Existing ticket")}:{" "}
                      <code>{existingTicketId.slice(0, 10)}…</code>
                    </span>
                  ) : null}
                  {item.status === "conflict" && (
                    <>
                      <span className="muted">
                        {t(locale, "Локален intent", "Local intent")}:{" "}
                        {localIntentSummary(locale, item)}
                      </span>
                      {(details?.currentVersion !== undefined ||
                        details?.status ||
                        details?.assignedEmployeeId) && (
                        <span className="muted">
                          {t(locale, "Сървър", "Server")}:
                          {details.currentVersion !== undefined
                            ? ` v${details.currentVersion}`
                            : ""}
                          {/* Render branch: details.status ? ` · $details.status` : "" */}
                          {details.status ? ` · ${details.status}` : ""}
                          {details.assignedEmployeeId
                            ? ` · ${t(locale, "назначен", "assignee")} ${details.assignedEmployeeId.slice(0, 8)}…`
                            : ""}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="outbox-issue-actions">
                  {item.status === "conflict" && rebaseable && (
                    <button
                      type="button"
                      className="ghost"
                      disabled={busyId === item.id}
                      onClick={() => void onRebase(item.id)}
                    >
                      {t(
                        locale,
                        "Опитай с текущата версия",
                        "Retry with current version",
                      )}
                    </button>
                  )}
                  {item.status === "failed" && (
                    <button
                      type="button"
                      className="ghost"
                      disabled={busyId === item.id}
                      onClick={() => void onRetryFailed(item.id)}
                    >
                      {t(locale, "Опитай пак", "Retry")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost"
                    disabled={busyId === item.id}
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
