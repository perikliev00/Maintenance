import { useEffect, useState } from "react";
import {
  fetchMySectors,
  type AuthUser,
} from "../api/client";

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
};

/** Shows “your sectors” scope hint for supervisors (server already filters). */
export function ScopeHint({ user, locale = "bg" }: Props) {
  const [count, setCount] = useState<number | null>(
    user.supervisedSectorCount ?? null,
  );
  const [codes, setCodes] = useState<string[]>([]);

  useEffect(() => {
    if (user.role !== "supervisor") return;
    let cancelled = false;
    void fetchMySectors()
      .then((res) => {
        if (cancelled) return;
        setCount(res.count);
        setCodes(res.sectors.map((s) => s.code));
      })
      .catch(() => {
        /* keep AuthUser count if fetch fails */
      });
    return () => {
      cancelled = true;
    };
  }, [user.role, user.employeeId]);

  if (user.role !== "supervisor") return null;

  const n = count ?? 0;
  const label =
    locale === "en"
      ? `Scope: your sectors (${n})`
      : `Обхват: вашите сектори (${n})`;
  const detail =
    codes.length > 0
      ? codes.join(", ")
      : locale === "en"
        ? "No sectors assigned as primary supervisor"
        : "Няма сектори с вас като основен супервайзър";

  return (
    <p className="muted small scope-hint" role="status">
      {label} — {detail}
    </p>
  );
}
