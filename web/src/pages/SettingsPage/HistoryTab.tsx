import type { SettingHistoryRow } from "../../api/client";
import type { LabelFn } from "./constants";

type Props = {
  history: SettingHistoryRow[];
  label: LabelFn;
};

export function HistoryTab({ history, label }: Props) {
  return (
    <div className="table-wrap">
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
