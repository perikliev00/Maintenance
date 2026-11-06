import type { Person, SectorRow } from "../../api/client";
import { LoadingIndicator } from "../../components/LoadingIndicator";
import { SectorPanel } from "../../components/SectorPanel";
import type { useSectorEditor } from "./useSectorEditor";

type SectorEditor = ReturnType<typeof useSectorEditor>;

type Props = {
  label: (bg: string, en: string) => string;
  locale: "bg" | "en";
  sectorsLoading: boolean;
  sectors: SectorRow[];
  supervisors: Person[];
  canManageSectors: boolean;
  canCreateSectors: boolean;
  isSupervisorScope: boolean;
  busy: boolean;
  editor: SectorEditor;
};

export function SectorAdminTab({
  label,
  locale,
  sectorsLoading,
  sectors,
  supervisors,
  canManageSectors,
  canCreateSectors,
  isSupervisorScope,
  busy,
  editor,
}: Props) {
  if (sectorsLoading) {
    return <LoadingIndicator label={label("Зареждане…", "Loading…")} />;
  }

  return (
    <SectorPanel
      label={label}
      locale={locale}
      sectors={sectors}
      supervisors={supervisors}
      canManage={canManageSectors}
      canCreate={canCreateSectors}
      isSupervisorScope={isSupervisorScope}
      busy={busy}
      editor={editor}
    />
  );
}
