/**
 * Applies deferred departure vacant/dirty effects for a hotel date.
 * First pass may leave protected rooms as deferred; confirm re-runs with
 * those entry ids. Reading the plan alone never mutates rooms.
 */
import { useEffect, useRef, useState } from "react";
import { applyDepartureRoomEffects } from "../../api/client";

type Props = {
  canManage: boolean;
  hotelDate: string;
  loading: boolean;
  refresh: () => Promise<void>;
  setError: (value: string | null) => void;
  setMessage: (value: string | null) => void;
};

/**
 * Plan-page panel that applies deferred departure vacant/dirty effects.
 * Hidden without manage permission; reading the plan alone never mutates rooms.
 */
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
  // Entry ids deferred by the last apply — fed into confirm on the second pass.
  const [deferredEntryIds, setDeferredEntryIds] = useState<string[]>([]);
  const dateRef = useRef(hotelDate);
  dateRef.current = hotelDate;
  useEffect(() => {
    setDeferredEntryIds([]);
    setApplyingEffects(false);
    setConfirmingDeferred(false);
    setMessage(null);
    setError(null);
  }, [hotelDate, setMessage, setError]);

  // Permission gate: non-managers never see this panel.
  if (!canManage) return null;

  /** First pass: apply safe effects; collect deferred entry ids for confirm. */
  async function onApplyDepartureEffects() {
    setApplyingEffects(true);
    setError(null);
    setMessage(null);
    // Try block for fallible work.
    try {
      const result = await applyDepartureRoomEffects(hotelDate);
      if (dateRef.current !== hotelDate) return;
      setDeferredEntryIds(result.deferredEntryIds ?? []);
      // Summarize applied / protected / deferred counts for the banner.
      setMessage(
        result.total === 0
          ? "Няма чакащи ефекти от напускания за тази дата"
          : `Ефекти от напускания: приложени ${result.applied}, защитени ${result.skipped}, чакат потвърждение ${result.deferred}`,
      );
      // Await async step.
      await refresh();
    } catch (err) {
      if (dateRef.current !== hotelDate) return;
      setError(
        err instanceof Error
          ? err.message
          : "Неуспешно прилагане на ефекти от напускания",
      );
    } finally {
      if (dateRef.current === hotelDate) setApplyingEffects(false);
    }
  }

  /** Second pass: re-run with confirmEntryIds for ambiguous occupied rooms. */
  async function onConfirmDeferredDepartures() {
    if (deferredEntryIds.length === 0) return;
    setConfirmingDeferred(true);
    setError(null);
    setMessage(null);
    // Try block for fallible work.
    try {
      const result = await applyDepartureRoomEffects(hotelDate, {
        confirmEntryIds: deferredEntryIds,
      });
      if (dateRef.current !== hotelDate) return;
      // Remaining deferred ids (if any) stay for another confirm cycle.
      setDeferredEntryIds(result.deferredEntryIds ?? []);
      setMessage(
        `Потвърдени отложени напускания: приложени ${result.applied}, защитени ${result.skipped}, остават отложени ${result.deferred}`,
      );
      // Await async step.
      await refresh();
    } catch (err) {
      if (dateRef.current !== hotelDate) return;
      setError(
        err instanceof Error
          ? err.message
          : "Неуспешно потвърждаване на отложени напускания",
      );
    } finally {
      if (dateRef.current === hotelDate) setConfirmingDeferred(false);
    }
  }

  // Early / value return.
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
        {/* Render branch: applyingEffects ? "Прилагане…" : "Приложи ефекти от напуска */}
        {applyingEffects ? "Прилагане…" : "Приложи ефекти от напускания"}
      </button>
      {/* Confirm UI only after the first pass returns deferred entry ids. */}
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
