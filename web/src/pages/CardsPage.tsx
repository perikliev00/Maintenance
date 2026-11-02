/**
 * Access-card page shell: issue wizard + staff list/revoke.
 * Issue and revoke are separately gated (`cards.issue` / `cards.revoke`).
 */
import { useState } from "react";
import {
  canPerformAction,
  type AuthUser,
  type CardStatus,
} from "../api/client";
import { formatWhen, t } from "../i18n";
import { CARD_TYPES, labelForType, toIsoLocal } from "./cards/cardLabels";
import { useCardIssueWizard } from "./cards/useCardIssueWizard";
import { useStaffCards } from "./cards/useStaffCards";

type Props = { user: AuthUser; locale?: "bg" | "en" };
type Tab = "issue" | "staff";

export function CardsPage({ user, locale: localeProp }: Props) {
  const locale = localeProp ?? "bg";
  const [tab, setTab] = useState<Tab>("issue");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canIssue = canPerformAction(user, "cards.issue");
  const canRevoke = canPerformAction(user, "cards.revoke");

  const wizard = useCardIssueWizard({
    locale,
    canIssue,
    setError,
    setMessage,
  });

  const staff = useStaffCards({
    locale,
    canRevoke,
    active: tab === "staff",
    setError,
    setMessage,
  });

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

      {error && <p className="error-banner">{error}</p>}
      {message && <p className="ok-banner">{message}</p>}

      {tab === "issue" && (
        <section className="cards-wizard">
          <div className="wizard-steps">
            <span
              className={wizard.step === 1 ? "wizard-step active" : "wizard-step"}
            >
              1. {t(locale, "Тип карта", "Card type")}
            </span>
            <span
              className={wizard.step === 2 ? "wizard-step active" : "wizard-step"}
            >
              2. {t(locale, "Данни за достъп", "Access details")}
            </span>
            <span
              className={wizard.step === 3 ? "wizard-step active" : "wizard-step"}
            >
              3. {t(locale, "Запис", "Save")}
            </span>
          </div>

          {wizard.step === 1 && (
            <div className="wizard-panel">
              <h2>{t(locale, "Тип карта", "Card type")}</h2>
              <div className="card-type-grid">
                {CARD_TYPES.map((ct) => (
                  <button
                    key={ct.id}
                    type="button"
                    className={
                      wizard.cardType === ct.id
                        ? "card-type-btn active"
                        : "card-type-btn"
                    }
                    onClick={() => wizard.selectCardType(ct.id)}
                  >
                    {t(locale, ct.bg, ct.en)}
                  </button>
                ))}
              </div>
              <div className="wizard-actions">
                <button
                  type="button"
                  disabled={!wizard.cardType}
                  onClick={() => wizard.setStep(2)}
                >
                  Напред
                </button>
              </div>
            </div>
          )}

          {wizard.step === 2 && wizard.cardType && (
            <div className="wizard-panel">
              <h2>
                {t(locale, "Данни за достъп", "Access details")} —{" "}
                {labelForType(locale, wizard.cardType)}
              </h2>
              <div className="form-grid">
                {wizard.isGuest && (
                  <label>
                    Стая
                    <select
                      value={wizard.locationId}
                      onChange={(e) => wizard.setLocationId(e.target.value)}
                    >
                      <option value="">Изберете стая…</option>
                      {wizard.rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.buildingCode} · {r.number} (ет. {r.floor})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {wizard.isStaff && (
                  <label>
                    Служител
                    <select
                      value={wizard.employeeId}
                      onChange={(e) => wizard.setEmployeeId(e.target.value)}
                    >
                      <option value="">Изберете служител…</option>
                      {wizard.employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.fullName} ({e.employeeNumber})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {wizard.isStaff && !wizard.isMaster && (
                  <label>
                    Локация (опционално)
                    <select
                      value={wizard.locationId}
                      onChange={(e) => wizard.setLocationId(e.target.value)}
                    >
                      <option value="">Без конкретна стая</option>
                      {wizard.rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.buildingCode} · {r.number}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {wizard.isMaster && (
                  <p className="muted">
                    Мастър картата е с обхват целия имот (без конкретна стая).
                  </p>
                )}

                <label>
                  Валидна от
                  <input
                    type="datetime-local"
                    value={wizard.validity.validFrom}
                    onChange={(e) =>
                      wizard.setValidity((v) => ({
                        ...v,
                        validFrom: e.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Валидна до
                  <input
                    type="datetime-local"
                    value={wizard.validity.validUntil}
                    onChange={(e) =>
                      wizard.setValidity((v) => ({
                        ...v,
                        validUntil: e.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Етикет (опционално)
                  <input
                    value={wizard.label}
                    onChange={(e) => wizard.setLabel(e.target.value)}
                    placeholder="напр. Гост Иванов"
                    maxLength={120}
                  />
                </label>
              </div>
              <div className="wizard-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => wizard.setStep(1)}
                >
                  Назад
                </button>
                <button type="button" onClick={() => wizard.goToStep3()}>
                  Напред
                </button>
              </div>
            </div>
          )}

          {wizard.step === 3 && wizard.cardType && (
            <div className="wizard-panel">
              <h2>Запис</h2>
              {!wizard.issued ? (
                <>
                  <dl className="review-list">
                    <div>
                      <dt>Тип</dt>
                      <dd>{labelForType(locale, wizard.cardType)}</dd>
                    </div>
                    {wizard.selectedEmployee && (
                      <div>
                        <dt>Служител</dt>
                        <dd>
                          {wizard.selectedEmployee.fullName} (
                          {wizard.selectedEmployee.employeeNumber})
                        </dd>
                      </div>
                    )}
                    {wizard.selectedRoom && (
                      <div>
                        <dt>Стая</dt>
                        <dd>
                          {wizard.selectedRoom.buildingCode} ·{" "}
                          {wizard.selectedRoom.number}
                        </dd>
                      </div>
                    )}
                    {wizard.isMaster && (
                      <div>
                        <dt>Обхват</dt>
                        <dd>Целият имот</dd>
                      </div>
                    )}
                    <div>
                      <dt>Срок</dt>
                      <dd>
                        {formatWhen(
                          toIsoLocal(wizard.validity.validFrom),
                          locale,
                        )}{" "}
                        —{" "}
                        {formatWhen(
                          toIsoLocal(wizard.validity.validUntil),
                          locale,
                        )}
                      </dd>
                    </div>
                    {wizard.label.trim() && (
                      <div>
                        <dt>Етикет</dt>
                        <dd>{wizard.label.trim()}</dd>
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
                      onClick={() => wizard.setStep(2)}
                      disabled={wizard.issuing}
                    >
                      Назад
                    </button>
                    <button
                      type="button"
                      onClick={() => void wizard.submitIssue()}
                      disabled={wizard.issuing || !canIssue}
                    >
                      {wizard.issuing ? "Запис…" : "Запиши в системата"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="ok-banner">Записано в системата</p>
                  <p className="muted">
                    {t(locale, "Карта", "Card")}{" "}
                    {labelForType(locale, wizard.issued.cardType)} ·{" "}
                    {t(locale, "статус", "status")} {wizard.issued.status}
                  </p>
                  <div className="wizard-actions">
                    <button type="button" onClick={wizard.resetWizard}>
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
                value={staff.staffQ}
                onChange={(e) => staff.setStaffQ(e.target.value)}
                placeholder="Име или служебен номер…"
              />
            </label>
            <label>
              Статус
              <select
                value={staff.staffStatus}
                onChange={(e) =>
                  staff.setStaffStatus(e.target.value as "" | CardStatus)
                }
              >
                <option value="">Всички</option>
                <option value="active">Активни</option>
                <option value="revoked">Отменени</option>
              </select>
            </label>
          </div>

          {staff.loading && staff.staffCards.length === 0 ? (
            <p className="muted">Зареждане…</p>
          ) : staff.staffCards.length === 0 ? (
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
                  {staff.staffCards.map((card) => {
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
                          {canRevoke && card.status === "active" ? (
                            <button
                              type="button"
                              className="ghost"
                              disabled={staff.busy}
                              onClick={() => void staff.onRevoke(card.id)}
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
