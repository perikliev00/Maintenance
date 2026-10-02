import {
  resumeIssue,
  resolveIssue,
  startIssue,
  waitIssue,
  type MaintenanceTicket,
} from "../api/client";

type Props = {
  ticket: Pick<MaintenanceTicket, "id" | "status" | "assignee">;
  busy: boolean;
  canResolve: boolean;
  onDone: (message: string) => void;
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

  async function run(action: () => Promise<unknown>, okMessage: string) {
    onBusy(ticket.id);
    try {
      await action();
      onDone(okMessage);
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
          onClick={() => run(() => startIssue(ticket.id), "Работата е стартирана")}
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
              void run(() => waitIssue(ticket.id, reason), "Тикетът е на изчакване");
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
              void run(() => resolveIssue(ticket.id, notes), "Проблемът е решен");
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
            onClick={() => run(() => resumeIssue(ticket.id), "Работата е възобновена")}
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
              void run(() => resolveIssue(ticket.id, notes), "Проблемът е решен");
            }}
          >
            Resolve
          </button>
        </>
      )}
    </div>
  );
}
