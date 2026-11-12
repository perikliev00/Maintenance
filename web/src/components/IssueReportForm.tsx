/**
 * Shared issue-report fields for Home, Locations (modal), and Repairs (catalog-only).
 * Parents own submit adapters, duplicate UX, and location pickers.
 */
import type { ReactNode } from "react";
// Import dependency used by this module.
import type {
  // List item in import/export/params.
  IssueOptionRow,
  // List item in import/export/params.
  MaintenanceCategoryRow,
// Close multi-line construct with trailing syntax.
} from "../api/client";
// Import dependency used by this module.
import { t } from "../i18n";

// Export type alias for consumers.
export type IssuePriority = "low" | "normal" | "high" | "urgent";
// Export type alias for consumers.
export type IssuePickMode = "option" | "custom";
// Export type alias for consumers.
export type IssueReportMode = "option+custom" | "catalog-only";

// Local type alias shaping data.
type Locale = "bg" | "en";

// Function definition.
function priorityLabel(locale: Locale, value: IssuePriority): string {
  // Local constant binding.
  const map: Record<IssuePriority, [string, string]> = {
    // Field/property in this shape.
    low: ["Нисък", "Low"],
    // Field/property in this shape.
    normal: ["Нормален", "Normal"],
    // Field/property in this shape.
    high: ["Висок", "High"],
    // Field/property in this shape.
    urgent: ["Спешен", "Urgent"],
  };
  // Assign value for subsequent use.
  const [bg, en] = map[value];
  // Return computed result to caller.
  return t(locale, bg, en);
}

// Export type alias for consumers.
export type IssueReportFormProps = {
  // Field/property in this shape.
  locale?: Locale;
  /** option+custom (Home/Locations) vs catalog-only (Repairs). */
  mode?: IssueReportMode;
  /** When false, omit pick-mode toggle (forced to option). */
  allowCustom?: boolean;
  // Field/property in this shape.
  pickMode?: IssuePickMode;
  // Field/property in this shape.
  optionId: string;
  // Field/property in this shape.
  categoryId?: string;
  // Field/property in this shape.
  title?: string;
  // Field/property in this shape.
  description?: string;
  // Field/property in this shape.
  showDescription?: boolean;
  /** Read-only title preview under catalog option (Repairs). */
  titlePreview?: string | null;
  // Field/property in this shape.
  blocksRoom: boolean;
  // Field/property in this shape.
  priority: IssuePriority | string;
  // Field/property in this shape.
  options: IssueOptionRow[];
  // Field/property in this shape.
  categories?: MaintenanceCategoryRow[];
  /** Custom labels for locale-sensitive copy. */
  labels?: {
    // Field/property in this shape.
    type?: string;
    // Field/property in this shape.
    option?: string;
    // Field/property in this shape.
    title?: string;
    // Field/property in this shape.
    category?: string;
    // Field/property in this shape.
    customOption?: string;
    // Field/property in this shape.
    catalogOption?: string;
    // Field/property in this shape.
    blocksRoom?: string;
    // Field/property in this shape.
    clarification?: string;
  };
  // Field/property in this shape.
  unitLabel?: string;
  /** Optional slot above the shared fields (e.g. room select). */
  beforeFields?: ReactNode;
  /** Optional slot after priority / before blocks (warnings, etc.). */
  afterPriority?: ReactNode;
  /** Optional slot after blocks checkbox. */
  afterBlocks?: ReactNode;
  // Arrow function / callback body.
  onPickModeChange?: (mode: IssuePickMode) => void;
  // Arrow function / callback body.
  onOptionIdChange: (optionId: string, option?: IssueOptionRow) => void;
  // Arrow function / callback body.
  onCategoryIdChange?: (categoryId: string) => void;
  // Arrow function / callback body.
  onTitleChange?: (title: string) => void;
  // Arrow function / callback body.
  onDescriptionChange?: (description: string) => void;
  // Arrow function / callback body.
  onBlocksRoomChange: (blocks: boolean) => void;
  // Arrow function / callback body.
  onPriorityChange: (priority: IssuePriority) => void;
  /** Confirm before enabling blocksRoom; return false to abort. */
  confirmBlocksRoom?: (next: boolean) => boolean;
  // Field/property in this shape.
  titleAsTextarea?: boolean;
};

