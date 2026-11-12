/**
 * Status-driven ticket actions (start / wait / resume / resolve) via offline-aware
 * `*Queued` helpers. Returns null when `canResolve` is false. Prompt cancel
 * (null) aborts without enqueueing; `onDone.queued` distinguishes offline enqueue
 * from an immediate server apply.
 */
import {
  // List item in import/export/params.
  resumeTicketQueued,
  // List item in import/export/params.
  resolveTicketQueued,
  // List item in import/export/params.
  startTicketQueued,
  // List item in import/export/params.
  waitTicketQueued,
  // Offline / online path.
} from "../offline/mutations";
// Import dependency used by this module.
import type { MaintenanceTicket } from "../api/client";
// Import dependency used by this module.
import { t } from "../i18n";
// Import dependency used by this module.
import { runWithBusyGate } from "./ticketBusyGate";

// Export type alias for consumers.
export type TicketLifecycleDone = {
  // Field/property in this shape.
  queued: boolean;
  // Field/property in this shape.
  message: string;
  // Field/property in this shape.
  nextStatus: "in_progress" | "waiting" | "resolved";
};

// Local type alias shaping data.
type Props = {
  // Field/property in this shape.
  ticket: Pick<MaintenanceTicket, "id" | "status" | "assignee"> &
    // Continue module logic.
    Partial<Pick<MaintenanceTicket, "blocksRoom" | "priority">>;
  // Field/property in this shape.
  busy: boolean;
  /** Permission gate: no lifecycle buttons when false. */
  canResolve: boolean;
  // Field/property in this shape.
  locale?: "bg" | "en";
  // Arrow function / callback body.
  onDone: (result: TicketLifecycleDone) => void;
  // Arrow function / callback body.
  onError: (message: string) => void;
  /**
   * Acquire/release busy for `ticket.id`.
   * Returning `false` from acquire (`id` non-null) aborts before any API/offline work.
   * Release (`id` null) should only clear a lock this call acquired.
   */
  onBusy: (id: string | null) => boolean | void;
};

// Function definition.
function requiresResolutionNotes(
  // Field/property in this shape.
  ticket: Partial<Pick<MaintenanceTicket, "blocksRoom" | "priority">>,
// Open multi-line construct.
): boolean {
  // Return computed result to caller.
  return (
    // Assign value for subsequent use.
    ticket.blocksRoom === true ||
    // Assign value for subsequent use.
    ticket.priority === "high" ||
    // Assign value for subsequent use.
    ticket.priority === "urgent"
  );
}

// Function definition.
function promptResolutionNotes(
  // Field/property in this shape.
  locale: "bg" | "en",
  // Field/property in this shape.
  required: boolean,
// Open multi-line construct.
): string | null {
  // Local constant binding.
  const notes = window.prompt(
    // JSX boolean prop or identifier.
    required
      // Open multi-line construct.
      ? t(
          // List item in import/export/params.
          locale,
          // Invoke helper or pass arguments.
          "Описание на решението (задължително за блокиращи/високи приоритети)",
          // Invoke helper or pass arguments.
          "Resolution notes (required for blocking/high-priority tickets)",
        )
      // Open multi-line construct.
      : t(
          // List item in import/export/params.
          locale,
          // Invoke helper or pass arguments.
          "Описание на решението (опционално)",
          // Invoke helper or pass arguments.
          "Resolution notes (optional)",
        ),
  );
  // Conditional branch for this case.
  if (notes === null) return null;
  // Conditional branch for this case.
  if (required && !notes.trim()) {
    // Open multi-line construct.
    window.alert(
      // Open multi-line construct.
      t(
        // List item in import/export/params.
        locale,
        // Continue multi-line list/arguments.
        "Моля, въведете описание на ремонта.",
        // Continue multi-line list/arguments.
        "Please enter a repair note.",
      ),
    );
    // Return computed result to caller.
    return null;
  }
  // Return computed result to caller.
  return notes;
}

/**
 * TicketLifecycleActions React component / page.
 */
