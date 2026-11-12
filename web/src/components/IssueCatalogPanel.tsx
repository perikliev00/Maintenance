/**
 * Admin catalog for maintenance categories and issue options.
 * Option reorder uses optimistic local order, then persists via `reorderIssueOptions`
 * (reverts on failure). Drag-and-drop and ↑/↓ share the same persist path.
 */
import {
  // List item in import/export/params.
  archiveIssueOption,
  // List item in import/export/params.
  archiveMaintenanceCategory,
  // List item in import/export/params.
  updateIssueOption,
  // List item in import/export/params.
  updateMaintenanceCategory,
// Close multi-line construct with trailing syntax.
} from "../api/client";
// Import dependency used by this module.
import { useIssueCatalog } from "../hooks/useIssueCatalog";
// Import dependency used by this module.
import { LoadingIndicator } from "./LoadingIndicator";

// Local type alias shaping data.
type Props = {
  // Field/property in this shape.
  locale: "bg" | "en";
};

// Local constant binding.
const KIND_LABELS: Record<string, { bg: string; en: string }> = {
  // Field/property in this shape.
  maintenance: { bg: "Поддръжка", en: "Maintenance" },
  // Field/property in this shape.
  housekeeping: { bg: "Камериерска", en: "Housekeeping" },
};

/**
 * Admin catalog for maintenance categories and issue options.
 * Option reorder uses optimistic local order, then persists (reverts on failure).
 */
