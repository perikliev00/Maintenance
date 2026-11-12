/**
 * Shared issue-report fields for Home, Locations (modal), and Repairs (catalog-only).
 * Parents own submit adapters, duplicate UX, and location pickers.
 */
import type { ReactNode } from "react";
import type {
  IssueOptionRow,
  MaintenanceCategoryRow,
} from "../api/client";
import { t } from "../i18n";

export type IssuePriority = "low" | "normal" | "high" | "urgent";
export type IssuePickMode = "option" | "custom";
export type IssueReportMode = "option+custom" | "catalog-only";

type Locale = "bg" | "en";

// Function definition.
function priorityLabel(locale: Locale, value: IssuePriority): string {
  const map: Record<IssuePriority, [string, string]> = {
    low: ["Нисък", "Low"],
    normal: ["Нормален", "Normal"],
    high: ["Висок", "High"],
    urgent: ["Спешен", "Urgent"],
  };
  const [bg, en] = map[value];
  return t(locale, bg, en);
}

export type IssueReportFormProps = {
  locale?: Locale;
  /** option+custom (Home/Locations) vs catalog-only (Repairs). */
  mode?: IssueReportMode;
  /** When false, omit pick-mode toggle (forced to option). */
  allowCustom?: boolean;
  pickMode?: IssuePickMode;
  optionId: string;
  categoryId?: string;
  title?: string;
  description?: string;
  showDescription?: boolean;
  /** Read-only title preview under catalog option (Repairs). */
  titlePreview?: string | null;
  blocksRoom: boolean;
  priority: IssuePriority | string;
  options: IssueOptionRow[];
  categories?: MaintenanceCategoryRow[];
  /** Custom labels for locale-sensitive copy. */
  labels?: {
    type?: string;
    option?: string;
    title?: string;
    category?: string;
    customOption?: string;
    catalogOption?: string;
    blocksRoom?: string;
    clarification?: string;
  };
  unitLabel?: string;
  /** Optional slot above the shared fields (e.g. room select). */
  beforeFields?: ReactNode;
  /** Optional slot after priority / before blocks (warnings, etc.). */
  afterPriority?: ReactNode;
  /** Optional slot after blocks checkbox. */
  afterBlocks?: ReactNode;
  onPickModeChange?: (mode: IssuePickMode) => void;
  onOptionIdChange: (optionId: string, option?: IssueOptionRow) => void;
  onCategoryIdChange?: (categoryId: string) => void;
  onTitleChange?: (title: string) => void;
  onDescriptionChange?: (description: string) => void;
  onBlocksRoomChange: (blocks: boolean) => void;
  onPriorityChange: (priority: IssuePriority) => void;
  /** Confirm before enabling blocksRoom; return false to abort. */
  confirmBlocksRoom?: (next: boolean) => boolean;
  titleAsTextarea?: boolean;
};

/**
 * Controlled field cluster for reporting a maintenance issue.
 * Does not render a form/submit chrome — compose inside the parent form.
 */
export function IssueReportForm({
  locale = "bg",
  mode = "option+custom",
  allowCustom,
  pickMode = "option",
  optionId,
  categoryId = "",
  title = "",
  description = "",
  showDescription = false,
  titlePreview,
  blocksRoom,
  priority,
  options,
  categories = [],
  labels,
  unitLabel = locale === "bg" ? "стаята" : "the room",
  beforeFields,
  afterPriority,
  afterBlocks,
  onPickModeChange,
  onOptionIdChange,
  onCategoryIdChange,
  onTitleChange,
  onDescriptionChange,
  onBlocksRoomChange,
  onPriorityChange,
  confirmBlocksRoom,
  titleAsTextarea = false,
}: IssueReportFormProps) {
  const catalogOnly = mode === "catalog-only" || allowCustom === false;
  const effectivePick: IssuePickMode = catalogOnly ? "option" : pickMode;

  const typeLabel = labels?.type ?? t(locale, "Тип", "Type");
  const optionLabel = labels?.option ?? t(locale, "Опция", "Option");
  const titleLabel =
    labels?.title ?? t(locale, "Заглавие", "Title");
  const categoryLabel = labels?.category ?? t(locale, "Категория", "Category");
  const catalogLabel =
    labels?.catalogOption ?? t(locale, "От каталог", "From catalog");
  const customLabel =
    labels?.customOption ?? t(locale, "Свободен текст", "Custom");
  const blocksLabel =
    // Continue module logic.
    labels?.blocksRoom ??
    t(
      locale,
      `Блокира готовността на ${unitLabel}`,
      `Blocks ${unitLabel} readiness`,
    );
  const clarificationLabel =
    // Continue module logic.
    labels?.clarification ??
    t(locale, "Уточнение (опционално)", "Clarification (optional)");

  // Function definition.
  function setBlocks(next: boolean) {
    if (confirmBlocksRoom && !confirmBlocksRoom(next)) return;
    onBlocksRoomChange(next);
  }

  return (
    // Continue module logic.
    <>
            {beforeFields}
            {!catalogOnly && onPickModeChange ? (
        // Render JSX element.
        <label>
                    {typeLabel}
                    <select
            value={effectivePick}
            onChange={(e) =>
              onPickModeChange(e.target.value as IssuePickMode)
            }
          >
                        <option value="option">{catalogLabel}</option>
                        <option value="custom">{customLabel}</option>
                    </select>
                </label>
      ) : null}
            {effectivePick === "option" ? (
        // Render JSX element.
        <label>
                    {optionLabel}
                    <select
            value={optionId}
            onChange={(e) => {
              const opt = options.find((o) => o.id === e.target.value);
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
                value={title}
                onChange={(e) => onTitleChange?.(e.target.value)}
                rows={3}
                // JSX boolean prop or identifier.
                required
              />
            // Invoke helper or pass arguments.
            ) : (
              // Render JSX element.
              <input
                value={title}
                onChange={(e) => onTitleChange?.(e.target.value)}
                // JSX boolean prop or identifier.
                required
              />
            )}
                    </label>
                    <label>
                        {categoryLabel}
                        <select
              value={categoryId}
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
      ) : null}
            {showDescription ? (
        // Render JSX element.
        <label>
                    {clarificationLabel}
                    <textarea
            value={description}
            onChange={(e) => onDescriptionChange?.(e.target.value)}
            rows={2}
            placeholder={t(
              locale,
              "Допълнителни детайли…",
              "Additional details…",
            )}
          />
                </label>
      ) : null}
            <label>
                {t(locale, "Приоритет", "Priority")}
                <select
          value={priority}
          onChange={(e) =>
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
          type="checkbox"
          checked={blocksRoom}
          onChange={(e) => setBlocks(e.target.checked)}
        />
                {blocksLabel}
            </label>
            {afterBlocks}
        </>
  );
}
