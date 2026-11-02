/**
 * Access-card issue wizard and staff card list/revoke.
 * Issue and revoke are separately gated (`cards.issue` / `cards.revoke`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canPerformAction,
  fetchCardEmployees,
  fetchCards,
  fetchRooms,
  issueCard,
  revokeCard,
  type AccessCard,
  type AuthUser,
  type CardEmployeeOption,
  type CardStatus,
  type CardType,
  type Room,
} from "../api/client";
import { formatWhen, t } from "../i18n";

type Props = { user: AuthUser; locale?: "bg" | "en" };

type Tab = "issue" | "staff";
type Step = 1 | 2 | 3;

const CARD_TYPES: Array<{ id: CardType; bg: string; en: string }> = [
  { id: "guest", bg: "Гост", en: "Guest" },
  { id: "housekeeper", bg: "Камериерка", en: "Housekeeper" },
  { id: "maintenance", bg: "Поддръжка", en: "Maintenance" },
  { id: "manager", bg: "Мениджър", en: "Manager" },
  { id: "master", bg: "Мастър", en: "Master" },
];

/** Localized label for a card type id. */
function labelForType(locale: "bg" | "en", type: CardType) {
  const row = CARD_TYPES.find((ct) => ct.id === type);
  return row ? t(locale, row.bg, row.en) : type;
}

/** Default validity window: now → +24h, formatted for datetime-local inputs. */
function defaultValidity() {
  const from = new Date();
  const until = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return {
    // slice(0, 16) matches `<input type="datetime-local">` value shape.
    validFrom: from.toISOString().slice(0, 16),
    validUntil: until.toISOString().slice(0, 16),
  };
}

/** Parse a datetime-local string into an ISO timestamp for the API. */
function toIsoLocal(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("invalid_date");
  return d.toISOString();
}

/**
 * Access-card page: 3-step issue wizard and staff card list/revoke.
 * Issue and revoke are separately gated (`cards.issue` / `cards.revoke`).
 */
