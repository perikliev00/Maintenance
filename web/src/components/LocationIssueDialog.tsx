/**
 * Modal to report a location issue either from the catalog option list
 * or as a free-text custom title + category. Selecting a catalog option
 * passes the full row so the parent can apply defaults (priority / blocks).
 * Portaled to document.body so position:fixed is always viewport-relative.
 */
import { createPortal } from "react-dom";
import type {
  IssueOptionRow,
  MaintenanceCategoryRow,
} from "../api/client";
import { useModalLifecycle } from "../hooks/useModalLifecycle";
import { t } from "../i18n";
import { IssueReportForm } from "./IssueReportForm";

type Locale = "bg" | "en";

type Props = {
  unitLabel: string;
  locale?: Locale;
  pickMode: "option" | "custom";
  optionId: string;
  categoryId: string;
  title: string;
  blocksRoom: boolean;
  priority: "low" | "normal" | "high" | "urgent";
  options: IssueOptionRow[];
  categories: MaintenanceCategoryRow[];
  onPickModeChange: (mode: "option" | "custom") => void;
  /** Second arg is the matched option when present (for applying catalog defaults). */
  onOptionIdChange: (optionId: string, option?: IssueOptionRow) => void;
  onCategoryIdChange: (categoryId: string) => void;
  onTitleChange: (title: string) => void;
  onBlocksRoomChange: (blocks: boolean) => void;
  onPriorityChange: (priority: "low" | "normal" | "high" | "urgent") => void;
  onCancel: () => void;
  onSubmit: () => void;
};

/**
 * Modal dialog for reporting a location issue (catalog option or custom).
 * Parent owns persistence / offline enqueue; this component only collects fields.
 */
export function LocationIssueDialog({
  unitLabel,
  locale = "bg",
  pickMode,
  optionId,
  categoryId,
  title,
  blocksRoom,
  priority,
  options,
  categories,
  onPickModeChange,
  onOptionIdChange,
  onCategoryIdChange,
  onTitleChange,
  onBlocksRoomChange,
  onPriorityChange,
  onCancel,
  onSubmit,
}: Props) {
  useModalLifecycle(onCancel);

  return createPortal(
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <h3>{t(locale, "Докладвай проблем", "Report issue")}</h3>
        <IssueReportForm
          locale={locale}
          mode="option+custom"
          pickMode={pickMode}
          optionId={optionId}
          categoryId={categoryId}
          title={title}
          blocksRoom={blocksRoom}
          priority={priority}
          options={options}
          categories={categories}
          unitLabel={unitLabel}
          onPickModeChange={onPickModeChange}
          onOptionIdChange={onOptionIdChange}
          onCategoryIdChange={onCategoryIdChange}
          onTitleChange={onTitleChange}
          onBlocksRoomChange={onBlocksRoomChange}
          onPriorityChange={onPriorityChange}
        />
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            {t(locale, "Отказ", "Cancel")}
          </button>
          <button type="submit">{t(locale, "Изпрати", "Submit")}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
