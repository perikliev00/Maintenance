/**
 * Modal to report a location issue either from the catalog option list
 * or as a free-text custom title + category. Selecting a catalog option
 * passes the full row so the parent can apply defaults (priority / blocks).
 * Portaled to document.body so position:fixed is always viewport-relative.
 */
import { createPortal } from "react-dom";
// Import dependency used by this module.
import type {
  // List item in import/export/params.
  IssueOptionRow,
  // List item in import/export/params.
  MaintenanceCategoryRow,
// Close multi-line construct with trailing syntax.
} from "../api/client";
// Import dependency used by this module.
import { useModalLifecycle } from "../hooks/useModalLifecycle";
// Import dependency used by this module.
import { t } from "../i18n";
// Import dependency used by this module.
import { IssueReportForm } from "./IssueReportForm";

// Local type alias shaping data.
type Locale = "bg" | "en";

// Local type alias shaping data.
type Props = {
  // Field/property in this shape.
  unitLabel: string;
  // Field/property in this shape.
  locale?: Locale;
  // Field/property in this shape.
  pickMode: "option" | "custom";
  // Field/property in this shape.
  optionId: string;
  // Field/property in this shape.
  categoryId: string;
  // Field/property in this shape.
  title: string;
  // Field/property in this shape.
  blocksRoom: boolean;
  // Field/property in this shape.
  priority: "low" | "normal" | "high" | "urgent";
  // Field/property in this shape.
  options: IssueOptionRow[];
  // Field/property in this shape.
  categories: MaintenanceCategoryRow[];
  // Arrow function / callback body.
  onPickModeChange: (mode: "option" | "custom") => void;
  /** Second arg is the matched option when present (for applying catalog defaults). */
  onOptionIdChange: (optionId: string, option?: IssueOptionRow) => void;
  // Arrow function / callback body.
  onCategoryIdChange: (categoryId: string) => void;
  // Arrow function / callback body.
  onTitleChange: (title: string) => void;
  // Arrow function / callback body.
  onBlocksRoomChange: (blocks: boolean) => void;
  // Arrow function / callback body.
  onPriorityChange: (priority: "low" | "normal" | "high" | "urgent") => void;
  // Arrow function / callback body.
  onCancel: () => void;
  // Arrow function / callback body.
  onSubmit: () => void;
};

/**
 * Modal dialog for reporting a location issue (catalog option or custom).
 * Parent owns persistence / offline enqueue; this component only collects fields.
 */
export function LocationIssueDialog({
  // List item in import/export/params.
  unitLabel,
  // Assign value for subsequent use.
  locale = "bg",
  // List item in import/export/params.
  pickMode,
  // List item in import/export/params.
  optionId,
  // List item in import/export/params.
  categoryId,
  // List item in import/export/params.
  title,
  // List item in import/export/params.
  blocksRoom,
  // List item in import/export/params.
  priority,
  // List item in import/export/params.
  options,
  // List item in import/export/params.
  categories,
  // List item in import/export/params.
  onPickModeChange,
  // List item in import/export/params.
  onOptionIdChange,
  // List item in import/export/params.
  onCategoryIdChange,
  // List item in import/export/params.
  onTitleChange,
  // List item in import/export/params.
  onBlocksRoomChange,
  // List item in import/export/params.
  onPriorityChange,
  // List item in import/export/params.
  onCancel,
  // List item in import/export/params.
  onSubmit,
// Open multi-line construct.
}: Props) {
  // Invoke helper or pass arguments.
  useModalLifecycle(onCancel);

  // Return computed result to caller.
  return createPortal(
    // Render JSX element.
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      // Render JSX element.
      <form
        // Assign value for subsequent use.
        className="modal"
        // Arrow function / callback body.
        onClick={(e) => e.stopPropagation()}
        // Arrow function / callback body.
        onSubmit={(e) => {
          // Invoke helper or pass arguments.
          e.preventDefault();
          // Invoke helper or pass arguments.
          onSubmit();
        }}
      >
        // Render JSX element.
        <h3>{t(locale, "Докладвай проблем", "Report issue")}</h3>
        // Render JSX element.
        <IssueReportForm
          // Assign value for subsequent use.
          locale={locale}
          // Assign value for subsequent use.
          mode="option+custom"
          // Assign value for subsequent use.
          pickMode={pickMode}
          // Assign value for subsequent use.
          optionId={optionId}
          // Assign value for subsequent use.
          categoryId={categoryId}
          // Assign value for subsequent use.
          title={title}
          // Assign value for subsequent use.
          blocksRoom={blocksRoom}
          // Assign value for subsequent use.
          priority={priority}
          // Assign value for subsequent use.
          options={options}
          // Assign value for subsequent use.
          categories={categories}
          // Assign value for subsequent use.
          unitLabel={unitLabel}
          // Assign value for subsequent use.
          onPickModeChange={onPickModeChange}
          // Assign value for subsequent use.
          onOptionIdChange={onOptionIdChange}
          // Assign value for subsequent use.
          onCategoryIdChange={onCategoryIdChange}
          // Assign value for subsequent use.
          onTitleChange={onTitleChange}
          // Assign value for subsequent use.
          onBlocksRoomChange={onBlocksRoomChange}
          // Assign value for subsequent use.
          onPriorityChange={onPriorityChange}
        />
        // Render JSX element.
        <div className="modal-actions">
          // Render JSX element.
          <button type="button" className="ghost" onClick={onCancel}>
            // JSX expression container.
            {t(locale, "Отказ", "Cancel")}
          // JSX element boundary.
          </button>
          // Render JSX element.
          <button type="submit">{t(locale, "Изпрати", "Submit")}</button>
        // JSX element boundary.
        </div>
      // JSX element boundary.
      </form>
    // JSX element boundary.
    </div>,
    // Continue multi-line list/arguments.
    document.body,
  );
}