export function CardsPage({ user, locale: localeProp }: Props) {
  const locale = localeProp ?? "bg";
  const issueInFlight = useRef(false);
  // Issue wizard vs staff-list tab.
  const [tab, setTab] = useState<Tab>("issue");
  // Wizard step: 1 type → 2 fields → 3 review/success.
  const [step, setStep] = useState<Step>(1);
  const [cardType, setCardType] = useState<CardType | null>(null);
  // Guest room and/or staff employee selection for the grant.
  const [locationId, setLocationId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [label, setLabel] = useState("");
  const [validity, setValidity] = useState(defaultValidity);
  // Lookups for the issue wizard selects.
  const [rooms, setRooms] = useState<Room[]>([]);
  const [employees, setEmployees] = useState<CardEmployeeOption[]>([]);
  // Staff tab list + filters.
  const [staffCards, setStaffCards] = useState<AccessCard[]>([]);
  const [staffQ, setStaffQ] = useState("");
  const [staffStatus, setStaffStatus] = useState<"" | CardStatus>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Non-null after a successful issue (step 3 success branch).
  const [issued, setIssued] = useState<AccessCard | null>(null);

  // Permission gates — buttons stay visible but submit/revoke no-op without them.
  const canIssue = canPerformAction(user, "cards.issue");
  const canRevoke = canPerformAction(user, "cards.revoke");
  // Card-type branches drive which step-2 fields are required.
  const isGuest = cardType === "guest";
  const isMaster = cardType === "master";
  const isStaff = !!cardType && cardType !== "guest";

  // Resolve selected room/employee for the step-3 review list.
  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === locationId) ?? null,
    [rooms, locationId],
  );
  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employeeId) ?? null,
    [employees, employeeId],
  );

  /** Load active rooms + employee options for the issue wizard. */
  const loadIssueLookups = useCallback(async () => {
    // Skip employee fetch when the user cannot issue (no need for PII).
    const [roomList, empList] = await Promise.all([
      fetchRooms(),
      canIssue ? fetchCardEmployees() : Promise.resolve([]),
    ]);
    // Only active catalog rooms are selectable for new grants.
    setRooms(roomList.filter((r) => r.catalogStatus === "active"));
    setEmployees(empList);
  }, [canIssue]);

  /** Load staff-only cards filtered by search + status. */
  const loadStaffCards = useCallback(async () => {
    const cards = await fetchCards({
      staffOnly: true,
      q: staffQ.trim() || undefined,
      status: staffStatus || undefined,
    });
    setStaffCards(cards);
  }, [staffQ, staffStatus]);

  // Initial lookup load for the issue wizard.
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await loadIssueLookups();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t(locale, "Грешка при зареждане", "Failed to load"),
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [loadIssueLookups, locale]);

  // Staff list loads only when that tab is active (and on filter changes).
  useEffect(() => {
    if (tab !== "staff") return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await loadStaffCards();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t(locale, "Грешка при зареждане", "Failed to load"),
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [tab, loadStaffCards, locale]);

  /** Clear wizard state back to step 1 for another issue. */
  function resetWizard() {
    setStep(1);
    setCardType(null);
    setLocationId("");
    setEmployeeId("");
    setLabel("");
    setValidity(defaultValidity());
    setIssued(null);
    setMessage(null);
    setError(null);
  }

  /** Validate step-2 fields; returns a localized error string or null if OK. */
  function validateStep2() {
    if (!cardType) return t(locale, "Изберете тип карта", "Select a card type");
    // Guest cards require a room; staff cards require an employee.
    if (isGuest && !locationId) return t(locale, "Изберете стая", "Select a room");
    if (isStaff && !employeeId)
      return t(locale, "Изберете служител", "Select an employee");
    // Master is property-wide — a location id would be contradictory.
    if (isMaster && locationId)
      return t(
        locale,
        "Мастър картата е за целия имот",
        "Master card covers the whole property",
      );
    try {
      const from = new Date(toIsoLocal(validity.validFrom));
      const until = new Date(toIsoLocal(validity.validUntil));
      if (!(until > from))
        return t(
          locale,
          "Краят трябва да е след началото",
          "End must be after start",
        );
    } catch {
      return t(locale, "Невалиден срок", "Invalid validity window");
    }
    return null;
  }

  /** Persist a new card via API and advance to the success view. */
  async function submitIssue() {
    // Permission + type gate before any network call.
    if (!cardType || !canIssue || issueInFlight.current) return;
    const problem = validateStep2();
    if (problem) {
      setError(problem);
      return;
    }
    issueInFlight.current = true;
    try {
      setLoading(true);
      setError(null);
      // Guest: employee null + location required. Master: no location.
      const card = await issueCard({
        cardType,
        employeeId: isGuest ? null : employeeId,
        locationId: isGuest || (!isMaster && locationId) ? locationId || null : null,
        validFrom: toIsoLocal(validity.validFrom),
        validUntil: toIsoLocal(validity.validUntil),
        label: label.trim() || null,
      });
      setIssued(card);
      setMessage(t(locale, "Записано в системата", "Saved in the system"));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t(locale, "Неуспешно издаване", "Issue failed"),
      );
    } finally {
      setLoading(false);
      issueInFlight.current = false;
    }
  }

  /** Revoke an active staff card and refresh the list. */
  async function onRevoke(id: string) {
    if (!canRevoke) return;
    try {
      setLoading(true);
      setError(null);
      await revokeCard(id);
      await loadStaffCards();
      setMessage(
        t(locale, "Картата е отменена в системата", "Card revoked in the system"),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t(locale, "Неуспешна отмяна", "Revoke failed"),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>{t(locale, "Карти", "Cards")}</h1>
          <p>
            {t(
              locale,
              "Издаване на физически достъп — запис само в системата",
              "Issue physical access — system record only",
            )}
          </p>
        </div>
      </header>

      {/* Tab switcher: issue wizard vs staff card list. */}
      <div className="toolbar">
        <button
          type="button"
          className={tab === "issue" ? "active" : "ghost"}
          onClick={() => setTab("issue")}
        >
          {t(locale, "Издаване", "Issue")}
        </button>
        <button
          type="button"
          className={tab === "staff" ? "active" : "ghost"}
          onClick={() => setTab("staff")}
        >
          {t(locale, "Карти на служители", "Staff cards")}
        </button>
      </div>

      {/* Error / success banners shared across tabs. */}
      {error && <p className="error-banner">{error}</p>}
      {message && <p className="ok-banner">{message}</p>}

      {/* Issue wizard — three steps; step 3 shows review or success. */}
      {tab === "issue" && (
        <section className="cards-wizard">
          {/* Step indicator strip. */}
          <div className="wizard-steps">
            <span className={step === 1 ? "wizard-step active" : "wizard-step"}>
              1. {t(locale, "Тип карта", "Card type")}
            </span>
            <span className={step === 2 ? "wizard-step active" : "wizard-step"}>
              2. {t(locale, "Данни за достъп", "Access details")}
            </span>
            <span className={step === 3 ? "wizard-step active" : "wizard-step"}>
              3. {t(locale, "Запис", "Save")}
            </span>
          </div>

          {/* Step 1: pick card type (clears prior selections on change). */}
          {step === 1 && (
            <div className="wizard-panel">
              <h2>{t(locale, "Тип карта", "Card type")}</h2>
              <div className="card-type-grid">
                {CARD_TYPES.map((ct) => (
                  <button
                    key={ct.id}
                    type="button"
                    className={
                      cardType === ct.id ? "card-type-btn active" : "card-type-btn"
                    }
                    onClick={() => {
                      // Changing type clears prior room/employee selections.
                      setCardType(ct.id);
                      setLocationId("");
                      setEmployeeId("");
                    }}
                  >
                    {t(locale, ct.bg, ct.en)}
                  </button>
                ))}
              </div>
              <div className="wizard-actions">
                <button
                  type="button"
                  disabled={!cardType}
                  onClick={() => setStep(2)}
                >
                  Напред
                </button>
              </div>
            </div>
          )}

          {/* Step 2 fields depend on guest vs staff vs master. */}
          {step === 2 && cardType && (
            <div className="wizard-panel">
              <h2>
                {t(locale, "Данни за достъп", "Access details")} —{" "}
                {labelForType(locale, cardType)}
              </h2>
              <div className="form-grid">
                {/* Guest cards require a room grant. */}
                {isGuest && (
                  <label>
                    Стая
                    <select
                      value={locationId}
                      onChange={(e) => setLocationId(e.target.value)}
                    >
                      <option value="">Изберете стая…</option>
                      {rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.buildingCode} · {r.number} (ет. {r.floor})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {/* Staff cards require an employee assignee. */}
                {isStaff && (
                  <label>
                    Служител
                    <select
                      value={employeeId}
                      onChange={(e) => setEmployeeId(e.target.value)}
                    >
                      <option value="">Изберете служител…</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.fullName} ({e.employeeNumber})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {/* Optional room for non-master staff; master is property-wide. */}
                {isStaff && !isMaster && (
                  <label>
                    Локация (опционално)
                    <select
                      value={locationId}
                      onChange={(e) => setLocationId(e.target.value)}
                    >
                      <option value="">Без конкретна стая</option>
                      {rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.buildingCode} · {r.number}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {/* Master is property-wide — no room select. */}
                {isMaster && (
                  <p className="muted">
                    Мастър картата е с обхват целия имот (без конкретна стая).
                  </p>
                )}

                {/* Validity window for the access grant. */}
                <label>
                  Валидна от
                  <input
                    type="datetime-local"
                    value={validity.validFrom}
                    onChange={(e) =>
                      setValidity((v) => ({ ...v, validFrom: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Валидна до
                  <input
                    type="datetime-local"
                    value={validity.validUntil}
                    onChange={(e) =>
                      setValidity((v) => ({ ...v, validUntil: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Етикет (опционално)
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="напр. Гост Иванов"
                    maxLength={120}
                  />
                </label>
              </div>
              <div className="wizard-actions">
                <button type="button" className="ghost" onClick={() => setStep(1)}>
                  Назад
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Re-validate before leaving step 2.
                    const problem = validateStep2();
                    if (problem) {
                      setError(problem);
                      return;
                    }
                    setError(null);
                    setStep(3);
                  }}
                >
                  Напред
                </button>
              </div>
            </div>
          )}

          {/* Step 3: review summary or post-issue success. */}
          {step === 3 && cardType && (
            <div className="wizard-panel">
              <h2>Запис</h2>
              {/* Review form until issue succeeds; then show confirmation. */}
              {!issued ? (
                <>
                  <dl className="review-list">
                    <div>
                      <dt>Тип</dt>
                      <dd>{labelForType(locale, cardType)}</dd>
                    </div>
                    {/* Staff review row when an employee was selected. */}
                    {selectedEmployee && (
                      <div>
                        <dt>Служител</dt>
                        <dd>
                          {selectedEmployee.fullName} (
                          {selectedEmployee.employeeNumber})
                        </dd>
                      </div>
                    )}
                    {/* Room review row when a location was selected. */}
                    {selectedRoom && (
                      <div>
                        <dt>Стая</dt>
                        <dd>
                          {selectedRoom.buildingCode} · {selectedRoom.number}
                        </dd>
                      </div>
                    )}
                    {/* Master scope callout instead of a room. */}
                    {isMaster && (
                      <div>
                        <dt>Обхват</dt>
                        <dd>Целият имот</dd>
                      </div>
                    )}
                    <div>
                      <dt>Срок</dt>
                      <dd>
                        {formatWhen(toIsoLocal(validity.validFrom), locale)} —{" "}
                        {formatWhen(toIsoLocal(validity.validUntil), locale)}
                      </dd>
                    </div>
                    {/* Optional free-text label on the card record. */}
                    {label.trim() && (
                      <div>
                        <dt>Етикет</dt>
                        <dd>{label.trim()}</dd>
                      </div>
                    )}
                  </dl>
                  <p className="muted">
                    Ще се запише в базата. Физическото кодиране на карта не е
                    свързано.
                  </p>
                  <div className="wizard-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setStep(2)}
                      disabled={loading}
                    >
                      Назад
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitIssue()}
                      disabled={loading || !canIssue}
                    >
                      {loading ? "Запис…" : "Запиши в системата"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="ok-banner">Записано в системата</p>
                  <p className="muted">
                    {t(locale, "Карта", "Card")}{" "}
                    {labelForType(locale, issued.cardType)} ·{" "}
                    {t(locale, "статус", "status")} {issued.status}
                  </p>
                  <div className="wizard-actions">
                    <button type="button" onClick={resetWizard}>
                      Ново издаване
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* Staff cards list with search/status filters and revoke action. */}
      {tab === "staff" && (
        <section>
          <div className="toolbar">
            <label>
              Търсене
              <input
                value={staffQ}
                onChange={(e) => setStaffQ(e.target.value)}
                placeholder="Име или служебен номер…"
              />
            </label>
            <label>
              Статус
              <select
                value={staffStatus}
                onChange={(e) =>
                  setStaffStatus(e.target.value as "" | CardStatus)
                }
              >
                <option value="">Всички</option>
                <option value="active">Активни</option>
                <option value="revoked">Отменени</option>
              </select>
            </label>
          </div>

          {/* Loading vs empty vs staff card table. */}
          {loading && staffCards.length === 0 ? (
            <p className="muted">Зареждане…</p>
          ) : staffCards.length === 0 ? (
            <p className="muted">Няма служителски карти</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Служител</th>
                    <th>Тип</th>
                    <th>Валидност</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {staffCards.map((card) => {
                    // First grant drives the validity column display.
                    const grant = card.grants[0];
                    return (
                      <tr key={card.id}>
                        <td>
                          {card.employee
                            ? `${card.employee.fullName} (${card.employee.employeeNumber})`
                            : "—"}
                        </td>
                        <td>{labelForType(locale, card.cardType)}</td>
                        <td>
                          {grant
                            ? `${formatWhen(grant.validFrom, locale)} — ${formatWhen(grant.validUntil, locale)}`
                            : "—"}
                        </td>
                        <td>
                          {card.status === "active"
                            ? t(locale, "активна", "active")
                            : t(locale, "отменена", "revoked")}
                        </td>
                        <td>
                          {/* Revoke only for active cards when permitted. */}
                          {canRevoke && card.status === "active" ? (
                            <button
                              type="button"
                              className="ghost"
                              disabled={loading}
                              onClick={() => void onRevoke(card.id)}
                            >
                              Отмени
                            </button>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
