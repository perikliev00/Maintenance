import { useCallback, useEffect, useState } from "react";
import {
  dismissQueuedAction,
  listQueuedActions,
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
      await dismissQueuedAction(id);
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function onRetry(id: string) {
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
            `${conflictCount} конфликта чакат разрешаване`,
            `${conflictCount} conflicts need resolution`,
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
            const message =
              item.conflictMessage ?? item.lastError ?? item.type;
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
                    {typeLabel(locale, item.type)} ·{" "}
                    {new Date(item.updatedAt).toLocaleString()}
                  </span>
                  <span>{message}</span>
                </div>
                <div className="outbox-issue-actions">
                  <button
                    type="button"
                    className="ghost"
                    disabled={busyId === item.id}
                    onClick={() => void onRetry(item.id)}
                  >
                    {t(locale, "Опитай пак", "Retry")}
                  </button>
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