export function IssueCatalogPanel({ locale }: Props) {
  // Open multi-line construct.
  const {
    // List item in import/export/params.
    label,
    // List item in import/export/params.
    subTab,
    // List item in import/export/params.
    setSubTab,
    // List item in import/export/params.
    categories,
    // List item in import/export/params.
    options,
    // List item in import/export/params.
    loading,
    // List item in import/export/params.
    error,
    // List item in import/export/params.
    message,
    // List item in import/export/params.
    busy,
    // List item in import/export/params.
    dragId,
    // List item in import/export/params.
    dropTargetId,
    // List item in import/export/params.
    catKey,
    // List item in import/export/params.
    setCatKey,
    // List item in import/export/params.
    catNameBg,
    // List item in import/export/params.
    setCatNameBg,
    // List item in import/export/params.
    catNameEn,
    // List item in import/export/params.
    setCatNameEn,
    // List item in import/export/params.
    optCategoryId,
    // List item in import/export/params.
    setOptCategoryId,
    // List item in import/export/params.
    optKind,
    // List item in import/export/params.
    setOptKind,
    // List item in import/export/params.
    optNameBg,
    // List item in import/export/params.
    setOptNameBg,
    // List item in import/export/params.
    optNameEn,
    // List item in import/export/params.
    setOptNameEn,
    // List item in import/export/params.
    optDefaultPriority,
    // List item in import/export/params.
    setOptDefaultPriority,
    // List item in import/export/params.
    optDefaultBlocks,
    // List item in import/export/params.
    setOptDefaultBlocks,
    // List item in import/export/params.
    run,
    // List item in import/export/params.
    onAddCategory,
    // List item in import/export/params.
    onAddOption,
    // List item in import/export/params.
    moveOption,
    // List item in import/export/params.
    onDragStart,
    // List item in import/export/params.
    onDragOver,
    // List item in import/export/params.
    onDragLeave,
    // List item in import/export/params.
    onDrop,
    // List item in import/export/params.
    onDragEnd,
    // List item in import/export/params.
    catName,
  // Assign value for subsequent use.
  } = useIssueCatalog({ locale });

  // Conditional branch for this case.
  if (loading) {
    // Return computed result to caller.
    return <LoadingIndicator label={label("Зареждане…", "Loading…")} />;
  }

  // Return computed result to caller.
  return (
    // Render JSX element.
    <div className="issue-catalog">
      // Render JSX element.
      <div className="settings-tabs" role="tablist">
        // Render JSX element.
        <button
          // Assign value for subsequent use.
          type="button"
          // Assign value for subsequent use.
          className={subTab === "options" ? "nav-tab active" : "nav-tab"}
          // Arrow function / callback body.
          onClick={() => setSubTab("options")}
        >
          // JSX expression container.
          {label("Опции", "Options")}
        // JSX element boundary.
        </button>
        // Render JSX element.
        <button
          // Assign value for subsequent use.
          type="button"
          // Assign value for subsequent use.
          className={subTab === "categories" ? "nav-tab active" : "nav-tab"}
          // Arrow function / callback body.
          onClick={() => setSubTab("categories")}
        >
          // JSX expression container.
          {label("Категории", "Categories")}
        // JSX element boundary.
        </button>
      // JSX element boundary.
      </div>

      // JSX expression container.
      {error && <div className="error banner">{error}</div>}
      // JSX expression container.
      {message && <div className="ok banner">{message}</div>}

      // JSX expression container.
      {subTab === "categories" && (
        // Continue module logic.
        <>
          // Render JSX element.
          <form className="stack-form" onSubmit={onAddCategory}>
            // Render JSX element.
            <h3>{label("Нова категория", "New category")}</h3>
            // Render JSX element.
            <label>
              // JSX boolean prop or identifier.
              key
              // Render JSX element.
              <input
                // Assign value for subsequent use.
                value={catKey}
                // Arrow function / callback body.
                onChange={(e) => setCatKey(e.target.value)}
                // JSX boolean prop or identifier.
                required
                // Assign value for subsequent use.
                placeholder="plumbing"
              />
            // JSX element boundary.
            </label>
            // Render JSX element.
            <label>
              // JSX expression container.
              {label("Име BG", "Name BG")}
              // Render JSX element.
              <input
                // Assign value for subsequent use.
                value={catNameBg}
                // Arrow function / callback body.
                onChange={(e) => setCatNameBg(e.target.value)}
                // JSX boolean prop or identifier.
                required
              />
            // JSX element boundary.
            </label>
            // Render JSX element.
            <label>
              // JSX expression container.
              {label("Име EN", "Name EN")}
              // Render JSX element.
              <input
                // Assign value for subsequent use.
                value={catNameEn}
                // Arrow function / callback body.
                onChange={(e) => setCatNameEn(e.target.value)}
                // JSX boolean prop or identifier.
                required
              />
            // JSX element boundary.
            </label>
            // Render JSX element.
            <button type="submit" disabled={busy}>
              // JSX expression container.
              {label("Добави", "Add")}
            // JSX element boundary.
            </button>
          // JSX element boundary.
          </form>
          // Render JSX element.
          <table className="data-table">
            // Render JSX element.
            <thead>
              // Render JSX element.
              <tr>
                // Render JSX element.
                <th>key</th>
                // Render JSX element.
                <th>{label("Име", "Name")}</th>
                // Render JSX element.
                <th>{label("Активна", "Active")}</th>
                // Render JSX element.
                <th>{label("Действия", "Actions")}</th>
              // JSX element boundary.
              </tr>
            // JSX element boundary.
            </thead>
            // Render JSX element.
            <tbody>
              // JSX expression container.
              {categories.map((c) => (
                // Render JSX element.
                <tr key={c.id}>
                  // Render JSX element.
                  <td>{c.key}</td>
                  // Render JSX element.
                  <td>{catName(c)}</td>
                  // Render JSX element.
                  <td>{c.isActive ? "✓" : "—"}</td>
                  // Render JSX element.
                  <td>
                    // JSX expression container.
                    {c.isActive ? (
                      // Render JSX element.
                      <button
                        // Assign value for subsequent use.
                        type="button"
                        // Assign value for subsequent use.
                        className="subtle"
                        // Assign value for subsequent use.
                        disabled={busy}
                        // Arrow function / callback body.
                        onClick={() =>
                          // Arrow function / callback body.
                          run(async () => {
                            // Await async work before continuing.
                            await archiveMaintenanceCategory(c.id);
                          })
                        }
                      >
                        // JSX expression container.
                        {label("Архивирай", "Archive")}
                      // JSX element boundary.
                      </button>
                    // Invoke helper or pass arguments.
                    ) : (
                      // Render JSX element.
                      <button
                        // Assign value for subsequent use.
                        type="button"
                        // Assign value for subsequent use.
                        className="subtle"
                        // Assign value for subsequent use.
                        disabled={busy}
                        // Arrow function / callback body.
                        onClick={() =>
                          // Arrow function / callback body.
                          run(async () => {
                            // Await async work before continuing.
                            await updateMaintenanceCategory(c.id, {
                              // Field/property in this shape.
                              isActive: true,
                            });
                          })
                        }
                      >
                        // JSX expression container.
                        {label("Активирай", "Activate")}
                      // JSX element boundary.
                      </button>
                    )}
                  // JSX element boundary.
                  </td>
                // JSX element boundary.
                </tr>
              ))}
            // JSX element boundary.
            </tbody>
          // JSX element boundary.
          </table>
        // Continue module logic.
        </>
      )}

      // JSX expression container.
      {subTab === "options" && (
        // Continue module logic.
        <>
          // Render JSX element.
          <form className="stack-form" onSubmit={onAddOption}>
            // Render JSX element.
            <h3>{label("Нова опция", "New option")}</h3>
            // Render JSX element.
            <label>
              // JSX expression container.
              {label("Категория", "Category")}
              // Render JSX element.
              <select
                // Assign value for subsequent use.
                value={optCategoryId}
                // Arrow function / callback body.
                onChange={(e) => setOptCategoryId(e.target.value)}
                // JSX boolean prop or identifier.
                required
              >
                // JSX expression container.
                {categories
                  // Arrow function / callback body.
                  .filter((c) => c.isActive)
                  // Arrow function / callback body.
                  .map((c) => (
                    // Render JSX element.
                    <option key={c.id} value={c.id}>
                      // JSX expression container.
                      {catName(c)}
                    // JSX element boundary.
                    </option>
                  ))}
              // JSX element boundary.
              </select>
            // JSX element boundary.
            </label>
            // Render JSX element.
            <label>
              // JSX expression container.
              {label("Вид", "Kind")}
              // Render JSX element.
              <select
                // Assign value for subsequent use.
                value={optKind}
                // Arrow function / callback body.
                onChange={(e) =>
                  // Invoke helper or pass arguments.
                  setOptKind(e.target.value as "maintenance" | "housekeeping")
                }
              >
                // Render JSX element.
                <option value="maintenance">
                  // JSX expression container.
                  {KIND_LABELS.maintenance[locale]}
                // JSX element boundary.
                </option>
                // Render JSX element.
                <option value="housekeeping">
                  // JSX expression container.
                  {KIND_LABELS.housekeeping[locale]}
                // JSX element boundary.
                </option>
              // JSX element boundary.
              </select>
            // JSX element boundary.
            </label>
            // Render JSX element.
            <label>
              // JSX expression container.
              {label("Име BG", "Name BG")}
              // Render JSX element.
              <input
                // Assign value for subsequent use.
                value={optNameBg}
                // Arrow function / callback body.
                onChange={(e) => setOptNameBg(e.target.value)}
                // JSX boolean prop or identifier.
                required
              />
            // JSX element boundary.
            </label>
            // Render JSX element.
            <label>
              // JSX expression container.
              {label("Име EN", "Name EN")}
              // Render JSX element.
              <input
                // Assign value for subsequent use.
                value={optNameEn}
                // Arrow function / callback body.
                onChange={(e) => setOptNameEn(e.target.value)}
                // JSX boolean prop or identifier.
                required
              />
            // JSX element boundary.
            </label>
            // Render JSX element.
            <label>
              // JSX expression container.
              {label("Приоритет по подразб.", "Default priority")}
              // Render JSX element.
              <select
                // Assign value for subsequent use.
                value={optDefaultPriority}
                // Arrow function / callback body.
                onChange={(e) => setOptDefaultPriority(e.target.value)}
              >
                // Render JSX element.
                <option value="">—</option>
                // Render JSX element.
                <option value="low">low</option>
                // Render JSX element.
                <option value="normal">normal</option>
                // Render JSX element.
                <option value="high">high</option>
                // Render JSX element.
                <option value="urgent">urgent</option>
              // JSX element boundary.
              </select>
            // JSX element boundary.
            </label>
            // Render JSX element.
            <label>
              // JSX expression container.
              {label("Блокира по подразб.", "Default blocks room")}
              // Render JSX element.
              <select
                // Assign value for subsequent use.
                value={
                  // Assign value for subsequent use.
                  optDefaultBlocks === "" ? "" : optDefaultBlocks ? "1" : "0"
                }
                // Arrow function / callback body.
                onChange={(e) => {
                  // Local constant binding.
                  const v = e.target.value;
                  // Assign value for subsequent use.
                  setOptDefaultBlocks(v === "" ? "" : v === "1");
                }}
              >
                // Render JSX element.
                <option value="">—</option>
                // Render JSX element.
                <option value="1">{label("Да", "Yes")}</option>
                // Render JSX element.
                <option value="0">{label("Не", "No")}</option>
              // JSX element boundary.
              </select>
            // JSX element boundary.
            </label>
            // Render JSX element.
            <button type="submit" disabled={busy}>
              // JSX expression container.
              {label("Добави", "Add")}
            // JSX element boundary.
            </button>
          // JSX element boundary.
          </form>
          // Render JSX element.
          <p className="muted issue-catalog-hint">
            // JSX expression container.
            {label(
              // Continue multi-line list/arguments.
              "Влачете редовете за пренареждане. ↑/↓ са за клавиатура.",
              // Continue multi-line list/arguments.
              "Drag rows to reorder. ↑/↓ buttons are for keyboard.",
            )}
          // JSX element boundary.
          </p>
          // Render JSX element.
          <table className="data-table issue-options-table">
            // Render JSX element.
            <thead>
              // Render JSX element.
              <tr>
                // Render JSX element.
                <th>{label("Подредба", "Order")}</th>
                // Render JSX element.
                <th>{label("Наименование", "Name")}</th>
                // Render JSX element.
                <th>{label("Вид", "Kind")}</th>
                // Render JSX element.
                <th>{label("Категория", "Category")}</th>
                // Render JSX element.
                <th>{label("Активна", "Active")}</th>
                // Render JSX element.
                <th>{label("Действия", "Actions")}</th>
              // JSX element boundary.
              </tr>
            // JSX element boundary.
            </thead>
            // Render JSX element.
            <tbody>
              // JSX expression container.
              {options.map((o, idx) => {
                // Local constant binding.
                const cat =
                  // Continue module logic.
                  o.maintenanceCategory ??
                  // Arrow function / callback body.
                  categories.find((c) => c.id === o.maintenanceCategoryId);
                // Local constant binding.
                const rowClass = [
                  // Continue multi-line list/arguments.
                  "issue-option-row",
                  // Assign value for subsequent use.
                  dragId === o.id ? "dragging" : "",
                  // Assign value for subsequent use.
                  dropTargetId === o.id && dragId !== o.id ? "drop-target" : "",
                ]
                  // Invoke helper or pass arguments.
                  .filter(Boolean)
                  // Invoke helper or pass arguments.
                  .join(" ");
                // Return computed result to caller.
                return (
                  // Render JSX element.
                  <tr
                    // Assign value for subsequent use.
                    key={o.id}
                    // Assign value for subsequent use.
                    className={rowClass}
                    // Assign value for subsequent use.
                    draggable={!busy}
                    // Arrow function / callback body.
                    onDragStart={(e) => onDragStart(e, o.id)}
                    // Arrow function / callback body.
                    onDragOver={(e) => onDragOver(e, o.id)}
                    // Arrow function / callback body.
                    onDragLeave={() => onDragLeave(o.id)}
                    // Arrow function / callback body.
                    onDrop={(e) => void onDrop(e, o.id)}
                    // Assign value for subsequent use.
                    onDragEnd={onDragEnd}
                  >
                    // Render JSX element.
                    <td>
                      // Render JSX element.
                      <span
                        // Assign value for subsequent use.
                        className="drag-handle"
                        // Assign value for subsequent use.
                        title={label("Влачи", "Drag")}
                        // Continue module logic.
                        aria-hidden
                      >
                        // Continue module logic.
                        ⋮⋮
                      // JSX element boundary.
                      </span>
                      // Render JSX element.
                      <button
                        // Assign value for subsequent use.
                        type="button"
                        // Assign value for subsequent use.
                        className="subtle"
                        // Assign value for subsequent use.
                        disabled={busy || idx === 0}
                        // Arrow function / callback body.
                        onClick={() => void moveOption(o.id, -1)}
                        // Assign value for subsequent use.
                        aria-label={label("Нагоре", "Move up")}
                      >
                        // Continue module logic.
                        ↑
                      // JSX element boundary.
                      </button>
                      // Render JSX element.
                      <button
                        // Assign value for subsequent use.
                        type="button"
                        // Assign value for subsequent use.
                        className="subtle"
                        // Assign value for subsequent use.
                        disabled={busy || idx === options.length - 1}
                        // Arrow function / callback body.
                        onClick={() => void moveOption(o.id, 1)}
                        // Assign value for subsequent use.
                        aria-label={label("Надолу", "Move down")}
                      >
                        // Continue module logic.
                        ↓
                      // JSX element boundary.
                      </button>
                    // JSX element boundary.
                    </td>
                    // Render JSX element.
                    <td>{locale === "bg" ? o.nameBg : o.nameEn}</td>
                    // Render JSX element.
                    <td>{KIND_LABELS[o.kind]?.[locale] ?? o.kind}</td>
                    // Render JSX element.
                    <td>{cat ? catName(cat) : "—"}</td>
                    // Render JSX element.
                    <td>{o.isActive ? "✓" : "—"}</td>
                    // Render JSX element.
                    <td>
                      // JSX expression container.
                      {o.isActive ? (
                        // Render JSX element.
                        <button
                          // Assign value for subsequent use.
                          type="button"
                          // Assign value for subsequent use.
                          className="subtle"
                          // Assign value for subsequent use.
                          disabled={busy}
                          // Arrow function / callback body.
                          onClick={() =>
                            // Arrow function / callback body.
                            run(async () => {
                              // Await async work before continuing.
                              await archiveIssueOption(o.id);
                            })
                          }
                        >
                          // JSX expression container.
                          {label("Архивирай", "Archive")}
                        // JSX element boundary.
                        </button>
                      // Invoke helper or pass arguments.
                      ) : (
                        // Render JSX element.
                        <button
                          // Assign value for subsequent use.
                          type="button"
                          // Assign value for subsequent use.
                          className="subtle"
                          // Assign value for subsequent use.
                          disabled={busy}
                          // Arrow function / callback body.
                          onClick={() =>
                            // Arrow function / callback body.
                            run(async () => {
                              // Await async work before continuing.
                              await updateIssueOption(o.id, { isActive: true });
                            })
                          }
                        >
                          // JSX expression container.
                          {label("Активирай", "Activate")}
                        // JSX element boundary.
                        </button>
                      )}
                    // JSX element boundary.
                    </td>
                  // JSX element boundary.
                  </tr>
                );
              })}
            // JSX element boundary.
            </tbody>
          // JSX element boundary.
          </table>
        // Continue module logic.
        </>
      )}
    // JSX element boundary.
    </div>
  );
}