/**
 * Controlled field cluster for reporting a maintenance issue.
 * Does not render a form/submit chrome — compose inside the parent form.
 */
export function IssueReportForm({
  // Assign value for subsequent use.
  locale = "bg",
  // Assign value for subsequent use.
  mode = "option+custom",
  // List item in import/export/params.
  allowCustom,
  // Assign value for subsequent use.
  pickMode = "option",
  // List item in import/export/params.
  optionId,
  // Assign value for subsequent use.
  categoryId = "",
  // Assign value for subsequent use.
  title = "",
  // Assign value for subsequent use.
  description = "",
  // Assign value for subsequent use.
  showDescription = false,
  // List item in import/export/params.
  titlePreview,
  // List item in import/export/params.
  blocksRoom,
  // List item in import/export/params.
  priority,
  // List item in import/export/params.
  options,
  // Assign value for subsequent use.
  categories = [],
  // List item in import/export/params.
  labels,
  // Assign value for subsequent use.
  unitLabel = locale === "bg" ? "стаята" : "the room",
  // List item in import/export/params.
  beforeFields,
  // List item in import/export/params.
  afterPriority,
  // List item in import/export/params.
  afterBlocks,
  // List item in import/export/params.
  onPickModeChange,
  // List item in import/export/params.
  onOptionIdChange,
  // List item in import/export/params.
  onCategoryIdChange,
  // List item in import/export/params.
  onTitleChange,
  // List item in import/export/params.
  onDescriptionChange,
  // List item in import/export/params.
  onBlocksRoomChange,
  // List item in import/export/params.
  onPriorityChange,
  // List item in import/export/params.
  confirmBlocksRoom,
  // Assign value for subsequent use.
  titleAsTextarea = false,
// Open multi-line construct.
}: IssueReportFormProps) {
  // Local constant binding.
  const catalogOnly = mode === "catalog-only" || allowCustom === false;
  // Local constant binding.
  const effectivePick: IssuePickMode = catalogOnly ? "option" : pickMode;

  // Local constant binding.
  const typeLabel = labels?.type ?? t(locale, "Тип", "Type");
  // Local constant binding.
  const optionLabel = labels?.option ?? t(locale, "Опция", "Option");
  // Local constant binding.
  const titleLabel =
    // Invoke helper or pass arguments.
    labels?.title ?? t(locale, "Заглавие", "Title");
  // Local constant binding.
  const categoryLabel = labels?.category ?? t(locale, "Категория", "Category");
  // Local constant binding.
  const catalogLabel =
    // Invoke helper or pass arguments.
    labels?.catalogOption ?? t(locale, "От каталог", "From catalog");
  // Local constant binding.
  const customLabel =
    // Invoke helper or pass arguments.
    labels?.customOption ?? t(locale, "Свободен текст", "Custom");
  // Local constant binding.
  const blocksLabel =
    // Continue module logic.
    labels?.blocksRoom ??
    // Open multi-line construct.
    t(
      // List item in import/export/params.
      locale,
      // Continue multi-line list/arguments.
      `Блокира готовността на ${unitLabel}`,
      // Continue multi-line list/arguments.
      `Blocks ${unitLabel} readiness`,
    );
  // Local constant binding.
  const clarificationLabel =
    // Continue module logic.
    labels?.clarification ??
    // Invoke helper or pass arguments.
    t(locale, "Уточнение (опционално)", "Clarification (optional)");

  // Function definition.
  function setBlocks(next: boolean) {
    // Conditional branch for this case.
    if (confirmBlocksRoom && !confirmBlocksRoom(next)) return;
    // Invoke helper or pass arguments.
    onBlocksRoomChange(next);
  }

  // Return computed result to caller.
  return (
    // Continue module logic.
    <>
            {beforeFields}
            {!catalogOnly && onPickModeChange ? (
        // Render JSX element.
        <label>
                    {typeLabel}
                    <select
            // Assign value for subsequent use.
            value={effectivePick}
            // Arrow function / callback body.
            onChange={(e) =>
              // Invoke helper or pass arguments.
              onPickModeChange(e.target.value as IssuePickMode)
            }
          >
                        <option value="option">{catalogLabel}</option>
                        <option value="custom">{customLabel}</option>
                    </select>
                </label>
      // Close multi-line construct with trailing syntax.
      ) : null}
            {effectivePick === "option" ? (
        // Render JSX element.
        <label>
                    {optionLabel}
                    <select
            // Assign value for subsequent use.
            value={optionId}
            // Arrow function / callback body.
            onChange={(e) => {
              // Local constant binding.
              const opt = options.find((o) => o.id === e.target.value);
              // Invoke helper or pass arguments.
              onOptionIdChange(e.target.value, opt);
            }}
            // JSX boolean prop or identifier.
            required
          >
                        {options.map((o) => (
              // Render JSX element.
              <option key={o.id} value={o.id}>
                                {locale === "en" ? o.nameEn : o.nameBg}
                            </option>
            ))}
                    </select>
                </label>
      // Invoke helper or pass arguments.
      ) : (
        // Continue module logic.
        <>
                    <label>
                        {titleLabel}
                        {titleAsTextarea ? (
              // Render JSX element.
              <textarea
                // Assign value for subsequent use.
                value={title}
                // Arrow function / callback body.
                onChange={(e) => onTitleChange?.(e.target.value)}
                // Assign value for subsequent use.
                rows={3}
                // JSX boolean prop or identifier.
                required
              />
            // Invoke helper or pass arguments.
            ) : (
              // Render JSX element.
              <input
                // Assign value for subsequent use.
                value={title}
                // Arrow function / callback body.
                onChange={(e) => onTitleChange?.(e.target.value)}
                // JSX boolean prop or identifier.
                required
              />
            )}
                    </label>
                    <label>
                        {categoryLabel}
                        <select
              // Assign value for subsequent use.
              value={categoryId}
              // Arrow function / callback body.
              onChange={(e) => onCategoryIdChange?.(e.target.value)}
              // JSX boolean prop or identifier.
              required
            >
                            {categories.map((c) => (
                // Render JSX element.
                <option key={c.id} value={c.id}>
                                    {locale === "en" ? c.nameEn : c.nameBg}
                                </option>
              ))}
                        </select>
                    </label>
                </>
      )}
            {titlePreview ? (
        // Render JSX element.
        <p className="muted">
                    {t(locale, "Заглавие", "Title")}: <strong>{titlePreview}</strong>
                </p>
      // Close multi-line construct with trailing syntax.
      ) : null}
            {showDescription ? (
        // Render JSX element.
        <label>
                    {clarificationLabel}
                    <textarea
            // Assign value for subsequent use.
            value={description}
            // Arrow function / callback body.
            onChange={(e) => onDescriptionChange?.(e.target.value)}
            // Assign value for subsequent use.
            rows={2}
            // Assign value for subsequent use.
            placeholder={t(
              // List item in import/export/params.
              locale,
              // Continue multi-line list/arguments.
              "Допълнителни детайли…",
              // Continue multi-line list/arguments.
              "Additional details…",
            )}
          />
                </label>
      // Close multi-line construct with trailing syntax.
      ) : null}
            <label>
                {t(locale, "Приоритет", "Priority")}
                <select
          // Assign value for subsequent use.
          value={priority}
          // Arrow function / callback body.
          onChange={(e) =>
            // Invoke helper or pass arguments.
            onPriorityChange(e.target.value as IssuePriority)
          }
        >
                    <option value="low">{priorityLabel(locale, "low")}</option>
                    <option value="normal">{priorityLabel(locale, "normal")}</option>
                    <option value="high">{priorityLabel(locale, "high")}</option>
                    <option value="urgent">{priorityLabel(locale, "urgent")}</option>
                </select>
            </label>
            {afterPriority}
            <label className="checkbox checkbox-inline check">
                <input
          // Assign value for subsequent use.
          type="checkbox"
          // Assign value for subsequent use.
          checked={blocksRoom}
          // Arrow function / callback body.
          onChange={(e) => setBlocks(e.target.checked)}
        />
                {blocksLabel}
            </label>
            {afterBlocks}
        </>
  );
}
