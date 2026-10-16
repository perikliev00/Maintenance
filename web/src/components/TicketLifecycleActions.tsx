/**
 * Status-driven ticket actions (start / wait / resume / resolve) via offline-aware
 * `*Queued` helpers. Returns null when `canResolve` is false. Prompt cancel
 * (null) aborts without enqueueing; `onDone.queued` distinguishes offline enqueue
 * from an immediate server apply.
 */
import {
  resumeTicketQueued,
  resolveTicketQueued,
  startTicketQueued,
  waitTicketQueued,
// Offline / online path.
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
  /** Permission gate: no lifecycle buttons when false. */
  canResolve: boolean;
  onDone: (result: TicketLifecycleDone) => void;
  onError: (message: string) => void;
  onBusy: (id: string | null) => void;
};

/**
 * TicketLifecycleActions React component / page.
 */
export function TicketLifecycleActions({
  ticket,
  busy,
  canResolve,
  onDone,
  onError,
  onBusy,
}: Props) {
  // Permission gate — hide all lifecycle controls when the user cannot resolve.
  if (!canResolve) return null;

  /** Shared busy/error/done wiring for every offline-aware lifecycle action. */
  async function run(
    action: () => Promise<{ queued: boolean }>,
    message: string,
    queuedMessage: string,
    nextStatus: TicketLifecycleDone["nextStatus"],
  ) {
    onBusy(ticket.id);
    // Try block for fallible work.
    try {
      const result = await action();
      // Distinguish offline enqueue copy from immediate server apply.
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

  // Early / value return.
  return (
    <div className="actions" style={{ marginTop: "0.5rem", gap: "0.35rem" }}>
      {/* assigned → start work */}
      {ticket.status === "assigned" && (
        <button
          type="button"
          className="subtle"
          disabled={busy}
          onClick={() =>
            // Fire-and-forget async call.
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
      {/* in_progress → wait or resolve */}
      {ticket.status === "in_progress" && (
        <>
          <button
            type="button"
            className="subtle"
            disabled={busy}
            onClick={() => {
              // null means Cancel — abort without enqueueing.
              const reason = window.prompt("Причина за изчакване (опционално)");
              // Branch: conditional gate.
              if (reason === null) return;
              // Fire-and-forget async call.
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
              // Branch: conditional gate.
              if (notes === null) return;
              // Fire-and-forget async call.
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
      {/* waiting → resume or resolve */}
      {ticket.status === "waiting" && (
        <>
          <button
            type="button"
            className="subtle"
            disabled={busy}
            onClick={() =>
              // Fire-and-forget async call.
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
              // Branch: conditional gate.
              if (notes === null) return;
              // Fire-and-forget async call.
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
