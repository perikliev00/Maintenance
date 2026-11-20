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
import { LoadingIndicator } from "../components/LoadingIndicator";
import { SectionNav, Surface, Workspace, WorkspaceIntro } from "../ui";
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
    <Workspace className="ui-cards-workspace">
      <WorkspaceIntro eyebrow={t(locale, "ДОСТЪП ДО ИМОТА", "PROPERTY ACCESS")} title={t(locale, "Карти", "Cards")} description={t(locale, "Подгответе право на достъп с ясен обхват и срок на валидност.", "Prepare access with a clear scope and period of validity.")} />
      {error && <p role="alert" className="error-banner">{error}</p>}
      {message && <p role="status" className="ok-banner">{message}</p>}
      <div className="ui-section-layout">
        <aside>
          <SectionNav<Tab> label={t(locale, "Работа с карти", "Card workspaces")} items={[{id: "issue", label: t(locale, "Издаване", "Issue")}, {id: "staff", label: t(locale, "Карти на служители", "Staff cards")}]} value={tab} onChange={setTab} />
          {tab === "issue" && <div className="ui-access-context">
            <ol className="ui-process-list" aria-label={t(locale, "Стъпки за издаване", "Issue steps")}>
              {[t(locale, "Тип карта", "Card type"), t(locale, "Данни за достъп", "Access details"), t(locale, "Запис", "Save")].map((stepLabel, index) => <li key={stepLabel} aria-current={wizard.step === index + 1 ? "step" : undefined} className={wizard.step === index + 1 ? "active" : ""}><span aria-hidden="true">{index + 1}</span>{stepLabel}</li>)}
            </ol>
            <div className="ui-access-pass"><span className="ui-eyebrow">{t(locale, "ОБХВАТ НА ДОСТЪПА", "ACCESS SCOPE")}</span><strong>{wizard.cardType ? labelForType(locale, wizard.cardType) : t(locale, "Изберете тип", "Choose a type")}</strong><p>{wizard.selectedRoom ? `${wizard.selectedRoom.buildingCode} · ${wizard.selectedRoom.number}` : wizard.isMaster ? t(locale, "Целият имот", "Entire property") : t(locale, "Определете при издаване", "Define when issuing")}</p></div>
            <p className="muted small">{t(locale, "Създава се запис за достъп. Физическото кодиране на карта не е свързано.", "Creates an access record. Physical card encoding is not connected.")}</p>
          </div>}
        </aside>
        <div className="ui-section-content">
          {tab === "issue" && <section className="ui-access-studio">
            {wizard.step === 1 && <Surface title={t(locale, "Тип карта", "Card type")} description={t(locale, "За кого е предназначен достъпът?", "Who needs access?")}>
              <div className="ui-access-types">{CARD_TYPES.map((cardType) => <button key={cardType.id} type="button" aria-label={t(locale, cardType.bg, cardType.en)} aria-pressed={wizard.cardType === cardType.id} className={wizard.cardType === cardType.id ? "ui-access-type active" : "ui-access-type"} onClick={() => wizard.selectCardType(cardType.id)}><strong>{t(locale, cardType.bg, cardType.en)}</strong><span className="muted">{cardType.id === "guest" ? t(locale, "Достъп до стая в избран период", "Room access during a defined stay") : cardType.id === "master" ? t(locale, "Обхват на целия имот", "Property-wide access") : t(locale, "Достъп, свързан със служител", "Access linked to a team member")}</span></button>)}</div>
              <div className="ui-commit-bar"><button type="button" disabled={!wizard.cardType} onClick={() => wizard.setStep(2)}>{t(locale, "Напред", "Continue")}</button></div>
            </Surface>}
            {wizard.step === 2 && wizard.cardType && <Surface title={t(locale, "Данни за достъп", "Access details")} description={labelForType(locale, wizard.cardType)}>
              <div className="ui-focused-form">
                {wizard.isGuest && <label>{t(locale, "Стая", "Room")}<select value={wizard.locationId} onChange={(e) => wizard.setLocationId(e.target.value)}><option value="">{t(locale, "Изберете стая…", "Choose a room…")}</option>{wizard.rooms.map((room) => <option key={room.id} value={room.id}>{room.buildingCode} · {room.number} ({t(locale, "ет.", "fl.")} {room.floor})</option>)}</select></label>}
                {wizard.isStaff && <label>{t(locale, "Служител", "Employee")}<select value={wizard.employeeId} onChange={(e) => wizard.setEmployeeId(e.target.value)}><option value="">{t(locale, "Изберете служител…", "Choose an employee…")}</option>{wizard.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName} ({employee.employeeNumber})</option>)}</select></label>}
                {wizard.isStaff && !wizard.isMaster && <label>{t(locale, "Локация (опционално)", "Location (optional)")}<select value={wizard.locationId} onChange={(e) => wizard.setLocationId(e.target.value)}><option value="">{t(locale, "Без конкретна стая", "No specific room")}</option>{wizard.rooms.map((room) => <option key={room.id} value={room.id}>{room.buildingCode} · {room.number}</option>)}</select></label>}
                {wizard.isMaster && <p className="ui-context-note">{t(locale, "Мастър картата е с обхват целия имот (без конкретна стая).", "A master card covers the entire property, without a specific room.")}</p>}
                <fieldset className="ui-validity-fields"><legend>{t(locale, "Период на валидност", "Validity period")}</legend>
                  <label>{t(locale, "Валидна от", "Valid from")}<input type="datetime-local" value={wizard.validity.validFrom} onChange={(e) => wizard.setValidity((previous) => ({...previous, validFrom: e.target.value}))} /></label>
                  <label>{t(locale, "Валидна до", "Valid until")}<input type="datetime-local" value={wizard.validity.validUntil} onChange={(e) => wizard.setValidity((previous) => ({...previous, validUntil: e.target.value}))} /></label>
                </fieldset>
                <label>{t(locale, "Етикет (опционално)", "Label (optional)")}<input value={wizard.label} onChange={(e) => wizard.setLabel(e.target.value)} placeholder={t(locale, "напр. Гост Иванов", "e.g. Guest Ivanov")} maxLength={120} /></label>
              </div>
              <div className="ui-commit-bar"><button type="button" className="ghost" onClick={() => wizard.setStep(1)}>{t(locale, "Назад", "Back")}</button><button type="button" onClick={() => wizard.goToStep3()}>{t(locale, "Напред", "Continue")}</button></div>
            </Surface>}
            {wizard.step === 3 && wizard.cardType && <Surface title={t(locale, "Запис", "Save")}>
              {!wizard.issued ? <>
                <dl className="ui-record-facts ui-access-review"><div><dt>{t(locale, "Тип", "Type")}</dt><dd>{labelForType(locale, wizard.cardType)}</dd></div>
                  {wizard.selectedEmployee && <div><dt>{t(locale, "Служител", "Employee")}</dt><dd>{wizard.selectedEmployee.fullName} ({wizard.selectedEmployee.employeeNumber})</dd></div>}
                  {wizard.selectedRoom && <div><dt>{t(locale, "Стая", "Room")}</dt><dd>{wizard.selectedRoom.buildingCode} · {wizard.selectedRoom.number}</dd></div>}
                  {wizard.isMaster && <div><dt>{t(locale, "Обхват", "Scope")}</dt><dd>{t(locale, "Целият имот", "Entire property")}</dd></div>}
                  <div><dt>{t(locale, "Срок", "Validity")}</dt><dd>{formatWhen(toIsoLocal(wizard.validity.validFrom), locale)} — {formatWhen(toIsoLocal(wizard.validity.validUntil), locale)}</dd></div>
                  {wizard.label.trim() && <div><dt>{t(locale, "Етикет", "Label")}</dt><dd>{wizard.label.trim()}</dd></div>}
                </dl>
                <p className="muted">{t(locale, "Ще се запише в базата. Физическото кодиране на карта не е свързано.", "This saves the access record. Physical card encoding is not connected.")}</p>
                <div className="ui-commit-bar"><button type="button" className="ghost" onClick={() => wizard.setStep(2)} disabled={wizard.issuing}>{t(locale, "Назад", "Back")}</button><button type="button" onClick={() => void wizard.submitIssue()} disabled={wizard.issuing || !canIssue}>{wizard.issuing ? t(locale, "Запис…", "Saving…") : t(locale, "Запиши в системата", "Save access record")}</button></div>
              </> : <div className="ui-confirmation"><h3>{t(locale, "Записано в системата", "Saved in the system")}</h3><p>{t(locale, "Карта", "Card")} {labelForType(locale, wizard.issued.cardType)} · {t(locale, "статус", "status")} {wizard.issued.status}</p><button type="button" onClick={wizard.resetWizard}>{t(locale, "Ново издаване", "Issue another")}</button></div>}
            </Surface>}
          </section>}
          {tab === "staff" && <Surface title={t(locale, "Карти на служители", "Staff cards")}>
            <div className="ui-filter-bar"><label>{t(locale, "Търсене", "Search")}<input value={staff.staffQ} onChange={(e) => staff.setStaffQ(e.target.value)} placeholder={t(locale, "Име или служебен номер…", "Name or employee number…")} /></label><label>{t(locale, "Статус", "Status")}<select value={staff.staffStatus} onChange={(e) => staff.setStaffStatus(e.target.value as "" | CardStatus)}><option value="">{t(locale, "Всички", "All")}</option><option value="active">{t(locale, "Активни", "Active")}</option><option value="revoked">{t(locale, "Отменени", "Revoked")}</option></select></label></div>
            {staff.loading && staff.staffCards.length === 0 ? <LoadingIndicator label={t(locale, "Зареждане…", "Loading…")} /> : staff.staffCards.length === 0 ? <p className="ui-empty-state">{t(locale, "Няма служителски карти", "No staff cards")}</p> : <div className="ui-access-register">{staff.staffCards.map((card) => {
              const grant = card.grants[0];
              return <article key={card.id} className="ui-access-record" data-card-id={card.id}><header><div><span className="ui-eyebrow">{labelForType(locale, card.cardType)}</span><h3>{card.employee ? `${card.employee.fullName} (${card.employee.employeeNumber})` : "—"}</h3></div><span className={`pill status-${card.status}`}>{card.status === "active" ? t(locale, "активна", "active") : t(locale, "отменена", "revoked")}</span></header><dl className="ui-record-facts"><div><dt>{t(locale, "Валидност", "Validity")}</dt><dd>{grant ? `${formatWhen(grant.validFrom, locale)} — ${formatWhen(grant.validUntil, locale)}` : "—"}</dd></div></dl>{canRevoke && card.status === "active" && <button type="button" className="ghost" disabled={staff.busy} onClick={() => void staff.onRevoke(card.id)}>{t(locale, "Отмени", "Revoke")}</button>}</article>;
            })}</div>}
          </Surface>}
        </div>
      </div>
    </Workspace>
  );
}