import type { Person, ShiftRow } from "../../api/client";
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
    return <p className="muted">{label("Зареждане…", "Loading…")}</p>;
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
