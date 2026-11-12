// Import type-only dependency for typing without runtime cost.
import type { Person, ShiftRow } from "../../api/client";
// Import module dependency from ../../components/LoadingIndicator.
import { LoadingIndicator } from "../../components/LoadingIndicator";
// Import module dependency from ../../components/ShiftPanel.
import { ShiftPanel } from "../../components/ShiftPanel";
// Import type-only dependency for typing without runtime cost.
import type { useShiftEditor } from "./useShiftEditor";

// Declare type alias ShiftEditor.
type ShiftEditor = ReturnType<typeof useShiftEditor>;

// Declare type alias Props.
type Props = {
  // Provide label field used by this structure.
  label: (bg: string, en: string) => string;
  // Provide locale field used by this structure.
  locale: "bg" | "en";
  // Provide shiftsLoading field used by this structure.
  shiftsLoading: boolean;
  // Provide shifts field used by this structure.
  shifts: ShiftRow[];
  // Provide housekeepers field used by this structure.
  housekeepers: Person[];
  // Provide canManageShifts field used by this structure.
  canManageShifts: boolean;
  // Provide busy field used by this structure.
  busy: boolean;
  // Provide editor field used by this structure.
  editor: ShiftEditor;
};

// Export function ShiftAdminTab as part of this module's API.
export function ShiftAdminTab({
  // Support the surrounding logic for this step.
  label,
  // Support the surrounding logic for this step.
  locale,
  // Support the surrounding logic for this step.
  shiftsLoading,
  // Support the surrounding logic for this step.
  shifts,
  // Support the surrounding logic for this step.
  housekeepers,
  // Support the surrounding logic for this step.
  canManageShifts,
  // Support the surrounding logic for this step.
  busy,
  // Support the surrounding logic for this step.
  editor,
// Support the surrounding logic for this step.
}: Props) {
  // Conditional branch for the case described by this guard.
  if (shiftsLoading) {
    // Return early result or rendered output from this path.
    return <LoadingIndicator label={label("Зареждане…", "Loading…")} />;
  }

  // Return the JSX/UI tree for this render path.
  return (
    // Render ShiftPanel as part of this view composition.
    <ShiftPanel
      // Pass label prop/value into the element or config.
      label={label}
      // Pass locale prop/value into the element or config.
      locale={locale}
      // Pass shifts prop/value into the element or config.
      shifts={shifts}
      // Pass housekeepers prop/value into the element or config.
      housekeepers={housekeepers}
      // Pass canManage prop/value into the element or config.
      canManage={canManageShifts}
      // Pass busy prop/value into the element or config.
      busy={busy}
      // Pass editor prop/value into the element or config.
      editor={editor}
    />
  );
}
