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
} from "../offline/mutations";
import type { MaintenanceTicket } from "../api/client";
import { t } from "../i18n";
import { runWithBusyGate } from "./ticketBusyGate";

export type TicketLifecycleDone = {
  queued: boolean;
  message: string;
  nextStatus: "in_progress" | "waiting" | "resolved";
};

type Props = {
  ticket: Pick<MaintenanceTicket, "id" | "status" | "assignee"> &
    Partial<Pick<MaintenanceTicket, "blocksRoom" | "priority">>;
  busy: boolean;
  /** Permission gate: no lifecycle buttons when false. */
  canResolve: boolean;
  locale?: "bg" | "en";
  onDone: (result: TicketLifecycleDone) => void;
  onError: (message: string) => void;
  /**
   * Acquire/release busy for `ticket.id`.
   * Returning `false` from acquire (`id` non-null) aborts before any API/offline work.
   * Release (`id` null) should only clear a lock this call acquired.
   */
  onBusy: (id: string | null) => boolean | void;
};

function requiresResolutionNotes(
  ticket: Partial<Pick<MaintenanceTicket, "blocksRoom" | "priority">>,
): boolean {
  return (
    ticket.blocksRoom === true ||
    ticket.priority === "high" ||
    ticket.priority === "urgent"
  );
}

function promptResolutionNotes(
  locale: "bg" | "en",
  required: boolean,
): string | null {
  const notes = window.prompt(
    required
      ? t(
          locale,
          "Описание на решението (задължително за блокиращи/високи приоритети)",
          "Resolution notes (required for blocking/high-priority tickets)",
        )
      : t(
          locale,
          "Описание на решението (опционално)",
          "Resolution notes (optional)",
        ),
  );
  if (notes === null) return null;
  if (required && !notes.trim()) {
    window.alert(
      t(
        locale,
        "Моля, въведете описание на ремонта.",
        "Please enter a repair note.",
      ),
    );
    return null;
  }
  return notes;
}

/**
 * TicketLifecycleActions React component / page.
 */
export function TicketLifecycleActions({
  ticket,
  busy,
  canResolve,
  locale = "bg",
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
    const outcome = await runWithBusyGate(
      {
        begin: (id) => onBusy(id) !== false,
        end: () => {
          onBusy(null);
        },
      },
      ticket.id,
      async () => {
        try {
          const result = await action();
          onDone({
            queued: result.queued,
            message: result.queued ? queuedMessage : message,
            nextStatus,
          });
          return result;
        } catch (err) {
          onError(err instanceof Error ? err.message : "Action failed");
          return null;
        }
      },
    );
    void outcome;
  }

  // Early / value return.
  return (
    <div className="actions ticket-lifecycle-actions">
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
              t(locale, "Работата е стартирана", "Work started"),
              t(locale, "Старт в опашката", "Start queued"),
              "in_progress",
            )
          }
        >
          {t(locale, "Старт", "Start")}
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
              const reason = window.prompt(
                t(
                  locale,
                  "Причина за изчакване (опционално)",
                  "Waiting reason (optional)",
                ),
              );
              // Branch: conditional gate.
              if (reason === null) return;
              // Fire-and-forget async call.
              void run(
                () => waitTicketQueued(ticket.id, reason),
                t(locale, "Тикетът е на изчакване", "Ticket is waiting"),
                t(locale, "Изчакване в опашката", "Wait queued"),
                "waiting",
              );
            }}
          >
            {t(locale, "Изчакай", "Wait")}
          </button>
          <button
            type="button"
            className="subtle"
            disabled={busy}
            onClick={() => {
              const notes = promptResolutionNotes(
                locale,
                requiresResolutionNotes(ticket),
              );
              if (notes === null) return;
              void run(
                () => resolveTicketQueued(ticket.id, notes),
                t(locale, "Проблемът е решен", "Issue resolved"),
                t(locale, "Решение в опашката", "Resolve queued"),
                "resolved",
              );
            }}
          >
            {t(locale, "Реши", "Resolve")}
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
                t(locale, "Работата е възобновена", "Work resumed"),
                t(locale, "Възобновяване в опашката", "Resume queued"),
                "in_progress",
              )
            }
          >
            {t(locale, "Продължи", "Resume")}
          </button>
          <button
            type="button"
            className="subtle"
            disabled={busy}
            onClick={() => {
              const notes = promptResolutionNotes(
                locale,
                requiresResolutionNotes(ticket),
              );
              if (notes === null) return;
              void run(
                () => resolveTicketQueued(ticket.id, notes),
                t(locale, "Проблемът е решен", "Issue resolved"),
                t(locale, "Решение в опашката", "Resolve queued"),
                "resolved",
              );
            }}
          >
            {t(locale, "Реши", "Resolve")}
          </button>
        </>
      )}
    </div>
  );
}
