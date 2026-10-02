import {
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  archiveIssueOption,
  archiveMaintenanceCategory,
  createIssueOption,
  createMaintenanceCategory,
  fetchIssueOptions,
  fetchMaintenanceCategories,
  reorderIssueOptions,
  updateIssueOption,
  updateMaintenanceCategory,
  type IssueOptionRow,
  type MaintenanceCategoryRow,
} from "../api/client";

type Props = {
  locale: "bg" | "en";
};

const KIND_LABELS: Record<string, { bg: string; en: string }> = {
  maintenance: { bg: "Поддръжка", en: "Maintenance" },
  housekeeping: { bg: "Камериерска", en: "Housekeeping" },
};

export function IssueCatalogPanel({ locale }: Props) {
  const label = (bg: string, en: string) => (locale === "bg" ? bg : en);
  const [subTab, setSubTab] = useState<"options" | "categories">("options");
  const [categories, setCategories] = useState<MaintenanceCategoryRow[]>([]);
  const [options, setOptions] = useState<IssueOptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);

  const [catKey, setCatKey] = useState("");
  const [catNameBg, setCatNameBg] = useState("");
  const [catNameEn, setCatNameEn] = useState("");

  const [optCategoryId, setOptCategoryId] = useState("");
  const [optKind, setOptKind] = useState<"maintenance" | "housekeeping">(
    "maintenance",
  );
  const [optNameBg, setOptNameBg] = useState("");
  const [optNameEn, setOptNameEn] = useState("");
  const [optDefaultPriority, setOptDefaultPriority] = useState("");
  const [optDefaultBlocks, setOptDefaultBlocks] = useState<boolean | "">("");

  const refresh = useCallback(async () => {
    const [cats, opts] = await Promise.all([
      fetchMaintenanceCategories({ includeInactive: true }),
      fetchIssueOptions({ includeInactive: true }),
    ]);
    setCategories(cats);
    setOptions(opts);
    if (!optCategoryId && cats[0]) setOptCategoryId(cats[0].id);
  }, [optCategoryId]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      await refresh();
      setMessage(label("Запазено", "Saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAddCategory(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await createMaintenanceCategory({
        key: catKey,
        nameBg: catNameBg,
        nameEn: catNameEn,
      });
      setCatKey("");
      setCatNameBg("");
      setCatNameEn("");
    });
  }

  async function onAddOption(e: FormEvent) {
    e.preventDefault();
    if (!optCategoryId) return;
    await run(async () => {
      await createIssueOption({
        maintenanceCategoryId: optCategoryId,
        kind: optKind,
        nameBg: optNameBg,
        nameEn: optNameEn,
        defaultPriority: optDefaultPriority || undefined,
        defaultBlocksRoom:
          optDefaultBlocks === "" ? undefined : optDefaultBlocks,
      });
      setOptNameBg("");
      setOptNameEn("");
      setOptDefaultPriority("");
      setOptDefaultBlocks("");
    });
  }

  async function persistOrder(ids: string[]) {
    const previous = options;
    setOptions(
      ids
        .map((id) => previous.find((o) => o.id === id))
        .filter((o): o is IssueOptionRow => Boolean(o)),
    );
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await reorderIssueOptions(ids);
      setOptions(next);
      setMessage(label("Запазено", "Saved"));
    } catch (err) {
      setOptions(previous);
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function moveOption(id: string, dir: -1 | 1) {
    const idx = options.findIndex((o) => o.id === id);
    if (idx < 0) return;
    const next = idx + dir;
    if (next < 0 || next >= options.length) return;
    const ids = options.map((o) => o.id);
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    await persistOrder(ids);
  }

  function onDragStart(e: DragEvent, id: string) {
    if (busy) {
      e.preventDefault();
      return;
    }
    dragIdRef.current = id;
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }

  function onDragOver(e: DragEvent, id: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTargetId !== id) setDropTargetId(id);
  }

  function onDragLeave(id: string) {
    if (dropTargetId === id) setDropTargetId(null);
  }

  async function onDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    const sourceId = dragIdRef.current ?? e.dataTransfer.getData("text/plain");
    setDragId(null);
    setDropTargetId(null);
    dragIdRef.current = null;
    if (!sourceId || sourceId === targetId || busy) return;
    const from = options.findIndex((o) => o.id === sourceId);
    const to = options.findIndex((o) => o.id === targetId);
    if (from < 0 || to < 0) return;
    const ids = options.map((o) => o.id);
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);
    await persistOrder(ids);
  }

  function onDragEnd() {
    setDragId(null);
    setDropTargetId(null);
    dragIdRef.current = null;
  }

  const catName = (c: MaintenanceCategoryRow) =>
    locale === "bg" ? c.nameBg : c.nameEn;

  if (loading) {
    return <p className="muted">{label("Зареждане…", "Loading…")}</p>;
  }

  return (
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
        <>
          <form className="stack-form" onSubmit={onAddCategory}>
            <h3>{label("Нова категория", "New category")}</h3>
            <label>
              key
              <input
                value={catKey}
                onChange={(e) => setCatKey(e.target.value)}
                required
                placeholder="plumbing"
              />
            </label>
            <label>
              {label("Име BG", "Name BG")}
              <input
                value={catNameBg}
                onChange={(e) => setCatNameBg(e.target.value)}
                required
              />
            </label>
            <label>
              {label("Име EN", "Name EN")}
              <input
                value={catNameEn}
                onChange={(e) => setCatNameEn(e.target.value)}
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
                <tr key={c.id}>
                  <td>{c.key}</td>
                  <td>{catName(c)}</td>
                  <td>{c.isActive ? "✓" : "—"}</td>
                  <td>
                    {c.isActive ? (
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
                    ) : (
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
        <>
          <form className="stack-form" onSubmit={onAddOption}>
            <h3>{label("Нова опция", "New option")}</h3>
            <label>
              {label("Категория", "Category")}
              <select
                value={optCategoryId}
                onChange={(e) => setOptCategoryId(e.target.value)}
                required
              >
                {categories
                  .filter((c) => c.isActive)
                  .map((c) => (
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
                required
              />
            </label>
            <label>
              {label("Име EN", "Name EN")}
              <input
                value={optNameEn}
                onChange={(e) => setOptNameEn(e.target.value)}
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
                  o.maintenanceCategory ??
                  categories.find((c) => c.id === o.maintenanceCategoryId);
                const rowClass = [
                  "issue-option-row",
                  dragId === o.id ? "dragging" : "",
                  dropTargetId === o.id && dragId !== o.id ? "drop-target" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
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
                      ) : (
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
