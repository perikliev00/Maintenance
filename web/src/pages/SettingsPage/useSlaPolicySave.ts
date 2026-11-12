/**
 * SLA-by-priority edits (Operations tab).
 *
 * Separate from the settings draft: each edit is an immediate PUT through the
 * shared busy mutation (so it cannot overlap a settings save), and its failure
 * is kept in `slaError` — it never touches the settings error banner or draft.
 * Success reuses the shared saved-message banner.
 */
import { useState } from "react";
// Import module dependency from ../../api/client.
import { updateSlaPolicy, type SlaPolicyRow } from "../../api/client";
// Import type-only dependency for typing without runtime cost.
import type { useBusyMutation } from "../../hooks/useBusyMutation";
// Import type-only dependency for typing without runtime cost.
import type { LabelFn } from "./constants";

// Declare type alias Options.
type Options = {
  // Provide busy field used by this structure.
  busy: Pick<
    // Support the surrounding logic for this step.
    ReturnType<typeof useBusyMutation>,
    // Support the surrounding logic for this step.
    "busyRef" | "runMutationWithRefresh"
  >;
  // Provide applySlaPolicy field used by this structure.
  applySlaPolicy: (row: SlaPolicyRow) => void;
  // Provide setMessage field used by this structure.
  setMessage: (message: string | null) => void;
  // Provide label field used by this structure.
  label: LabelFn;
};

// Export function useSlaPolicySave as part of this module's API.
export function useSlaPolicySave({
  // Provide busy field used by this structure.
  busy: { busyRef, runMutationWithRefresh },
  // Support the surrounding logic for this step.
  applySlaPolicy,
  // Support the surrounding logic for this step.
  setMessage,
  // Support the surrounding logic for this step.
  label,
// Support the surrounding logic for this step.
}: Options) {
  // React state slot for local UI/data that can change over time.
  const [slaError, setSlaError] = useState<string | null>(null);

  // Define function saveSlaPolicy and its behavior.
  async function saveSlaPolicy(priority: string, hours: number) {
    // Conditional branch for the case described by this guard.
    if (!Number.isFinite(hours) || hours < 1) return;
    // Conditional branch for the case described by this guard.
    if (busyRef.current) return;
    // Update React state so the UI reflects the new value.
    setSlaError(null);
    // Bind result for use in the following logic.
    const result = await runMutationWithRefresh(() =>
      // Invoke updateSlaPolicy to perform this step.
      updateSlaPolicy(priority, { hours, isActive: true }),
    );
    // Conditional branch for the case described by this guard.
    if (!result.ok) {
      // Conditional branch for the case described by this guard.
      if (result.error !== "busy") setSlaError(result.error);
      // Return early result or rendered output from this path.
      return;
    }
    // Invoke applySlaPolicy to perform this step.
    applySlaPolicy(result.value);
    // Update React state so the UI reflects the new value.
    setMessage(label("SLA политиката е записана", "SLA policy saved"));
  }

  // Return early result or rendered output from this path.
  return { slaError, saveSlaPolicy };
}
