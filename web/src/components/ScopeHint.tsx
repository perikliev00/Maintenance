/**
 * components/ScopeHint.tsx — UI module (densified documentation).
 */
import { useEffect, useState } from "react";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  fetchMySectors,
  // Local type alias shaping data.
  type AuthUser,
// Close multi-line construct with trailing syntax.
} from "../api/client";

// Local type alias shaping data.
type Props = {
  // Field/property in this shape.
  user: AuthUser;
  // Field/property in this shape.
  locale?: "bg" | "en";
};

/**
 * Shows “your sectors” scope hint for supervisors (server already filters).
 * Non-supervisors render nothing; fetch failure keeps AuthUser’s sector count.
 */
export function ScopeHint({ user, locale = "bg" }: Props) {
  // Seed from AuthUser so first paint has a count before `/sectors/mine` returns.
  const [count, setCount] = useState<number | null>(
    // Continue multi-line list/arguments.
    user.supervisedSectorCount ?? null,
  );
  // Assign value for subsequent use.
  const [codes, setCodes] = useState<string[]>([]);

  // Arrow function / callback body.
  useEffect(() => {
    // Non-supervisors never need the fetch.
    if (user.role !== "supervisor") return;
    // Mutable local binding.
    let cancelled = false;
    // Fire-and-forget async/side effect.
    void fetchMySectors()
      // Arrow function / callback body.
      .then((res) => {
        // Conditional branch for this case.
        if (cancelled) return;
        // Invoke helper or pass arguments.
        setCount(res.count);
        // Arrow function / callback body.
        setCodes(res.sectors.map((s) => s.code));
      })
      // Arrow function / callback body.
      .catch(() => {
        /* keep AuthUser count if fetch fails */
      });
    // Return computed result to caller.
    return () => {
      // Assign value for subsequent use.
      cancelled = true;
    };
  // Close multi-line construct with trailing syntax.
  }, [user.role, user.employeeId]);

  // Permission gate: only supervisors see the scope hint.
  if (user.role !== "supervisor") return null;

  // Local constant binding.
  const n = count ?? 0;
  // Local constant binding.
  const label =
    // Assign value for subsequent use.
    locale === "en"
      // Invoke helper or pass arguments.
      ? `Scope: your sectors (${n})`
      // Invoke helper or pass arguments.
      : `Обхват: вашите сектори (${n})`;
  // Prefer live codes; fall back to empty-state copy when none assigned.
  const detail =
    // Continue module logic.
    codes.length > 0
      // Invoke helper or pass arguments.
      ? codes.join(", ")
      // Assign value for subsequent use.
      : locale === "en"
        // Continue module logic.
        ? "No sectors assigned as primary supervisor"
        // Continue module logic.
        : "Няма сектори с вас като основен супервайзър";

  // Return computed result to caller.
  return (
    // Render JSX element.
    <p className="muted small scope-hint" role="status">
      // JSX expression container.
      {label} — {detail}
    // JSX element boundary.
    </p>
  );
}
