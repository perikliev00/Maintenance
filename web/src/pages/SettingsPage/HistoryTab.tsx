/** Read-only settings change timeline (diff truncated for display). */
import type { SettingHistoryRow } from "../../api/client";
import type { LabelFn } from "./constants";

type Props = {
  history: SettingHistoryRow[];
  label: LabelFn;
  /** Load failure for this tab only (not the settings error banner). */
  error?: string | null;
};

/**
 * Read-only settings change timeline. Diff column truncates JSON to 120 chars.
 */
export function HistoryTab({ history, label, error = null }: Props) {
  // Early / value return.
  return (
    <div className="table-wrap">
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>{label("Време", "Time")}</th>
            <th>{label("Ключ", "Key")}</th>
            <th>{label("Актор", "Actor")}</th>
            <th>{label("Причина", "Reason")}</th>
            <th>Diff</th>
          </tr>
        </thead>
        <tbody>
          {history.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                {label("Няма записи", "No entries")}
              </td>
            </tr>
          ) : (
            history.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.createdAt).toLocaleString()}</td>
                <td>{row.key}</td>
                <td>{row.actor.fullName}</td>
                <td>{row.reason ?? "—"}</td>
                <td>
                  {/* Truncate after-JSON for scannable table cells. */}
                  <code className="diff-mini">
                    {JSON.stringify(row.after).slice(0, 120)}
                    {JSON.stringify(row.after).length > 120 ? "…" : ""}
                  </code>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
