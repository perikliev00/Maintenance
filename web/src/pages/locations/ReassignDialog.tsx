/**
 * Room-specific housekeeper reassignment modal with live availability.
 * Portaled to document.body so position:fixed is always viewport-relative.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchAvailableHousekeepers,
  reassignCleaningTask,
  type AvailableHousekeeper,
  type HousekeeperAvailabilityStatus,
  type Room,
} from "../../api/client";
import { useModalLifecycle } from "../../hooks/useModalLifecycle";
import { t } from "../../i18n";

type Locale = "bg" | "en";

type Props = {
  location: Room;
  locale: Locale;
  canOverrideAvailability: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};

function statusLabel(
  locale: Locale,
  status: HousekeeperAvailabilityStatus,
): string {
  const map: Record<HousekeeperAvailabilityStatus, [string, string]> = {
    available: ["Свободна", "Available"],
    busy: ["Заета", "Busy"],
    on_break: ["В почивка", "On break"],
    off_shift: ["Извън смяна", "Off shift"],
    absent: ["Отсъства", "Absent"],
    unknown: ["Няма достатъчно данни", "Insufficient data"],
  };
  const [bg, en] = map[status];
  return t(locale, bg, en);
}

export function ReassignDialog({
  location,
  locale,
  canOverrideAvailability,
  onClose,
  onSuccess,
  onError,
}: Props) {
  const task = location.activeTask;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [housekeepers, setHousekeepers] = useState<AvailableHousekeeper[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [forceOverride, setForceOverride] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (task) return;
    onErrorRef.current(
      t(
        locale,
        "Няма активна задача за преназначаване.",
        "No active task to reassign.",
      ),
    );
    onCloseRef.current();
  }, [task, locale]);

  useModalLifecycle(onClose, { enabled: !!task });

  async function loadSuggestions() {
    if (!task) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchAvailableHousekeepers({
        locationId: location.id,
        taskId: task.id,
      });
      setHousekeepers(result.housekeepers);
      setCheckedAt(result.checkedAt);
      setSelectedId("");
      setForceOverride(false);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : t(locale, "Грешка при зареждане", "Failed to load"),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!task) return;
    void loadSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per open
  }, [location.id, task?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return housekeepers;
    return housekeepers.filter(
      (h) =>
        h.fullName.toLowerCase().includes(q) ||
        h.employeeNumber.toLowerCase().includes(q),
    );
  }, [housekeepers, search]);

  const selected = housekeepers.find((h) => h.employeeId === selectedId);
  const needsOverride =
    selected != null && selected.availabilityStatus !== "available";

  async function submit() {
    if (!task || !selectedId || !reason.trim()) return;
    if (needsOverride && !forceOverride) {
      onError(
        t(
          locale,
          "Избраният служител не е свободен. Потвърдете принудително преназначаване или изберете друг.",
          "Selected employee is not available. Confirm override or choose another.",
        ),
      );
      return;
    }
    if (needsOverride && !canOverrideAvailability) {
      onError(
        t(
          locale,
          "Нямате право за принудително преназначаване.",
          "You are not authorized to override availability.",
        ),
      );
      return;
    }

    setSubmitting(true);
    try {
      await reassignCleaningTask(
        task.id,
        selectedId,
        reason.trim(),
        task.version,
        selected?.currentShift?.id ?? undefined,
        needsOverride && forceOverride ? true : undefined,
      );
      onSuccess(
        t(
          locale,
          `Преназначена задача за ${location.number}`,
          `Reassigned task for ${location.number}`,
        ),
      );
      onClose();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t(locale, "Преназначаването неуспешно", "Reassignment failed");
      onError(message);
      if (/availability_conflict|not currently available|performing another/i.test(message)) {
        await loadSuggestions();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!task) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <form
        className="modal reassign-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h3>
          {t(
            locale,
            `Преназначаване на стая ${location.buildingCode} ${location.number}`,
            `Reassign room ${location.buildingCode} ${location.number}`,
          )}
        </h3>
        <p className="muted">
          {location.building} · {t(locale, "Етаж", "Floor")} {location.floor}
          {location.sector
            ? ` · ${t(locale, "Сектор", "Sector")} ${location.sector.code}`
            : ""}
        </p>
        <p>
          <strong>{t(locale, "Текущ изпълнител", "Current assignee")}:</strong>{" "}
          {task.assignee?.fullName ?? t(locale, "Неназначен", "Unassigned")}
        </p>
        <p className="muted">
          {t(locale, "Статус", "Status")}: {task.status} ·{" "}
          {t(locale, "Приоритет", "Priority")}: {task.priority}
        </p>

        <label>
          {t(locale, "Търсене", "Search")}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(
              locale,
              "Име или номер на служител",
              "Name or employee number",
            )}
          />
        </label>

        {loading ? (
          <p className="muted">{t(locale, "Зареждане…", "Loading…")}</p>
        ) : loadError ? (
          <p className="error">{loadError}</p>
        ) : filtered.length === 0 ? (
          <p className="muted">
            {t(
              locale,
              "Няма налични служители за преназначаване.",
              "No housekeepers available for reassignment.",
            )}
          </p>
        ) : (
          <ul className="reassign-hk-list">
            {filtered.map((hk) => {
              const selectable =
                hk.availabilityStatus === "available" ||
                (canOverrideAvailability && hk.availabilityStatus !== "busy");
              return (
                <li key={hk.employeeId}>
                  <label
                    className={`reassign-hk-option availability-${hk.availabilityStatus}${
                      !selectable ? " disabled" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="replacement"
                      value={hk.employeeId}
                      checked={selectedId === hk.employeeId}
                      disabled={!selectable || submitting}
                      onChange={() => setSelectedId(hk.employeeId)}
                    />
                    <span>
                      <strong>{hk.fullName}</strong> ({hk.employeeNumber}) —{" "}
                      {statusLabel(locale, hk.availabilityStatus)}
                      {" — "}
                      {hk.assignedTaskCount}{" "}
                      {t(locale, "задачи", "tasks")}
                      {hk.currentRunningTask
                        ? ` — ${t(locale, "Почиства", "Cleaning")} ${hk.currentRunningTask.locationNumber}`
                        : ""}
                      {hk.currentShift
                        ? ` · ${hk.currentShift.startTime}–${hk.currentShift.endTime}`
                        : ""}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {checkedAt && (
          <p className="muted small">
            {t(locale, "Проверено", "Verified")}:{" "}
            {new Date(checkedAt).toLocaleString()}
          </p>
        )}

        {needsOverride && canOverrideAvailability && (
          <label className="reassign-override">
            <input
              type="checkbox"
              checked={forceOverride}
              onChange={(e) => setForceOverride(e.target.checked)}
            />
            {t(
              locale,
              "Принудително преназначаване въпреки наличността (одитира се)",
              "Force reassignment despite availability (audited)",
            )}
          </label>
        )}

        <label>
          {t(locale, "Причина за преназначаване", "Reassignment reason")}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
            rows={3}
          />
        </label>

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={submitting}>
            {t(locale, "Отказ", "Cancel")}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => void loadSuggestions()}
            disabled={loading || submitting}
          >
            {t(locale, "Обнови списъка", "Refresh list")}
          </button>
          <button
            type="submit"
            disabled={
              submitting ||
              !selectedId ||
              reason.trim().length < 3 ||
              (needsOverride && !forceOverride)
            }
          >
            {t(locale, "Преназначи", "Reassign")}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
