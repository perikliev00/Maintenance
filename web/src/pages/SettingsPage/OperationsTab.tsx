/** Operational thresholds (draft) and SLA-by-priority hours (immediate saves). */
import type { Dispatch, SetStateAction } from "react";
import type { SlaPolicyRow } from "../../api/client";
import type { LabelFn } from "./constants";
import { slaHoursForPriority } from "./settingsDraftLogic";

type Props = {
  draft: Record<string, unknown>;
  setDraft: Dispatch<SetStateAction<Record<string, unknown>>>;
  label: LabelFn;
  slaPolicies: SlaPolicyRow[];
  /** SLA save failure; scoped to this tab, not the settings error banner. */
  slaError: string | null;
  onSaveSlaPolicy: (priority: string, hours: number) => void;
  disabled: boolean;
};

const SLA_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

/**
 * Overdue/due/risk thresholds bound to the settings draft, plus SLA hours per
 * priority which save immediately (not part of the draft).
 */
export function OperationsTab({
  draft,
  setDraft,
  label,
  slaPolicies,
  slaError,
  onSaveSlaPolicy,
  disabled,
}: Props) {
  return (
    <div className="settings-form">
      <label>
        {label("Overdue праг (минути)", "Overdue threshold (minutes)")}
        <input
          type="number"
          min={15}
          max={1440}
          value={Number(
            (draft as { overdueSessionMinutes?: number })
              .overdueSessionMinutes ?? 240,
          )}
          onChange={(e) =>
            setDraft((p) => ({
              ...p,
              overdueSessionMinutes: Number(e.target.value),
            }))
          }
        />
      </label>
      <label>
        {label("Срок на задача по подразбиране (часове)", "Default task due (hours)")}
        <input
          type="number"
          min={1}
          max={72}
          value={Number(
            (draft as { defaultTaskDueHours?: number })
              .defaultTaskDueHours ?? 4,
          )}
          onChange={(e) =>
            setDraft((p) => ({
              ...p,
              defaultTaskDueHours: Number(e.target.value),
            }))
          }
        />
      </label>
      <label>
        {label("SLA на тикет (часове)", "Default ticket SLA (hours)")}
        <input
          type="number"
          min={1}
          max={168}
          value={Number(
            (draft as { defaultTicketSlaHours?: number })
              .defaultTicketSlaHours ?? 24,
          )}
          onChange={(e) =>
            setDraft((p) => ({
              ...p,
              defaultTicketSlaHours: Number(e.target.value),
            }))
          }
        />
      </label>
      <div className="settings-block">
        <h3>{label("SLA по приоритет", "SLA by priority")}</h3>
        <p className="muted">
          {label(
            "Часове до resolve при създаване на тикет. Промяната не мести вече отворени срокове.",
            "Hours to resolve when a ticket is created. Changes do not rewrite open due dates.",
          )}
        </p>
        {slaError && <p className="error">{slaError}</p>}
        {SLA_PRIORITIES.map((priority) => (
          <label key={priority}>
            {priority}
            <input
              type="number"
              min={1}
              max={168}
              value={slaHoursForPriority(slaPolicies, priority)}
              disabled={disabled}
              onChange={(e) =>
                onSaveSlaPolicy(priority, Number(e.target.value))
              }
            />
          </label>
        ))}
      </div>
      <label>
        {label("Праг за рискова стая (тикети)", "Risk room ticket threshold")}
        <input
          type="number"
          min={1}
          max={50}
          value={Number(
            (draft as { riskTicketThreshold?: number })
              .riskTicketThreshold ?? 2,
          )}
          onChange={(e) =>
            setDraft((p) => ({
              ...p,
              riskTicketThreshold: Number(e.target.value),
            }))
          }
        />
      </label>
      <label>
        {label("Прозорец за риск (дни)", "Risk window (days)")}
        <input
          type="number"
          min={1}
          max={365}
          value={Number(
            (draft as { riskWindowDays?: number }).riskWindowDays ?? 30,
          )}
          onChange={(e) =>
            setDraft((p) => ({
              ...p,
              riskWindowDays: Number(e.target.value),
            }))
          }
        />
      </label>
      <label>
        {label("Часова зона на хотела", "Hotel timezone")}
        <input
          value={String(
            (draft as { hotelTimezone?: string }).hotelTimezone ??
              "Europe/Sofia",
          )}
          onChange={(e) =>
            setDraft((p) => ({ ...p, hotelTimezone: e.target.value }))
          }
        />
      </label>
    </div>
  );
}
