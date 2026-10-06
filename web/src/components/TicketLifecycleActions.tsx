import {
  resumeTicketQueued,
  resolveTicketQueued,
  startTicketQueued,
  waitTicketQueued,
} from "../offline";
import type { MaintenanceTicket } from "../api/client";

export type TicketLifecycleDone = {
  queued: boolean;
  message: string;
  nextStatus: "in_progress" | "waiting" | "resolved";
};

type Props = {
  ticket: Pick<MaintenanceTicket, "id" | "status" | "assignee">;
  busy: boolean;
  canResolve: boolean;
  onDone: (result: TicketLifecycleDone) => void;
  onError: (message: string) => void;
  onBusy: (id: string | null) => void;
};

export function TicketLifecycleActions({
  ticket,
  busy,
  canResolve,
  onDone,
  onError,
  onBusy,
}: Props) {
  if (!canResolve) return null;

  async function run(
    action: () => Promise<{ queued: boolean }>,
    message: string,
    queuedMessage: string,
    nextStatus: TicketLifecycleDone["nextStatus"],
  ) {
    onBusy(ticket.id);
    try {
      const result = await action();
      onDone({
        queued: result.queued,
        message: result.queued ? queuedMessage : message,
        nextStatus,
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Action failed");
    } finally {
      onBusy(null);
    }
  }

  return (
    <div className="actions" style={{ marginTop: "0.5rem", gap: "0.35rem" }}>
      {ticket.status === "assigned" && (
        <button
          type="button"
          className="subtle"
          disabled={busy}
          onClick={() =>
            void run(
              () => startTicketQueued(ticket.id),
              "Работата е стартирана",
              "Старт в опашката",
              "in_progress",
            )
          }
        >
          Start
        </button>
      )}
      {ticket.status === "in_progress" && (
        <>
          <button
            type="button"
            className="subtle"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt("Причина за изчакване (опционално)");
              if (reason === null) return;
              void run(
                () => waitTicketQueued(ticket.id, reason),
                "Тикетът е на изчакване",
                "Изчакване в опашката",
                "waiting",
              );
            }}
          >
            Wait
          </button>
          <button
            type="button"
            className="subtle"
            disabled={busy}
            onClick={() => {
              const notes = window.prompt("Описание на решението (опционално)");
              if (notes === null) return;
              void run(
                () => resolveTicketQueued(ticket.id, notes),
                "Проблемът е решен",
                "Решение в опашката",
                "resolved",
              );
            }}
          >
            Resolve
          </button>
        </>
      )}
      {ticket.status === "waiting" && (
        <>
          <button
            type="button"
            className="subtle"
            disabled={busy}
            onClick={() =>
              void run(
                () => resumeTicketQueued(ticket.id),
                "Работата е възобновена",
                "Възобновяване в опашката",
                "in_progress",
              )
            }
          >
            Resume
          </button>
          <button
            type="button"
            className="subtle"
            disabled={busy}
            onClick={() => {
              const notes = window.prompt("Описание на решението (опционално)");
              if (notes === null) return;
              void run(
                () => resolveTicketQueued(ticket.id, notes),
                "Проблемът е решен",
                "Решение в опашката",
                "resolved",
              );
            }}
          >
            Resolve
          </button>
        </>
      )}
    </div>
  );
}
