/**
 * JSON daily-plan import UI (gated by `canManage`). Parses textarea JSON and
 * posts via `importDailyPlan`; surfaces batch create/skip/error counts.
 */
import { FormEvent, useState } from "react";
import {
  importDailyPlan,
  type DailyPlan,
} from "../../api/client";
import { EXAMPLE_IMPORT } from "./constants";

type LastImportProps = {
  plan: DailyPlan | null;
};

/** Compact status line for the most recent import batch on the plan. */
export function PlanLastImport({ plan }: LastImportProps) {
  // No lastImport metadata yet — render nothing.
  if (!plan?.lastImport) return null;
  // Early / value return.
  return (
    <p className="muted small">
      Последен импорт ({plan.lastImport.sourceLabel}): {plan.lastImport.status}{" "}
      · създадени {plan.lastImport.createdCount} / {plan.lastImport.totalCount} ·{" "}
      {new Date(plan.lastImport.createdAt).toLocaleString("bg-BG")}
    </p>
  );
}

type Props = {
  canManage: boolean;
  hotelDate: string;
  setHotelDate: (value: string) => void;
  setPlan: (value: DailyPlan | null) => void;
  setError: (value: string | null) => void;
  setMessage: (value: string | null) => void;
};

/**
 * JSON daily-plan import form (file or textarea). Hidden without `canManage`.
 */
export function ImportPanel({
  canManage,
  hotelDate,
  setHotelDate,
  setPlan,
  setError,
  setMessage,
}: Props) {
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");

  // Permission gate — non-managers never see the import UI.
  if (!canManage) return null;

  /** Parse textarea JSON and post via `importDailyPlan`. */
  async function onImport(e: FormEvent) {
    e.preventDefault();
    setImporting(true);
    setError(null);
    setMessage(null);
    // Try block for fallible work.
    try {
      // Parse JSON payload into a usable object.
      const parsed = JSON.parse(importText) as {
        hotelDate?: string;
        sourceLabel?: string;
        entries?: unknown;
      };
      if (!parsed || typeof parsed !== "object") {
        // Throw error path.
        throw new Error("JSON трябва да е обект");
      }
      if (!Array.isArray(parsed.entries)) {
        // Abort this path by throwing an error to callers.
        throw new Error("Невалиден импорт: entries трябва да е списък");
      }
      // Fall back to the page hotelDate / "clock" when fields are omitted.
      const payload = {
        hotelDate: parsed.hotelDate || hotelDate,
        sourceLabel: parsed.sourceLabel || "clock",
        entries: parsed.entries,
      };
      const result = await importDailyPlan(
        payload as Parameters<typeof importDailyPlan>[0],
      );
      setPlan(result.plan);
      // Sync the page date picker to the imported plan date when present.
      if (result.plan.date) setHotelDate(result.plan.date);
      const b = result.batch;
      setMessage(
        `Импорт ${b.status}: създадени ${b.createdCount}, пропуснати ${b.skippedCount}, грешки ${b.errorCount}`,
      );
      // Surface a short sample of per-row errors alongside the success banner.
      if (b.errorCount > 0 && Array.isArray(b.errors) && b.errors.length) {
        const sample = b.errors
          .slice(0, 3)
          .map((err) => `${err.room ?? `#${err.index}`}: ${err.reason}`)
          .join("; ");
        setError(`Грешки при импорт: ${sample}`);
      }
    } catch (err) {
      // Distinguish JSON parse failures from API/business errors.
      setError(
        err instanceof SyntaxError
          ? "Невалиден JSON"
          : err instanceof Error
            ? err.message
            : "Import failed",
      );
    } finally {
      setImporting(false);
    }
  }

  /** Read a selected .json file into the textarea. */
  function onImportFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setImportText(text);
    };
    reader.readAsText(file);
  }

  // Early / value return.
  return (
    <section className="panel">
      <h2>Импорт (JSON)</h2>
      <form className="report-form" onSubmit={onImport}>
        <label>
          Файл
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => onImportFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="full-width">
          JSON
          <textarea
            rows={10}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={EXAMPLE_IMPORT.replace(/YYYY-MM-DD/g, hotelDate)}
            required
          />
        </label>
        <button type="submit" disabled={importing || !importText.trim()}>
          {/* Render branch: importing ? "Импорт…" : "Импортирай" */}
          {importing ? "Импорт…" : "Импортирай"}
        </button>
      </form>
      <p className="muted small">
        Стаи по buildingCode + roomNumber. Повторен импорт с еднакъв externalId
        или вече съществуващ запис се пропуска. Ръчните записи не се презаписват.
      </p>
    </section>
  );
}
