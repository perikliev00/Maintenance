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
  onOptionIdChange: (optionId: string, option?: IssueOptionRow) => void;
  onCategoryIdChange: (categoryId: string) => void;
  onTitleChange: (title: string) => void;
  onBlocksRoomChange: (blocks: boolean) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

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
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <h3>Report issue</h3>
        <label>
          Type
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
        {pickMode === "option" ? (
          <label>
            Option
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
                  {o.nameBg}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              Title
              <input
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                required
              />
            </label>
            <label>
              Category
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
        <label className="checkbox">
          <input
            type="checkbox"
            checked={blocksRoom}
            onChange={(e) => onBlocksRoomChange(e.target.checked)}
          />
          Blocks {unitLabel} readiness
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">Submit</button>
        </div>
      </form>
    </div>
  );
}
