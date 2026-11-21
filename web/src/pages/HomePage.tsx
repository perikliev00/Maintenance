/**
 * Reception-style home: open tickets list + quick issue report form.
 * Live-refreshes on ticket/location/cleaning events; resolve actions gated by role.
 */
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canPerformAction,
  fetchIssueOptions,
  fetchMaintenanceCategories,
  fetchRooms,
  fetchTickets,
  parseDuplicateReportError,
  reportIssue,
  type AuthUser,
  type IssueOptionRow,
  type MaintenanceCategoryRow,
  type MaintenanceTicket,
  type Room,
} from "../api/client";
import { IssueReportForm } from "../components/IssueReportForm";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { TicketLifecycleActions } from "../components/TicketLifecycleActions";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { formatWhen, t } from "../i18n";
import { executeMutationWithRefresh } from "../saveRefresh";
import { priorityLabel, statusLabel } from "./ticketLabels";

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
};

function formatDue(iso: string, locale: "bg" | "en"): string {
  return new Date(iso).toLocaleString(locale === "en" ? "en-GB" : "bg-BG", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Prefer bilingual category label; fall back to legacy key fields. */
function ticketCategoryLabel(
  ticket: MaintenanceTicket,
  locale: "bg" | "en",
): string {
  if (locale === "en") {
    return ticket.categoryLabelEn ?? ticket.category ?? ticket.categoryKey ?? "—";
  }
  return ticket.categoryLabelBg ?? ticket.category ?? ticket.categoryKey ?? "—";
}

/**
 * Reception home: open tickets + quick report form.
 * Seeds room/category/option selects on first successful refresh.
 */
export function HomePage({ user, locale: localeProp }: Props) {
  const locale = localeProp ?? "bg";
  const [reportOpen, setReportOpen] = useState(false);
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [categories, setCategories] = useState<MaintenanceCategoryRow[]>([]);
  const [issueOptions, setIssueOptions] = useState<IssueOptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitInFlight = useRef(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState("");
  const [pickMode, setPickMode] = useState<"option" | "custom">("option");
  const [issueOptionId, setIssueOptionId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  /** Canonical title (option name or custom problem title). */
  const [title, setTitle] = useState("");
  /** Optional clarification — stored separately from title. */
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [blocksRoom, setBlocksRoom] = useState(false);
  const [catalogDefaultPriority, setCatalogDefaultPriority] = useState<
    string | null
  >(null);
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    code: "duplicate_active" | "probable_duplicate";
    message: string;
    existingId: string | null;
    matchReason: string | null;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const canResolve = canPerformAction(user, "tickets.resolve");
  const canReport = canPerformAction(user, "tickets.report");

  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === locationId),
    [rooms, locationId],
  );

  const priorityUnusual =
    catalogDefaultPriority != null &&
    priority !== catalogDefaultPriority &&
    pickMode === "option";

  const applyOption = useCallback((opt: IssueOptionRow) => {
    setIssueOptionId(opt.id);
    setTitle(opt.nameBg);
    setDescription("");
    setCatalogDefaultPriority(opt.defaultPriority);
    if (opt.defaultPriority) setPriority(opt.defaultPriority);
    if (opt.defaultBlocksRoom !== null && opt.defaultBlocksRoom !== undefined) {
      setBlocksRoom(opt.defaultBlocksRoom);
    } else {
      setBlocksRoom(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const [ticketData, roomData, catData, optData] = await Promise.all([
      fetchTickets({ limit: 20, status: "open" }),
      fetchRooms(),
      fetchMaintenanceCategories(),
      fetchIssueOptions(),
    ]);
    setTickets(ticketData);
    setRooms(roomData);
    setCategories(catData);
    setIssueOptions(optData);
    if (!locationId && roomData[0]) {
      setLocationId(roomData[0].id);
    }
    if (!categoryId && catData[0]) {
      setCategoryId(catData[0].id);
    }
    if (!issueOptionId && optData[0]) {
      applyOption(optData[0]);
    }
  }, [locationId, categoryId, issueOptionId, applyOption]);

  const liveAt = useLiveRefresh(refresh, {
    enabled: !loading,
    busy: submitting || resolvingId !== null,
    eventTypes: ["ticket.changed", "location.changed", "cleaning.changed"],
  });

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await refresh();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t(locale, "Неуспешно зареждане", "Failed to load home"),
        );
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function confirmBlocksRoomChange(next: boolean): boolean {
    if (!next) return true;
    return window.confirm(
      t(
        locale,
        "Стаята ще остане „не готова“ за настаняване, докато този проблем е отворен. Потвърждавате ли?",
        "The room will stay not-ready for occupancy while this issue is open. Confirm?",
      ),
    );
  }

  async function submitReport(opts?: {
    allowDuplicate?: boolean;
    confirmSimilar?: boolean;
    duplicateOverrideReason?: string;
  }) {
    if (!locationId || !canReport || submitInFlight.current) return;
    if (pickMode === "custom" && !title.trim()) return;
    if (pickMode === "option" && !issueOptionId) return;

    if (blocksRoom && !opts?.allowDuplicate && !opts?.confirmSimilar) {
      // Already confirmed via checkbox change; no second prompt on submit.
    }

    submitInFlight.current = true;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    setRefreshWarning(null);
    try {
      const payload = {
        locationId,
        priority,
        blocksRoom,
        description: description.trim() || undefined,
        allowDuplicate: opts?.allowDuplicate,
        confirmSimilar: opts?.confirmSimilar,
        duplicateOverrideReason: opts?.duplicateOverrideReason,
        ...(pickMode === "option" && issueOptionId
          ? {
              issueOptionId,
              // Keep catalog title; clarification goes in description.
              title: undefined as string | undefined,
            }
          : {
              title: title.trim(),
              categoryId,
            }),
      };

      const result = await executeMutationWithRefresh(
        () => reportIssue(payload),
        refresh,
      );
      if (!result.ok) {
        const dup = parseDuplicateReportError(result.cause);
        if (dup) {
          setPendingDuplicate({
            code: dup.code,
            message: dup.message,
            existingId: dup.existingTicket?.id ?? null,
            matchReason: dup.matchReason,
          });
          setError(null);
        } else {
          setError(
            result.error ||
              t(locale, "Неуспешно докладване", "Failed to report issue"),
          );
        }
        return;
      }
      setDescription("");
      if (pickMode === "custom") setTitle("");
      setPendingDuplicate(null);
      setOverrideReason("");
      setMessage(t(locale, "Проблемът е добавен", "Issue reported"));
      if (result.outcome === "saved_refresh_failed") {
        setRefreshWarning(
          result.refreshError ??
            t(
              locale,
              "Запазено, но списъкът не се обнови",
              "Saved, but the list did not refresh",
            ),
        );
      }
    } finally {
      setSubmitting(false);
      submitInFlight.current = false;
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await submitReport();
  }

  return (
    <main className="content ui-home">
      <header className="page-header ui-briefing">
        <div>
          <p className="ui-eyebrow">{t(locale, "ОПЕРАТИВЕН ПРЕГЛЕД", "OPERATIONS BRIEFING")}</p>
          <h1>{t(locale, "Начало", "Home")}</h1>
          <p>{t(locale, "Ясни приоритети за всяко помещение.", "A clear next step for every space.")}</p>
        </div>
        {canReport && <button type="button" aria-expanded={reportOpen} aria-controls="home-report" onClick={() => setReportOpen((open) => !open)}>{t(locale, "Докладвай проблем", "Report issue")}</button>}
      </header>
      {error && <div className="error banner" role="alert">{error}</div>}
      {message && <div className="ok banner" role="status">{message}</div>}
      {refreshWarning && <div className="warn banner" role="status">{refreshWarning}</div>}
      {loading ? <LoadingIndicator label={t(locale, "Зареждане…", "Loading…")} /> : <>
        <section className="ui-metrics" aria-label={t(locale, "Последни отворени сигнали — до 20", "Recent open issue sample — up to 20")}>
          <div className="ui-metric"><span>{t(locale, "Заредени сигнали", "Loaded issues")}</span><strong>{tickets.length}</strong><small>{t(locale, "Последни отворени · до 20", "Recent open · up to 20")}</small></div>
          <div className="ui-metric"><span>{t(locale, "Блокират готовността", "Blocking readiness")}</span><strong>{tickets.filter((ticket) => ticket.blocksRoom).length}</strong><small>{t(locale, "Сред заредените сигнали", "Within loaded issues")}</small></div>
          <div className="ui-metric"><span>{t(locale, "Без изпълнител", "Awaiting assignment")}</span><strong>{tickets.filter((ticket) => !ticket.assignee).length}</strong><small>{t(locale, "Сред заредените сигнали", "Within loaded issues")}</small></div>
        </section>
<section className="ui-surface ui-report-composer" id="home-report" hidden={!reportOpen}>
            <div className="ui-action-strip"><div><p className="ui-eyebrow">{t(locale, "НОВ СИГНАЛ", "NEW REPORT")}</p><h2>{t(locale, "Добави проблем", "Report issue")}</h2></div><button type="button" className="ghost" onClick={() => setReportOpen(false)} disabled={submitting}>{t(locale, "Затвори", "Close")}</button></div>
            {!canReport ? (
              <p className="muted">
                {t(
                  locale,
                  "Нямате право да докладвате проблеми.",
                  "You do not have permission to report issues.",
                )}
              </p>
            ) : (
              <form className="report-form" onSubmit={handleSubmit}>
                <label>
                  {t(locale, "Стая", "Room")}
                  <select
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    required
                  >
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.buildingCode} {room.number} (
                        {t(locale, "ет.", "fl.")} {room.floor})
                      </option>
                    ))}
                  </select>
                </label>
                {selectedRoom && (
                  <p className="room-identity muted" aria-live="polite">
                    {t(locale, "Избрана локация", "Selected location")}:{" "}
                    <strong>
                      {selectedRoom.buildingCode} ·{" "}
                      {t(locale, "етаж", "floor")} {selectedRoom.floor} ·{" "}
                      {selectedRoom.number}
                    </strong>
                  </p>
                )}
                <IssueReportForm
                  locale={locale}
                  mode="option+custom"
                  pickMode={pickMode}
                  optionId={issueOptionId}
                  categoryId={categoryId}
                  title={title}
                  description={description}
                  showDescription
                  titleAsTextarea
                  blocksRoom={blocksRoom}
                  priority={priority}
                  options={issueOptions}
                  categories={categories}
                  labels={{
                    type: t(locale, "Тип сигнал", "Report type"),
                    title: t(locale, "Заглавие / проблем", "Title / problem"),
                    customOption: t(
                      locale,
                      "Друго (свободен текст)",
                      "Custom free text",
                    ),
                    blocksRoom: t(
                      locale,
                      "Блокира готовността на стаята",
                      "Blocks room readiness",
                    ),
                  }}
                  onPickModeChange={setPickMode}
                  onOptionIdChange={(_id, opt) => {
                    if (opt) applyOption(opt);
                  }}
                  onCategoryIdChange={setCategoryId}
                  onTitleChange={setTitle}
                  onDescriptionChange={setDescription}
                  onBlocksRoomChange={setBlocksRoom}
                  onPriorityChange={(p) => setPriority(p)}
                  confirmBlocksRoom={confirmBlocksRoomChange}
                  afterPriority={
                    priorityUnusual ? (
                      <p className="warn-inline" role="status">
                        {t(
                          locale,
                          `Необичаен приоритет за тази опция (каталог: ${catalogDefaultPriority}).`,
                          `Unusual priority for this option (catalog default: ${catalogDefaultPriority}).`,
                        )}
                      </p>
                    ) : null
                  }
                  afterBlocks={
                    blocksRoom ? (
                      <p className="warn-inline" role="status">
                        {t(
                          locale,
                          "Стаята няма да е готова за настаняване, докато проблемът е отворен.",
                          "The room will not be ready for occupancy while this issue is open.",
                        )}
                      </p>
                    ) : null
                  }
                />

                {pendingDuplicate && (
                  <div className="duplicate-warning" role="alert">
                    <p>
                      <strong>
                        {pendingDuplicate.code === "duplicate_active"
                          ? t(
                              locale,
                              "Вече има активен тикет",
                              "An active ticket already exists",
                            )
                          : t(
                              locale,
                              "Възможен свързан тикет",
                              "Possible related ticket",
                            )}
                      </strong>
                    </p>
                    <p className="muted">
                      {pendingDuplicate.matchReason ?? pendingDuplicate.message}
                    </p>
                    {pendingDuplicate.existingId && (
                      <p>
                        {t(locale, "Съществуващ тикет", "Existing ticket")}:{" "}
                        <code>{pendingDuplicate.existingId.slice(0, 10)}…</code>
                      </p>
                    )}
                    {pendingDuplicate.code === "probable_duplicate" && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() =>
                          void submitReport({ confirmSimilar: true })
                        }
                      >
                        {t(
                          locale,
                          "Потвърди — това е друг проблем",
                          "Confirm — this is a different issue",
                        )}
                      </button>
                    )}
                    {pendingDuplicate.code === "duplicate_active" && (
                      <>
                        <label>
                          {t(
                            locale,
                            "Причина за дублиране",
                            "Override reason",
                          )}
                          <input
                            value={overrideReason}
                            onChange={(e) => setOverrideReason(e.target.value)}
                            placeholder={t(
                              locale,
                              "Защо е отделен проблем?",
                              "Why is this a separate issue?",
                            )}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={submitting || !overrideReason.trim()}
                          onClick={() =>
                            void submitReport({
                              allowDuplicate: true,
                              duplicateOverrideReason: overrideReason.trim(),
                            })
                          }
                        >
                          {t(
                            locale,
                            "Създай въпреки дубликата",
                            "Create despite duplicate",
                          )}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setPendingDuplicate(null)}
                    >
                      {t(locale, "Отмени", "Dismiss")}
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    submitting ||
                    !locationId ||
                    (pickMode === "option" ? !issueOptionId : !title.trim())
                  }
                >
                  {submitting
                    ? t(locale, "Запис…", "Saving…")
                    : t(locale, "Добави проблем", "Add issue")}
                </button>
              </form>
            )}
          </section>
<section className="ui-surface">
            <div className="ui-section-heading ui-action-strip">
              <h2>{t(locale, "Последни проблеми", "Recent issues")}</h2>
              <button type="button" className="ghost" onClick={() => refresh()}>
                {t(locale, "Обнови", "Refresh")}
              </button>
              {liveAt && (
                <span className="muted live-stamp" title={liveAt}>
                  {t(locale, "на живо", "live")}
                </span>
              )}
            </div>
            {tickets.length === 0 ? (
              <p className="muted">
                {t(locale, "Няма отворени проблеми.", "No open issues.")}
              </p>
            ) : (
              <ul className="ui-queue">
                {tickets.map((ticket) => {
                  const overdue = ticket.slaBreached || (ticket.dueAt && new Date(ticket.dueAt).getTime() < Date.now());
                  return <li key={ticket.id} className={`ui-work-item priority-${ticket.priority}`}>
                    <div className="ui-work-item-location"><strong>{ticket.location.floor.building.code} {ticket.location.number}</strong><small>{t(locale, "Помещение", "Location")}</small></div>
                    <div className="ui-work-item-body">
                      <div className="ui-work-item-heading"><h3>{ticket.title}</h3><span className={`pill priority-${ticket.priority}`}>{priorityLabel(locale, ticket.priority)}</span><span className={`pill status-${ticket.status}`}>{statusLabel(locale, ticket.status)}</span>{ticket.blocksRoom && <span className="pill repairs-blocking">{t(locale, "блокира стая", "blocks room")}</span>}</div>
                      {ticket.description && <p className="muted">{ticket.description}</p>}
                      <div className="ui-work-item-meta muted">
                        <span>{ticket.reportedBy.fullName} ({ticket.reportedBy.employeeNumber})</span>
                        <span>{formatWhen(ticket.openedAt, locale)}</span>
                        <span>{ticketCategoryLabel(ticket, locale)}</span>
                        <span>{ticket.assignee ? `${t(locale, "Изпълнител", "Assignee")}: ${ticket.assignee.fullName}` : t(locale, "Без изпълнител", "Unassigned")}</span>
                        {ticket.dueAt && <span className={overdue ? "sla-overdue" : undefined} title={formatWhen(ticket.dueAt, locale)}>{t(locale, "Срок", "Due")}: {formatDue(ticket.dueAt, locale)}{overdue ? ` · ${t(locale, "просрочен", "overdue")}` : ""}</span>}
                      </div>
                    </div>
                    <div className="ui-work-item-actions"><TicketLifecycleActions ticket={ticket} busy={resolvingId === ticket.id} canResolve={canResolve} locale={locale} onBusy={setResolvingId} onDone={(result) => { setMessage(result.message); setError(null); void refresh(); }} onError={(msg) => setError(msg)} /></div>
                  </li>;
                })}
              </ul>
            )}
          </section>
      </>}
    </main>
  );
}
