import { useCallback, useEffect, useMemo, useState } from "react";
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

type Props = { user: AuthUser };

type Tab = "issue" | "staff";
type Step = 1 | 2 | 3;

const CARD_TYPES: Array<{ id: CardType; bg: string; en: string }> = [
  { id: "guest", bg: "Гост", en: "Guest" },
  { id: "housekeeper", bg: "Камериерка", en: "Housekeeper" },
  { id: "maintenance", bg: "Поддръжка", en: "Maintenance" },
  { id: "manager", bg: "Мениджър", en: "Manager" },
  { id: "master", bg: "Мастър", en: "Master" },
];

function labelForType(type: CardType) {
  return CARD_TYPES.find((t) => t.id === type)?.bg ?? type;
}

function defaultValidity() {
  const from = new Date();
  const until = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return {
    validFrom: from.toISOString().slice(0, 16),
    validUntil: until.toISOString().slice(0, 16),
  };
}

function toIsoLocal(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("Невалидна дата");
  return d.toISOString();
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString("bg-BG");
  } catch {
    return iso;
  }
}

export function CardsPage({ user }: Props) {
  const [tab, setTab] = useState<Tab>("issue");
  const [step, setStep] = useState<Step>(1);
  const [cardType, setCardType] = useState<CardType | null>(null);
  const [locationId, setLocationId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [label, setLabel] = useState("");
  const [validity, setValidity] = useState(defaultValidity);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [employees, setEmployees] = useState<CardEmployeeOption[]>([]);
  const [staffCards, setStaffCards] = useState<AccessCard[]>([]);
  const [staffQ, setStaffQ] = useState("");
  const [staffStatus, setStaffStatus] = useState<"" | CardStatus>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [issued, setIssued] = useState<AccessCard | null>(null);

  const canIssue = canPerformAction(user, "cards.issue");
  const canRevoke = canPerformAction(user, "cards.revoke");
  const isGuest = cardType === "guest";
  const isMaster = cardType === "master";
  const isStaff = !!cardType && cardType !== "guest";

  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === locationId) ?? null,
    [rooms, locationId],
  );
  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employeeId) ?? null,
    [employees, employeeId],
  );

  const loadIssueLookups = useCallback(async () => {
    const [roomList, empList] = await Promise.all([
      fetchRooms(),
      canIssue ? fetchCardEmployees() : Promise.resolve([]),
    ]);
    setRooms(roomList.filter((r) => r.catalogStatus === "active"));
    setEmployees(empList);
  }, [canIssue]);

  const loadStaffCards = useCallback(async () => {
    const cards = await fetchCards({
      staffOnly: true,
      q: staffQ.trim() || undefined,
      status: staffStatus || undefined,
    });
    setStaffCards(cards);
  }, [staffQ, staffStatus]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await loadIssueLookups();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Грешка при зареждане");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadIssueLookups]);

  useEffect(() => {
    if (tab !== "staff") return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await loadStaffCards();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Грешка при зареждане");
      } finally {
        setLoading(false);
      }
    })();
  }, [tab, loadStaffCards]);

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

  function validateStep2() {
    if (!cardType) return "Изберете тип карта";
    if (isGuest && !locationId) return "Изберете стая";
    if (isStaff && !employeeId) return "Изберете служител";
    if (isMaster && locationId) return "Мастър картата е за целия имот";
    try {
      const from = new Date(toIsoLocal(validity.validFrom));
      const until = new Date(toIsoLocal(validity.validUntil));
      if (!(until > from)) return "Краят трябва да е след началото";
    } catch {
      return "Невалиден срок";
    }
    return null;
  }

  async function submitIssue() {
    if (!cardType || !canIssue) return;
    const problem = validateStep2();
    if (problem) {
      setError(problem);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const card = await issueCard({
        cardType,
        employeeId: isGuest ? null : employeeId,
        locationId: isGuest || (!isMaster && locationId) ? locationId || null : null,
        validFrom: toIsoLocal(validity.validFrom),
        validUntil: toIsoLocal(validity.validUntil),
        label: label.trim() || null,
      });
      setIssued(card);
      setMessage("Записано в системата");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неуспешно издаване");
    } finally {
      setLoading(false);
    }
  }

  async function onRevoke(id: string) {
    if (!canRevoke) return;
    try {
      setLoading(true);
      setError(null);
      await revokeCard(id);
      await loadStaffCards();
      setMessage("Картата е отменена в системата");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неуспешна отмяна");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Карти</h1>
          <p>Издаване на физически достъп — запис само в системата</p>
        </div>
      </header>

      <div className="toolbar">
        <button
          type="button"
          className={tab === "issue" ? "active" : "ghost"}
          onClick={() => setTab("issue")}
        >
          Издаване
        </button>
        <button
          type="button"
          className={tab === "staff" ? "active" : "ghost"}
          onClick={() => setTab("staff")}
        >
          Карти на служители
        </button>
      </div>

      {error && <p className="error-banner">{error}</p>}
      {message && <p className="ok-banner">{message}</p>}

      {tab === "issue" && (
        <section className="cards-wizard">
          <div className="wizard-steps">
            <span className={step === 1 ? "wizard-step active" : "wizard-step"}>
              1. Тип карта
            </span>
            <span className={step === 2 ? "wizard-step active" : "wizard-step"}>
              2. Данни за достъп
            </span>
            <span className={step === 3 ? "wizard-step active" : "wizard-step"}>
              3. Запис
            </span>
          </div>

          {step === 1 && (
            <div className="wizard-panel">
              <h2>Тип карта</h2>
              <div className="card-type-grid">
                {CARD_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={
                      cardType === t.id ? "card-type-btn active" : "card-type-btn"
                    }
                    onClick={() => {
                      setCardType(t.id);
                      setLocationId("");
                      setEmployeeId("");
                    }}
                  >
                    {t.bg}
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

          {step === 2 && cardType && (
            <div className="wizard-panel">
              <h2>Данни за достъп — {labelForType(cardType)}</h2>
              <div className="form-grid">
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

                {isMaster && (
                  <p className="muted">
                    Мастър картата е с обхват целия имот (без конкретна стая).
                  </p>
                )}

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

          {step === 3 && cardType && (
            <div className="wizard-panel">
              <h2>Запис</h2>
              {!issued ? (
                <>
                  <dl className="review-list">
                    <div>
                      <dt>Тип</dt>
                      <dd>{labelForType(cardType)}</dd>
                    </div>
                    {selectedEmployee && (
                      <div>
                        <dt>Служител</dt>
                        <dd>
                          {selectedEmployee.fullName} (
                          {selectedEmployee.employeeNumber})
                        </dd>
                      </div>
                    )}
                    {selectedRoom && (
                      <div>
                        <dt>Стая</dt>
                        <dd>
                          {selectedRoom.buildingCode} · {selectedRoom.number}
                        </dd>
                      </div>
                    )}
                    {isMaster && (
                      <div>
                        <dt>Обхват</dt>
                        <dd>Целият имот</dd>
                      </div>
                    )}
                    <div>
                      <dt>Срок</dt>
                      <dd>
                        {formatWhen(toIsoLocal(validity.validFrom))} —{" "}
                        {formatWhen(toIsoLocal(validity.validUntil))}
                      </dd>
                    </div>
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
                    Карта {labelForType(issued.cardType)} · статус {issued.status}
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
                    const grant = card.grants[0];
                    return (
                      <tr key={card.id}>
                        <td>
                          {card.employee
                            ? `${card.employee.fullName} (${card.employee.employeeNumber})`
                            : "—"}
                        </td>
                        <td>{labelForType(card.cardType)}</td>
                        <td>
                          {grant
                            ? `${formatWhen(grant.validFrom)} — ${formatWhen(grant.validUntil)}`
                            : "—"}
                        </td>
                        <td>{card.status === "active" ? "активна" : "отменена"}</td>
                        <td>
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
