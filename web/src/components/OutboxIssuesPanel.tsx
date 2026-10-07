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
} from "../offline";

type Props = {
  locale?: "bg" | "en";
  conflictCount: number;
  failedCount: number;
};

function t(locale: "bg" | "en", bg: string, en: string) {
  return locale === "en" ? en : bg;
}

function typeLabel(locale: "bg" | "en", type: QueuedAction["type"]): string {
  const map: Record<QueuedAction["type"], [string, string]> = {
    "cleaning.start": ["Старт почистване", "Start cleaning"],
    "cleaning.complete": ["Край почистване", "Complete cleaning"],
    "ticket.start": ["Старт тикет", "Start ticket"],
    "ticket.wait": ["Изчакване тикет", "Wait ticket"],
    "ticket.resume": ["Възобновяване тикет", "Resume ticket"],
    "ticket.resolve": ["Решаване тикет", "Resolve ticket"],
    "ticket.report": ["Докладване", "Report ticket"],
  };
  const pair = map[type];
  return locale === "en" ? pair[1] : pair[0];
}

function localIntentSummary(
  locale: "bg" | "en",
  item: QueuedAction,
): string {
  const parts: string[] = [typeLabel(locale, item.type)];
  const entityId = entityIdFromQueued(item.type, item.url, item.body);
  if (entityId) {
    parts.push(`${entityId.slice(0, 8)}…`);
  }
  const expected = item.body.expectedVersion;
  if (typeof expected === "number") {
    parts.push(
      t(locale, `локална v${expected}`, `local v${expected}`),
    );
  }
  if (typeof item.body.notes === "string" && item.body.notes.trim()) {
    const notes = item.body.notes.trim();
    parts.push(notes.length > 40 ? `${notes.slice(0, 40)}…` : notes);
  }
  return parts.join(" · ");
}

export function OutboxIssuesPanel({
  locale = "bg",
  conflictCount,
  failedCount,
}: Props) {
  const [items, setItems] = useState<QueuedAction[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const rows = await listQueuedActions(["conflict", "failed"]);
    setItems(rows);
  }, []);

  useEffect(() => {
    void reload();
    return subscribeOffline(() => {
      void reload();
    });
  }, [reload]);

  if (conflictCount === 0 && failedCount === 0) return null;

  async function onDismiss(id: string) {
    setBusyId(id);
    try {
      await resolveQueuedAction(id, { mode: "dismiss" });
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function onRebase(id: string) {
    setBusyId(id);
    try {
      await resolveQueuedAction(id, { mode: "rebase" });
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function onRetryFailed(id: string) {
    setBusyId(id);
    try {
      await retryQueuedAction(id);
      await reload();
    } finally {
      setBusyId(null);
    }
  }

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
            const message =
              item.conflictMessage ?? item.lastError ?? item.type;
            const rebaseable =
              item.status === "conflict" &&
              canRebaseConflict(item.conflictCode, item.conflictDetails);
            return (
              <li key={item.id} className="outbox-issue-item">
                <div className="outbox-issue-meta">
                  <strong>
                    {item.status === "conflict"
                      ? t(locale, "Конфликт", "Conflict")
                      : t(locale, "Грешка", "Failed")}
                    {item.conflictCode ? ` · ${item.conflictCode}` : ""}
                  </strong>
                  <span className="muted">
                    {new Date(item.updatedAt).toLocaleString()}
                  </span>
                  <span>{message}</span>
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
