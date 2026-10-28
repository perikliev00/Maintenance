/**
 * Modal to report a location issue either from the catalog option list
 * or as a free-text custom title + category. Selecting a catalog option
 * passes the full row so the parent can apply defaults (priority / blocks).
 * Portaled to document.body so position:fixed is always viewport-relative.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type {
  IssueOptionRow,
  MaintenanceCategoryRow,
} from "../api/client";

type Locale = "bg" | "en";

function t(locale: Locale, bg: string, en: string): string {
  return locale === "en" ? en : bg;
}

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
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

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
        <label>
          {t(locale, "Тип", "Type")}
          <select
            value={pickMode}
            onChange={(e) =>
              onPickModeChange(e.target.value as "option" | "custom")
            }
          >
            <option value="option">
              {t(locale, "От каталог", "From catalog")}
            </option>
            <option value="custom">
              {t(locale, "Свободен текст", "Custom")}
            </option>
          </select>
        </label>
        {pickMode === "option" ? (
          <label>
            {t(locale, "Опция", "Option")}
            <select
              value={optionId}
              onChange={(e) => {
                const opt = options.find((o) => o.id === e.target.value);
                onOptionIdChange(e.target.value, opt);
              }}
              required
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {locale === "en" ? o.nameEn : o.nameBg}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              {t(locale, "Заглавие", "Title")}
              <input
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                required
              />
            </label>
            <label>
              {t(locale, "Категория", "Category")}
              <select
                value={categoryId}
                onChange={(e) => onCategoryIdChange(e.target.value)}
                required
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {locale === "en" ? c.nameEn : c.nameBg}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          {t(locale, "Приоритет", "Priority")}
          <select
            value={priority}
            onChange={(e) =>
              onPriorityChange(
                e.target.value as "low" | "normal" | "high" | "urgent",
              )
            }
          >
            <option value="low">{t(locale, "Нисък", "Low")}</option>
            <option value="normal">{t(locale, "Нормален", "Normal")}</option>
            <option value="high">{t(locale, "Висок", "High")}</option>
            <option value="urgent">{t(locale, "Спешен", "Urgent")}</option>
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={blocksRoom}
            onChange={(e) => onBlocksRoomChange(e.target.checked)}
          />
          {t(
            locale,
            `Блокира готовността на ${unitLabel}`,
            `Blocks ${unitLabel} readiness`,
          )}
        </label>
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
