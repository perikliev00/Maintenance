/**
 * components/ScopeHint.tsx — UI module (densified documentation).
 */
import { useEffect, useState } from "react";
import {
  fetchMySectors,
  type AuthUser,
} from "../api/client";

type Props = {
  user: AuthUser;
  locale?: "bg" | "en";
};

/**
 * Shows “your sectors” scope hint for supervisors (server already filters).
 * Non-supervisors render nothing; fetch failure keeps AuthUser’s sector count.
 */
export function ScopeHint({ user, locale = "bg" }: Props) {
  // Seed from AuthUser so first paint has a count before `/sectors/mine` returns.
  const [count, setCount] = useState<number | null>(
    user.supervisedSectorCount ?? null,
  );
  const [codes, setCodes] = useState<string[]>([]);

  useEffect(() => {
    // Non-supervisors never need the fetch.
    if (user.role !== "supervisor") return;
    let cancelled = false;
    // Fire-and-forget async/side effect.
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

  // Permission gate: only supervisors see the scope hint.
  if (user.role !== "supervisor") return null;

  const n = count ?? 0;
  const label =
    locale === "en"
      ? `Scope: your sectors (${n})`
      : `Обхват: вашите сектори (${n})`;
  // Prefer live codes; fall back to empty-state copy when none assigned.
  const detail =
    // Continue module logic.
    codes.length > 0
      ? codes.join(", ")
      : locale === "en"
        // Continue module logic.
        ? "No sectors assigned as primary supervisor"
        // Continue module logic.
        : "Няма сектори с вас като основен супервайзър";

  return (
    // Render JSX element.
    <p className="muted small scope-hint" role="status">
            {label} — {detail}
        </p>
  );
}
