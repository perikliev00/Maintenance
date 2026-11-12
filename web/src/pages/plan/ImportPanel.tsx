/**
 * JSON daily-plan import UI (gated by `canManage`). Parses textarea JSON and
 * posts via `importDailyPlan`; surfaces batch create/skip/error counts.
 */
import { FormEvent, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  importDailyPlan,
  // Declare type alias DailyPlan.
  type DailyPlan,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ./constants.
import { EXAMPLE_IMPORT } from "./constants";

// Declare type alias LastImportProps.
type LastImportProps = {
  // Provide plan field used by this structure.
  plan: DailyPlan | null;
};

/** Compact status line for the most recent import batch on the plan. */
export function PlanLastImport({ plan }: LastImportProps) {
  // No lastImport metadata yet — render nothing.
  if (!plan?.lastImport) return null;
  // Early / value return.
  return (
    // Render a <p> element for layout or semantics.
    <p className="muted small">
      Последен импорт ({plan.lastImport.sourceLabel}): {plan.lastImport.status}{" "}
      · създадени {plan.lastImport.createdCount} / {plan.lastImport.totalCount} ·{" "}
      {new Date(plan.lastImport.createdAt).toLocaleString("bg-BG")}
    </p>
  );
}

// Declare type alias Props.
type Props = {
  // Provide canManage field used by this structure.
  canManage: boolean;
  // Provide hotelDate field used by this structure.
  hotelDate: string;
  // Provide setHotelDate field used by this structure.
  setHotelDate: (value: string) => void;
  // Provide setPlan field used by this structure.
  setPlan: (value: DailyPlan | null) => void;
  // Provide setError field used by this structure.
  setError: (value: string | null) => void;
  // Provide setMessage field used by this structure.
  setMessage: (value: string | null) => void;
};

/**
 * JSON daily-plan import form (file or textarea). Hidden without `canManage`.
 */
export function ImportPanel({
  // Support the surrounding logic for this step.
  canManage,
  // Support the surrounding logic for this step.
  hotelDate,
  // Support the surrounding logic for this step.
  setHotelDate,
  // Support the surrounding logic for this step.
  setPlan,
  // Support the surrounding logic for this step.
  setError,
  // Support the surrounding logic for this step.
  setMessage,
// Support the surrounding logic for this step.
}: Props) {
  // React state slot for local UI/data that can change over time.
  const [importing, setImporting] = useState(false);
  // React state slot for local UI/data that can change over time.
  const [importText, setImportText] = useState("");

  // Permission gate — non-managers never see the import UI.
  if (!canManage) return null;

  /** Parse textarea JSON and post via `importDailyPlan`. */
  async function onImport(e: FormEvent) {
    // Invoke e.preventDefault to perform this step.
    e.preventDefault();
    // State transition.
    setImporting(true);
    // State transition.
    setError(null);
    // State transition.
    setMessage(null);
    // Try block for fallible work.
    try {
      // Parse JSON payload into a usable object.
      const parsed = JSON.parse(importText) as {
        // Support the surrounding logic for this step.
        hotelDate?: string;
        // Support the surrounding logic for this step.
        sourceLabel?: string;
        // Support the surrounding logic for this step.
        entries?: unknown;
      };
      // Branch: conditional gate.
      if (!parsed || typeof parsed !== "object") {
        // Throw error path.
        throw new Error("JSON трябва да е обект");
      }
      // Conditional branch for the case described by this guard.
      if (!Array.isArray(parsed.entries)) {
        // Abort this path by throwing an error to callers.
        throw new Error("Невалиден импорт: entries трябва да е списък");
      }
      // Fall back to the page hotelDate / "clock" when fields are omitted.
      const payload = {
        // Provide hotelDate field used by this structure.
        hotelDate: parsed.hotelDate || hotelDate,
        // Provide sourceLabel field used by this structure.
        sourceLabel: parsed.sourceLabel || "clock",
        // Provide entries field used by this structure.
        entries: parsed.entries,
      };
      // Bind result for use in the following logic.
      const result = await importDailyPlan(
        // Support the surrounding logic for this step.
        payload as Parameters<typeof importDailyPlan>[0],
      );
      // State transition.
      setPlan(result.plan);
      // Sync the page date picker to the imported plan date when present.
      if (result.plan.date) setHotelDate(result.plan.date);
      // Bind b for use in the following logic.
      const b = result.batch;
      // State transition.
      setMessage(
        // Support the surrounding logic for this step.
        `Импорт ${b.status}: създадени ${b.createdCount}, пропуснати ${b.skippedCount}, грешки ${b.errorCount}`,
      );
      // Surface a short sample of per-row errors alongside the success banner.
      if (b.errorCount > 0 && Array.isArray(b.errors) && b.errors.length) {
        // Bind sample for use in the following logic.
        const sample = b.errors
          // Continue a chained call building on the previous expression.
          .slice(0, 3)
          // Continue a chained call building on the previous expression.
          .map((err) => `${err.room ?? `#${err.index}`}: ${err.reason}`)
          .join("; ");
        // State transition.
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
      // State transition.
      setImporting(false);
    }
  }

  /** Read a selected .json file into the textarea. */
  function onImportFile(file: File | null) {
    // Branch: conditional gate.
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      // State transition.
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
