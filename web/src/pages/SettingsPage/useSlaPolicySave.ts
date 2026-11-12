/**
 * SLA-by-priority edits (Operations tab).
 *
 * Separate from the settings draft: each edit is an immediate PUT through the
 * shared busy mutation (so it cannot overlap a settings save), and its failure
 * is kept in `slaError` — it never touches the settings error banner or draft.
 * Success reuses the shared saved-message banner.
 */
import { useState } from "react";
import { updateSlaPolicy, type SlaPolicyRow } from "../../api/client";
import type { useBusyMutation } from "../../hooks/useBusyMutation";
import type { LabelFn } from "./constants";

type Options = {
  busy: Pick<
    ReturnType<typeof useBusyMutation>,
    "busyRef" | "runMutationWithRefresh"
  >;
  applySlaPolicy: (row: SlaPolicyRow) => void;
  setMessage: (message: string | null) => void;
  label: LabelFn;
};

// Export function useSlaPolicySave as part of this module's API.
export function useSlaPolicySave({
  busy: { busyRef, runMutationWithRefresh },
  applySlaPolicy,
  setMessage,
  label,
}: Options) {
  const [slaError, setSlaError] = useState<string | null>(null);

  // Define function saveSlaPolicy and its behavior.
  async function saveSlaPolicy(priority: string, hours: number) {
    if (!Number.isFinite(hours) || hours < 1) return;
    if (busyRef.current) return;
    setSlaError(null);
    const result = await runMutationWithRefresh(() =>
      updateSlaPolicy(priority, { hours, isActive: true }),
    );
    if (!result.ok) {
      if (result.error !== "busy") setSlaError(result.error);
      return;
    }
    applySlaPolicy(result.value);
    setMessage(label("SLA политиката е записана", "SLA policy saved"));
  }

  return { slaError, saveSlaPolicy };
}
