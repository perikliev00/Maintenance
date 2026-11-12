import type { Person, ShiftRow } from "../../api/client";
import { LoadingIndicator } from "../../components/LoadingIndicator";
import { ShiftPanel } from "../../components/ShiftPanel";
import type { useShiftEditor } from "./useShiftEditor";

type ShiftEditor = ReturnType<typeof useShiftEditor>;

type Props = {
  label: (bg: string, en: string) => string;
  locale: "bg" | "en";
  shiftsLoading: boolean;
  shifts: ShiftRow[];
  housekeepers: Person[];
  canManageShifts: boolean;
  busy: boolean;
  editor: ShiftEditor;
};

// Export function ShiftAdminTab as part of this module's API.
export function ShiftAdminTab({
  label,
  locale,
  shiftsLoading,
  shifts,
  housekeepers,
  canManageShifts,
  busy,
  editor,
}: Props) {
  if (shiftsLoading) {
    return <LoadingIndicator label={label("Зареждане…", "Loading…")} />;
  }

  return (
    <ShiftPanel
      label={label}
      locale={locale}
      shifts={shifts}
      housekeepers={housekeepers}
      canManage={canManageShifts}
      busy={busy}
      editor={editor}
    />
  );
}
