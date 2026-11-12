// Import type-only dependency for typing without runtime cost.
import type { Person, SectorRow } from "../../api/client";
// Import module dependency from ../../components/LoadingIndicator.
import { LoadingIndicator } from "../../components/LoadingIndicator";
// Import module dependency from ../../components/SectorPanel.
import { SectorPanel } from "../../components/SectorPanel";
// Import type-only dependency for typing without runtime cost.
import type { useSectorEditor } from "./useSectorEditor";

// Declare type alias SectorEditor.
type SectorEditor = ReturnType<typeof useSectorEditor>;

// Declare type alias Props.
type Props = {
  // Provide label field used by this structure.
  label: (bg: string, en: string) => string;
  // Provide locale field used by this structure.
  locale: "bg" | "en";
  // Provide sectorsLoading field used by this structure.
  sectorsLoading: boolean;
  // Provide sectors field used by this structure.
  sectors: SectorRow[];
  // Provide supervisors field used by this structure.
  supervisors: Person[];
  // Provide canManageSectors field used by this structure.
  canManageSectors: boolean;
  // Provide canCreateSectors field used by this structure.
  canCreateSectors: boolean;
  // Provide isSupervisorScope field used by this structure.
  isSupervisorScope: boolean;
  // Provide busy field used by this structure.
  busy: boolean;
  // Provide editor field used by this structure.
  editor: SectorEditor;
};

// Export function SectorAdminTab as part of this module's API.
export function SectorAdminTab({
  // Support the surrounding logic for this step.
  label,
  // Support the surrounding logic for this step.
  locale,
  // Support the surrounding logic for this step.
  sectorsLoading,
  // Support the surrounding logic for this step.
  sectors,
  // Support the surrounding logic for this step.
  supervisors,
  // Support the surrounding logic for this step.
  canManageSectors,
  // Support the surrounding logic for this step.
  canCreateSectors,
  // Support the surrounding logic for this step.
  isSupervisorScope,
  // Support the surrounding logic for this step.
  busy,
  // Support the surrounding logic for this step.
  editor,
// Support the surrounding logic for this step.
}: Props) {
  // Conditional branch for the case described by this guard.
  if (sectorsLoading) {
    // Return early result or rendered output from this path.
    return <LoadingIndicator label={label("Зареждане…", "Loading…")} />;
  }

  // Return the JSX/UI tree for this render path.
  return (
    // Render SectorPanel as part of this view composition.
    <SectorPanel
      // Pass label prop/value into the element or config.
      label={label}
      // Pass locale prop/value into the element or config.
      locale={locale}
      // Pass sectors prop/value into the element or config.
      sectors={sectors}
      // Pass supervisors prop/value into the element or config.
      supervisors={supervisors}
      // Pass canManage prop/value into the element or config.
      canManage={canManageSectors}
      // Pass canCreate prop/value into the element or config.
      canCreate={canCreateSectors}
      // Pass isSupervisorScope prop/value into the element or config.
      isSupervisorScope={isSupervisorScope}
      // Pass busy prop/value into the element or config.
      busy={busy}
      // Pass editor prop/value into the element or config.
      editor={editor}
    />
  );
}
