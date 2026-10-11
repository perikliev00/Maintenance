import { FormEvent, useState } from "react";
import {
  importDailyPlan,
  type DailyPlan,
} from "../../api/client";
import { EXAMPLE_IMPORT } from "./constants";

type LastImportProps = {
  plan: DailyPlan | null;
};

export function PlanLastImport({ plan }: LastImportProps) {
  if (!plan?.lastImport) return null;
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

  if (!canManage) return null;

  async function onImport(e: FormEvent) {
    e.preventDefault();
    setImporting(true);
    setError(null);
    setMessage(null);
    try {
      const parsed = JSON.parse(importText) as {
        hotelDate?: string;
        sourceLabel?: string;
        entries?: unknown;
      };
      if (!parsed || typeof parsed !== "object") {
        throw new Error("JSON трябва да е обект");
      }
      const payload = {
        hotelDate: parsed.hotelDate || hotelDate,
        sourceLabel: parsed.sourceLabel || "clock",
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      };
      const result = await importDailyPlan(
        payload as Parameters<typeof importDailyPlan>[0],
      );
      setPlan(result.plan);
      if (result.plan.date) setHotelDate(result.plan.date);
      const b = result.batch;
      setMessage(
        `Импорт ${b.status}: създадени ${b.createdCount}, пропуснати ${b.skippedCount}, грешки ${b.errorCount}`,
      );
      if (b.errorCount > 0 && Array.isArray(b.errors) && b.errors.length) {
        const sample = b.errors
          .slice(0, 3)
          .map((err) => `${err.room ?? `#${err.index}`}: ${err.reason}`)
          .join("; ");
        setError(`Грешки при импорт: ${sample}`);
      }
    } catch (err) {
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

  function onImportFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setImportText(text);
    };
    reader.readAsText(file);
  }

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
