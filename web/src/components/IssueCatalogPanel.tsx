/**
 * Admin catalog for maintenance categories and issue options.
 * Option reorder uses optimistic local order, then persists via `reorderIssueOptions`
 * (reverts on failure). Drag-and-drop and ↑/↓ share the same persist path.
 */
import {
  archiveIssueOption,
  archiveMaintenanceCategory,
  updateIssueOption,
  updateMaintenanceCategory,
} from "../api/client";
import { useIssueCatalog } from "../hooks/useIssueCatalog";
import { LoadingIndicator } from "./LoadingIndicator";

type Props = {
  locale: "bg" | "en";
};

const KIND_LABELS: Record<string, { bg: string; en: string }> = {
  maintenance: { bg: "Поддръжка", en: "Maintenance" },
  housekeeping: { bg: "Камериерска", en: "Housekeeping" },
};

/**
 * Admin catalog for maintenance categories and issue options.
 * Option reorder uses optimistic local order, then persists (reverts on failure).
 */
export function IssueCatalogPanel({ locale }: Props) {
  const {
    label,
    subTab,
    setSubTab,
    categories,
    options,
    loading,
    error,
    message,
    busy,
    dragId,
    dropTargetId,
    catKey,
    setCatKey,
    catNameBg,
    setCatNameBg,
    catNameEn,
    setCatNameEn,
    optCategoryId,
    setOptCategoryId,
    optKind,
    setOptKind,
    optNameBg,
    setOptNameBg,
    optNameEn,
    setOptNameEn,
    optDefaultPriority,
    setOptDefaultPriority,
    optDefaultBlocks,
    setOptDefaultBlocks,
    run,
    onAddCategory,
    onAddOption,
    moveOption,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
    catName,
  } = useIssueCatalog({ locale });

  if (loading) {
    return <LoadingIndicator label={label("Зареждане…", "Loading…")} />;
  }

  return (
    // Render JSX element.
    <div className="issue-catalog">
            <div className="settings-tabs" role="tablist">
                <button
          type="button"
          className={subTab === "options" ? "nav-tab active" : "nav-tab"}
          onClick={() => setSubTab("options")}
        >
                    {label("Опции", "Options")}
                </button>
                <button
          type="button"
          className={subTab === "categories" ? "nav-tab active" : "nav-tab"}
          onClick={() => setSubTab("categories")}
        >
                    {label("Категории", "Categories")}
                </button>
            </div>

            {error && <div className="error banner">{error}</div>}
            {message && <div className="ok banner">{message}</div>}

            {subTab === "categories" && (
        // Continue module logic.
        <>
                    <form className="stack-form" onSubmit={onAddCategory}>
                        <h3>{label("Нова категория", "New category")}</h3>
                        <label>
                            key
              <input
                value={catKey}
                onChange={(e) => setCatKey(e.target.value)}
                // JSX boolean prop or identifier.
                required
                placeholder="plumbing"
              />
                        </label>
                        <label>
                            {label("Име BG", "Name BG")}
                            <input
                value={catNameBg}
                onChange={(e) => setCatNameBg(e.target.value)}
                // JSX boolean prop or identifier.
                required
              />
                        </label>
                        <label>
                            {label("Име EN", "Name EN")}
                            <input
                value={catNameEn}
                onChange={(e) => setCatNameEn(e.target.value)}
                // JSX boolean prop or identifier.
                required
              />
                        </label>
                        <button type="submit" disabled={busy}>
                            {label("Добави", "Add")}
                        </button>
                    </form>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>key</th>
                                <th>{label("Име", "Name")}</th>
                                <th>{label("Активна", "Active")}</th>
                                <th>{label("Действия", "Actions")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {categories.map((c) => (
                // Render JSX element.
                <tr key={c.id}>
                                    <td>{c.key}</td>
                                    <td>{catName(c)}</td>
                                    <td>{c.isActive ? "✓" : "—"}</td>
                                    <td>
                                        {c.isActive ? (
                      // Render JSX element.
                      <button
                        type="button"
                        className="subtle"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await archiveMaintenanceCategory(c.id);
                          })
                        }
                      >
                                                {label("Архивирай", "Archive")}
                                            </button>
                    // Invoke helper or pass arguments.
                    ) : (
                      // Render JSX element.
                      <button
                        type="button"
                        className="subtle"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await updateMaintenanceCategory(c.id, {
                              isActive: true,
                            });
                          })
                        }
                      >
                                                {label("Активирай", "Activate")}
                                            </button>
                    )}
                                    </td>
                                </tr>
              ))}
                        </tbody>
                    </table>
                </>
      )}

            {subTab === "options" && (
        // Continue module logic.
        <>
                    <form className="stack-form" onSubmit={onAddOption}>
                        <h3>{label("Нова опция", "New option")}</h3>
                        <label>
                            {label("Категория", "Category")}
                            <select
                value={optCategoryId}
                onChange={(e) => setOptCategoryId(e.target.value)}
                // JSX boolean prop or identifier.
                required
              >
                                {categories
                  .filter((c) => c.isActive)
                  .map((c) => (
                    // Render JSX element.
                    <option key={c.id} value={c.id}>
                                            {catName(c)}
                                        </option>
                  ))}
                            </select>
                        </label>
                        <label>
                            {label("Вид", "Kind")}
                            <select
                value={optKind}
                onChange={(e) =>
                  setOptKind(e.target.value as "maintenance" | "housekeeping")
                }
              >
                                <option value="maintenance">
                                    {KIND_LABELS.maintenance[locale]}
                                </option>
                                <option value="housekeeping">
                                    {KIND_LABELS.housekeeping[locale]}
                                </option>
                            </select>
                        </label>
                        <label>
                            {label("Име BG", "Name BG")}
                            <input
                value={optNameBg}
                onChange={(e) => setOptNameBg(e.target.value)}
                // JSX boolean prop or identifier.
                required
              />
                        </label>
                        <label>
                            {label("Име EN", "Name EN")}
                            <input
                value={optNameEn}
                onChange={(e) => setOptNameEn(e.target.value)}
                // JSX boolean prop or identifier.
                required
              />
                        </label>
                        <label>
                            {label("Приоритет по подразб.", "Default priority")}
                            <select
                value={optDefaultPriority}
                onChange={(e) => setOptDefaultPriority(e.target.value)}
              >
                                <option value="">—</option>
                                <option value="low">low</option>
                                <option value="normal">normal</option>
                                <option value="high">high</option>
                                <option value="urgent">urgent</option>
                            </select>
                        </label>
                        <label>
                            {label("Блокира по подразб.", "Default blocks room")}
                            <select
                value={
                  optDefaultBlocks === "" ? "" : optDefaultBlocks ? "1" : "0"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setOptDefaultBlocks(v === "" ? "" : v === "1");
                }}
              >
                                <option value="">—</option>
                                <option value="1">{label("Да", "Yes")}</option>
                                <option value="0">{label("Не", "No")}</option>
                            </select>
                        </label>
                        <button type="submit" disabled={busy}>
                            {label("Добави", "Add")}
                        </button>
                    </form>
                    <p className="muted issue-catalog-hint">
                        {label(
              "Влачете редовете за пренареждане. ↑/↓ са за клавиатура.",
              "Drag rows to reorder. ↑/↓ buttons are for keyboard.",
            )}
                    </p>
                    <table className="data-table issue-options-table">
                        <thead>
                            <tr>
                                <th>{label("Подредба", "Order")}</th>
                                <th>{label("Наименование", "Name")}</th>
                                <th>{label("Вид", "Kind")}</th>
                                <th>{label("Категория", "Category")}</th>
                                <th>{label("Активна", "Active")}</th>
                                <th>{label("Действия", "Actions")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {options.map((o, idx) => {
                const cat =
                  // Continue module logic.
                  o.maintenanceCategory ??
                  categories.find((c) => c.id === o.maintenanceCategoryId);
                const rowClass = [
                  "issue-option-row",
                  dragId === o.id ? "dragging" : "",
                  dropTargetId === o.id && dragId !== o.id ? "drop-target" : "",
                ]
                  // Invoke helper or pass arguments.
                  .filter(Boolean)
                  // Invoke helper or pass arguments.
                  .join(" ");
                return (
                  // Render JSX element.
                  <tr
                    key={o.id}
                    className={rowClass}
                    draggable={!busy}
                    onDragStart={(e) => onDragStart(e, o.id)}
                    onDragOver={(e) => onDragOver(e, o.id)}
                    onDragLeave={() => onDragLeave(o.id)}
                    onDrop={(e) => void onDrop(e, o.id)}
                    onDragEnd={onDragEnd}
                  >
                                        <td>
                                            <span
                        className="drag-handle"
                        title={label("Влачи", "Drag")}
                        // Continue module logic.
                        aria-hidden
                      >
                                                ⋮⋮
                      </span>
                                            <button
                        type="button"
                        className="subtle"
                        disabled={busy || idx === 0}
                        onClick={() => void moveOption(o.id, -1)}
                        aria-label={label("Нагоре", "Move up")}
                      >
                                                ↑
                      </button>
                                            <button
                        type="button"
                        className="subtle"
                        disabled={busy || idx === options.length - 1}
                        onClick={() => void moveOption(o.id, 1)}
                        aria-label={label("Надолу", "Move down")}
                      >
                                                ↓
                      </button>
                                        </td>
                                        <td>{locale === "bg" ? o.nameBg : o.nameEn}</td>
                                        <td>{KIND_LABELS[o.kind]?.[locale] ?? o.kind}</td>
                                        <td>{cat ? catName(cat) : "—"}</td>
                                        <td>{o.isActive ? "✓" : "—"}</td>
                                        <td>
                                            {o.isActive ? (
                        // Render JSX element.
                        <button
                          type="button"
                          className="subtle"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await archiveIssueOption(o.id);
                            })
                          }
                        >
                                                    {label("Архивирай", "Archive")}
                                                </button>
                      // Invoke helper or pass arguments.
                      ) : (
                        // Render JSX element.
                        <button
                          type="button"
                          className="subtle"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await updateIssueOption(o.id, { isActive: true });
                            })
                          }
                        >
                                                    {label("Активирай", "Activate")}
                                                </button>
                      )}
                                        </td>
                                    </tr>
                );
              })}
                        </tbody>
                    </table>
                </>
      )}
        </div>
  );
}
