/**
 * Registered-devices panel for one employee. Generation-gated so a late
 * response for employee A cannot overwrite employee B.
 * Portaled to document.body so position:fixed is always viewport-relative.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchEmployeeDevices,
  revokeEmployeeDevice,
  type Person,
  type RegisteredDevice,
} from "../../api/client";
import { t } from "./labels";

type Props = {
  person: Person;
  locale: "bg" | "en";
  canRevoke: boolean;
  onClose: () => void;
  onChanged: () => void;
  /** When the actor revokes their own device registration, clear local session. */
  onRevokedOwnDevice?: () => void;
};

export function TeamPersonDevicesDialog({
  person,
  locale,
  canRevoke,
  onClose,
  onChanged,
  onRevokedOwnDevice,
}: Props) {
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const generationRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchEmployeeDevices(person.employeeId);
      if (generation !== generationRef.current) return;
      setDevices(rows);
    } catch (err) {
      if (generation !== generationRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : t(locale, "Неуспешно зареждане", "Failed to load"),
      );
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [person.employeeId, locale]);

  useEffect(() => {
    void load();
    return () => {
      generationRef.current += 1;
    };
  }, [load]);

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

  async function onRevoke(device: RegisteredDevice) {
    const confirmed = window.confirm(
      t(
        locale,
        `Отнемане на достъпа за „${device.label}“ на ${person.fullName}? Това прекратява сесиите на тази регистрация, но не блокира целия служител.`,
        `Revoke access for “${device.label}” belonging to ${person.fullName}? This ends sessions for this registration but does not block the whole employee.`,
      ),
    );
    if (!confirmed) return;
    setBusyId(device.id);
    setError(null);
    try {
      const result = await revokeEmployeeDevice(device.id);
      if (result.revokedOwnDevice) {
        onRevokedOwnDevice?.();
        return;
      }
      await load();
      onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t(locale, "Неуспешно отнемане", "Failed to revoke"),
      );
    } finally {
      setBusyId(null);
    }
  }

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
        aria-labelledby="team-devices-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <h2 id="team-devices-title">
            {t(locale, "Регистрирани устройства", "Registered devices")}
          </h2>
          <button type="button" className="ghost" onClick={onClose}>
            {t(locale, "Затвори", "Close")}
          </button>
        </div>
        <p className="muted small">
          {t(
            locale,
            "Регистрации чрез активиране с неотнет достъп — не онлайн устройства, физически телефони или всички активни сесии.",
            "Registrations via activation with non-revoked access — not online devices, physical phones, or all active sessions.",
          )}
        </p>
        <p>
          <strong>{person.fullName}</strong>{" "}
          <span className="muted">({person.employeeNumber})</span>
        </p>
        {error && <div className="error banner">{error}</div>}
        {loading ? (
          <p className="muted">{t(locale, "Зареждане…", "Loading…")}</p>
        ) : devices.length === 0 ? (
          <p className="muted">
            {t(
              locale,
              "Няма регистрирани устройства с активен достъп.",
              "No registered devices with active access.",
            )}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t(locale, "Име", "Name")}</th>
                  <th>{t(locale, "Активирано", "Activated")}</th>
                  <th>{t(locale, "Последна активност", "Last activity")}</th>
                  {canRevoke && <th></th>}
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td>{d.label}</td>
                    <td>{new Date(d.activatedAt).toLocaleString()}</td>
                    <td>{new Date(d.lastSeenAt).toLocaleString()}</td>
                    {canRevoke && (
                      <td>
                        <button
                          type="button"
                          className="ghost"
                          disabled={busyId === d.id}
                          onClick={() => void onRevoke(d)}
                        >
                          {busyId === d.id
                            ? t(locale, "Отнемане…", "Revoking…")
                            : t(locale, "Отнеми достъпа", "Revoke access")}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && !loading && (
          <button type="button" className="ghost" onClick={() => void load()}>
            {t(locale, "Опитай отново", "Retry")}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
