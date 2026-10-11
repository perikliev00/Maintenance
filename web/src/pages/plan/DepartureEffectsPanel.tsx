import { useState } from "react";
import { applyDepartureRoomEffects } from "../../api/client";

type Props = {
  canManage: boolean;
  hotelDate: string;
  loading: boolean;
  refresh: () => Promise<void>;
  setError: (value: string | null) => void;
  setMessage: (value: string | null) => void;
};

export function DepartureEffectsPanel({
  canManage,
  hotelDate,
  loading,
  refresh,
  setError,
  setMessage,
}: Props) {
  const [applyingEffects, setApplyingEffects] = useState(false);
  const [confirmingDeferred, setConfirmingDeferred] = useState(false);
  const [deferredEntryIds, setDeferredEntryIds] = useState<string[]>([]);

  if (!canManage) return null;

  async function onApplyDepartureEffects() {
    setApplyingEffects(true);
    setError(null);
    setMessage(null);
    try {
      const result = await applyDepartureRoomEffects(hotelDate);
      setDeferredEntryIds(result.deferredEntryIds ?? []);
      setMessage(
        result.total === 0
          ? "Няма чакащи ефекти от напускания за тази дата"
          : `Ефекти от напускания: приложени ${result.applied}, защитени ${result.skipped}, чакат потвърждение ${result.deferred}`,
      );
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Неуспешно прилагане на ефекти от напускания",
      );
    } finally {
      setApplyingEffects(false);
    }
  }

  async function onConfirmDeferredDepartures() {
    if (deferredEntryIds.length === 0) return;
    setConfirmingDeferred(true);
    setError(null);
    setMessage(null);
    try {
      const result = await applyDepartureRoomEffects(hotelDate, {
        confirmEntryIds: deferredEntryIds,
      });
      setDeferredEntryIds(result.deferredEntryIds ?? []);
      setMessage(
        `Потвърдени отложени напускания: приложени ${result.applied}, защитени ${result.skipped}, остават отложени ${result.deferred}`,
      );
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Неуспешно потвърждаване на отложени напускания",
      );
    } finally {
      setConfirmingDeferred(false);
    }
  }

  return (
    <section className="panel">
      <h2>Ефекти от напускания</h2>
      <p className="muted small">
        Четенето на плана не променя стаите. Приложи deferred vacant/dirty само
        за помещения в твоя обхват. Стаи с доказан по-нов престой се защитават;
        неясни минали напускания остават за потвърждение.
      </p>
      <button
        type="button"
        disabled={applyingEffects || confirmingDeferred || loading}
        onClick={() => void onApplyDepartureEffects()}
      >
        {applyingEffects ? "Прилагане…" : "Приложи ефекти от напускания"}
      </button>
      {deferredEntryIds.length > 0 && (
        <div className="stack" style={{ marginTop: "0.75rem" }}>
          <p className="muted small">
            {deferredEntryIds.length} отложени записа чакат изрично потвърждение
            (стаята е заета без доказан по-нов престой). Потвърждението
            освобождава стаята и създава/свързва задача за почистване.
          </p>
          <button
            type="button"
            disabled={applyingEffects || confirmingDeferred || loading}
            onClick={() => void onConfirmDeferredDepartures()}
          >
            {confirmingDeferred
              ? "Потвърждаване…"
              : `Потвърди отложените (${deferredEntryIds.length})`}
          </button>
        </div>
      )}
    </section>
  );
}