export function TicketLifecycleActions({
  // List item in import/export/params.
  ticket,
  // List item in import/export/params.
  busy,
  // List item in import/export/params.
  canResolve,
  // Assign value for subsequent use.
  locale = "bg",
  // List item in import/export/params.
  onDone,
  // List item in import/export/params.
  onError,
  // List item in import/export/params.
  onBusy,
// Open multi-line construct.
}: Props) {
  // Permission gate — hide all lifecycle controls when the user cannot resolve.
  if (!canResolve) return null;

  /** Shared busy/error/done wiring for every offline-aware lifecycle action. */
  async function run(
    // Arrow function / callback body.
    action: () => Promise<{ queued: boolean }>,
    // Field/property in this shape.
    message: string,
    // Field/property in this shape.
    queuedMessage: string,
    // Field/property in this shape.
    nextStatus: TicketLifecycleDone["nextStatus"],
  // Open multi-line construct.
  ) {
    // Local constant binding.
    const outcome = await runWithBusyGate(
      {
        // Arrow function / callback body.
        begin: (id) => onBusy(id) !== false,
        // Arrow function / callback body.
        end: () => {
          // Invoke helper or pass arguments.
          onBusy(null);
        },
      },
      // Continue multi-line list/arguments.
      ticket.id,
      // Arrow function / callback body.
      async () => {
        // Guard fallible work.
        try {
          // Local constant binding.
          const result = await action();
          // Open multi-line construct.
          onDone({
            // Field/property in this shape.
            queued: result.queued,
            // Field/property in this shape.
            message: result.queued ? queuedMessage : message,
            // List item in import/export/params.
            nextStatus,
          });
          // Return computed result to caller.
          return result;
        // Invoke helper or pass arguments.
        } catch (err) {
          // Invoke helper or pass arguments.
          onError(err instanceof Error ? err.message : "Action failed");
          // Return computed result to caller.
          return null;
        }
      },
    );
    // Fire-and-forget async/side effect.
    void outcome;
  }

  // Early / value return.
  return (
    // Render JSX element.
    <div className="actions ticket-lifecycle-actions">
            {/* assigned → start work */}
            {ticket.status === "assigned" && (
        // Render JSX element.
        <button
          // Assign value for subsequent use.
          type="button"
          // Assign value for subsequent use.
          className="subtle"
          // Assign value for subsequent use.
          disabled={busy}
          // Arrow function / callback body.
          onClick={() =>
            // Fire-and-forget async call.
            void run(
              // Arrow function / callback body.
              () => startTicketQueued(ticket.id),
              // Invoke helper or pass arguments.
              t(locale, "Работата е стартирана", "Work started"),
              // Invoke helper or pass arguments.
              t(locale, "Старт в опашката", "Start queued"),
              // Continue multi-line list/arguments.
              "in_progress",
            )
          }
        >
                    {t(locale, "Старт", "Start")}
                </button>
      )}
            {/* in_progress → wait or resolve */}
            {ticket.status === "in_progress" && (
        // Continue module logic.
        <>
                    <button
            // Assign value for subsequent use.
            type="button"
            // Assign value for subsequent use.
            className="subtle"
            // Assign value for subsequent use.
            disabled={busy}
            // Arrow function / callback body.
            onClick={() => {
              // null means Cancel — abort without enqueueing.
              const reason = window.prompt(
                // Open multi-line construct.
                t(
                  // List item in import/export/params.
                  locale,
                  // Invoke helper or pass arguments.
                  "Причина за изчакване (опционално)",
                  // Invoke helper or pass arguments.
                  "Waiting reason (optional)",
                ),
              );
              // Branch: conditional gate.
              if (reason === null) return;
              // Fire-and-forget async call.
              void run(
                // Arrow function / callback body.
                () => waitTicketQueued(ticket.id, reason),
                // Invoke helper or pass arguments.
                t(locale, "Тикетът е на изчакване", "Ticket is waiting"),
                // Invoke helper or pass arguments.
                t(locale, "Изчакване в опашката", "Wait queued"),
                // Continue multi-line list/arguments.
                "waiting",
              );
            }}
          >
                        {t(locale, "Изчакай", "Wait")}
                    </button>
                    <button
            // Assign value for subsequent use.
            type="button"
            // Assign value for subsequent use.
            className="subtle"
            // Assign value for subsequent use.
            disabled={busy}
            // Arrow function / callback body.
            onClick={() => {
              // Local constant binding.
              const notes = promptResolutionNotes(
                // List item in import/export/params.
                locale,
                // Invoke helper or pass arguments.
                requiresResolutionNotes(ticket),
              );
              // Conditional branch for this case.
              if (notes === null) return;
              // Fire-and-forget async/side effect.
              void run(
                // Arrow function / callback body.
                () => resolveTicketQueued(ticket.id, notes),
                // Invoke helper or pass arguments.
                t(locale, "Проблемът е решен", "Issue resolved"),
                // Invoke helper or pass arguments.
                t(locale, "Решение в опашката", "Resolve queued"),
                // Continue multi-line list/arguments.
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
        // Continue module logic.
        <>
                    <button
            // Assign value for subsequent use.
            type="button"
            // Assign value for subsequent use.
            className="subtle"
            // Assign value for subsequent use.
            disabled={busy}
            // Arrow function / callback body.
            onClick={() =>
              // Fire-and-forget async call.
              void run(
                // Arrow function / callback body.
                () => resumeTicketQueued(ticket.id),
                // Invoke helper or pass arguments.
                t(locale, "Работата е възобновена", "Work resumed"),
                // Invoke helper or pass arguments.
                t(locale, "Възобновяване в опашката", "Resume queued"),
                // Continue multi-line list/arguments.
                "in_progress",
              )
            }
          >
                        {t(locale, "Продължи", "Resume")}
                    </button>
                    <button
            // Assign value for subsequent use.
            type="button"
            // Assign value for subsequent use.
            className="subtle"
            // Assign value for subsequent use.
            disabled={busy}
            // Arrow function / callback body.
            onClick={() => {
              // Local constant binding.
              const notes = promptResolutionNotes(
                // List item in import/export/params.
                locale,
                // Invoke helper or pass arguments.
                requiresResolutionNotes(ticket),
              );
              // Conditional branch for this case.
              if (notes === null) return;
              // Fire-and-forget async/side effect.
              void run(
                // Arrow function / callback body.
                () => resolveTicketQueued(ticket.id, notes),
                // Invoke helper or pass arguments.
                t(locale, "Проблемът е решен", "Issue resolved"),
                // Invoke helper or pass arguments.
                t(locale, "Решение в опашката", "Resolve queued"),
                // Continue multi-line list/arguments.
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
