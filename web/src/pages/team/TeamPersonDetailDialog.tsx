/**
 * Read-only person summary modal for the Team directory.
 * Portaled to document.body so position:fixed is always viewport-relative.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ROLE_LABELS, type Person } from "../../api/client";
import { t } from "./labels";
import { normalizePersonStatus } from "./personActions";

type Props = {
  person: Person;
  locale: "bg" | "en";
  onClose: () => void;
};

export function TeamPersonDetailDialog({ person, locale, onClose }: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="panel modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-person-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <h2 id="team-person-detail-title">
            {t(locale, "Преглед", "View")}
          </h2>
          <button type="button" className="ghost" onClick={onClose}>
            {t(locale, "Затвори", "Close")}
          </button>
        </div>
        <dl className="stack">
          <div>
            <dt className="muted">{t(locale, "Име", "Name")}</dt>
            <dd>{person.fullName}</dd>
          </div>
          <div>
            <dt className="muted">{t(locale, "Номер", "Number")}</dt>
            <dd>{person.employeeNumber}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{person.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="muted">{t(locale, "Роля", "Role")}</dt>
            <dd>
              {person.role ? ROLE_LABELS[person.role] ?? person.role : "—"}
            </dd>
          </div>
          <div>
            <dt className="muted">{t(locale, "Статус", "Status")}</dt>
            <dd>{normalizePersonStatus(person)}</dd>
          </div>
          <div>
            <dt className="muted">
              {t(locale, "Регистрирани устройства", "Registered devices")}
            </dt>
            <dd>{person.deviceCount}</dd>
          </div>
        </dl>
        {normalizePersonStatus(person) === "archived" && (
          <p className="muted small">
            {t(
              locale,
              "След възстановяване достъпът остава спрян — нужни са отблокиране и/или ново активиране.",
              "After restore, access stays stopped — unblock and/or a new activation are still required.",
            )}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
