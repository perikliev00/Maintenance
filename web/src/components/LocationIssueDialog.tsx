/**
 * Modal to report a location issue either from the catalog option list
 * or as a free-text custom title + category. Selecting a catalog option
 * passes the full row so the parent can apply defaults (priority / blocks).
 */
import type {
  IssueOptionRow,
  MaintenanceCategoryRow,
} from "../api/client";

type Props = {
  unitLabel: string;
  pickMode: "option" | "custom";
  optionId: string;
  categoryId: string;
  title: string;
  blocksRoom: boolean;
  options: IssueOptionRow[];
  categories: MaintenanceCategoryRow[];
  onPickModeChange: (mode: "option" | "custom") => void;
  /** Second arg is the matched option when present (for applying catalog defaults). */
  onOptionIdChange: (optionId: string, option?: IssueOptionRow) => void;
  onCategoryIdChange: (categoryId: string) => void;
  onTitleChange: (title: string) => void;
  onBlocksRoomChange: (blocks: boolean) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

/**
 * Modal dialog for reporting a location issue (catalog option or custom).
 * Parent owns persistence / offline enqueue; this component only collects fields.
 */
export function LocationIssueDialog({
  unitLabel,
  pickMode,
  optionId,
  categoryId,
  title,
  blocksRoom,
  options,
  categories,
  onPickModeChange,
  onOptionIdChange,
  onCategoryIdChange,
  onTitleChange,
  onBlocksRoomChange,
  onCancel,
  onSubmit,
}: Props) {
  // Render output.
  return (
    <div className="modal-backdrop">
      {/* Editable form. */}
      <form
        className="modal"
        onSubmit={(e) => {
          // Prevent full page reload; parent owns the report / enqueue mutation.
          e.preventDefault();
          onSubmit();
        }}
      >
        {/* Section heading. */}
        <h3>Report issue</h3>
        {/* Toggle catalog option path vs free-text custom path. */}
        <label>
          Type
          {/* Select input. */}
          <select
            value={pickMode}
            onChange={(e) =>
              onPickModeChange(e.target.value as "option" | "custom")
            }
          >
            <option value="option">From catalog</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {/* Catalog path: pass the full option so parent can apply defaults. */}
        {/* Form field. */}
        {pickMode === "option" ? (
          <label>
            Option
            {/* Select input. */}
            <select
              value={optionId}
              onChange={(e) => {
                // Resolve the row so priority/blocks defaults can be applied upstream.
                const opt = options.find((o) => o.id === e.target.value);
                onOptionIdChange(e.target.value, opt);
              }}
              required
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nameBg}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            {/* Custom path: free title + category from the maintenance catalog. */}
            <label>
              Title
              {/* Text/checkbox input. */}
              <input
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                required
              />
            </label>
            {/* Form field. */}
            <label>
              Category
              {/* Select input. */}
              <select
                value={categoryId}
                onChange={(e) => onCategoryIdChange(e.target.value)}
                required
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameBg}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {/* Whether the issue should block location readiness. */}
        <label className="checkbox">
          {/* Text/checkbox input. */}
          <input
            type="checkbox"
            checked={blocksRoom}
            onChange={(e) => onBlocksRoomChange(e.target.checked)}
          />
          Blocks {unitLabel} readiness
        </label>
        <div className="modal-actions">
          {/* Action control. */}
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
          {/* Action control. */}
          <button type="submit">Submit</button>
        </div>
      </form>
    </div>
  );
}
