/**
 * Staff access-card list, filters, and revoke.
 * Loading is independent of the issue wizard so revoke never freezes issue UI.
 */
import { useCallback, useEffect, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  fetchCards,
  // Support the surrounding logic for this step.
  revokeCard,
  // Declare type alias AccessCard.
  type AccessCard,
  // Declare type alias CardStatus.
  type CardStatus,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ../../i18n.
import { t } from "../../i18n";

// Export type definition for consumers of this module.
export type UseStaffCardsOptions = {
  // Provide locale field used by this structure.
  locale: "bg" | "en";
  // Provide canRevoke field used by this structure.
  canRevoke: boolean;
  /** Staff list loads only while this tab is active. */
  active: boolean;
  // Provide setError field used by this structure.
  setError: (message: string | null) => void;
  // Provide setMessage field used by this structure.
  setMessage: (message: string | null) => void;
};

// Export function useStaffCards as part of this module's API.
export function useStaffCards({
  // Support the surrounding logic for this step.
  locale,
  // Support the surrounding logic for this step.
  canRevoke,
  // Support the surrounding logic for this step.
  active,
  // Support the surrounding logic for this step.
  setError,
  // Support the surrounding logic for this step.
  setMessage,
// Support the surrounding logic for this step.
}: UseStaffCardsOptions) {
  // React state slot for local UI/data that can change over time.
  const [staffCards, setStaffCards] = useState<AccessCard[]>([]);
  // React state slot for local UI/data that can change over time.
  const [staffQ, setStaffQ] = useState("");
  // React state slot for local UI/data that can change over time.
  const [staffStatus, setStaffStatus] = useState<"" | CardStatus>("");
  // React state slot for local UI/data that can change over time.
  const [loading, setLoading] = useState(false);
  // React state slot for local UI/data that can change over time.
  const [revoking, setRevoking] = useState(false);

  // Memoize callback identity for stable child/effect deps.
  const loadStaffCards = useCallback(async () => {
    // Bind cards for use in the following logic.
    const cards = await fetchCards({
      // Provide staffOnly field used by this structure.
      staffOnly: true,
      // Provide q field used by this structure.
      q: staffQ.trim() || undefined,
      // Provide status field used by this structure.
      status: staffStatus || undefined,
    });
    // Update React state so the UI reflects the new value.
    setStaffCards(cards);
  // Support the surrounding logic for this step.
  }, [staffQ, staffStatus]);

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Conditional branch for the case described by this guard.
    if (!active) return;
    // Support the surrounding logic for this step.
    (async () => {
      // Begin guarded block to catch runtime failures.
      try {
        // Update React state so the UI reflects the new value.
        setLoading(true);
        // Update React state so the UI reflects the new value.
        setError(null);
        // Wait for an async operation before continuing.
        await loadStaffCards();
      // Support the surrounding logic for this step.
      } catch (err) {
        // Update React state so the UI reflects the new value.
        setError(
          // Support the surrounding logic for this step.
          err instanceof Error
            // Support the surrounding logic for this step.
            ? err.message
            // Support the surrounding logic for this step.
            : t(locale, "Грешка при зареждане", "Failed to load"),
        );
      // Support the surrounding logic for this step.
      } finally {
        // Update React state so the UI reflects the new value.
        setLoading(false);
      }
    // Support the surrounding logic for this step.
    })();
  // Support the surrounding logic for this step.
  }, [active, loadStaffCards, locale, setError]);

  // Define function onRevoke and its behavior.
  async function onRevoke(id: string) {
    // Conditional branch for the case described by this guard.
    if (!canRevoke) return;
    // Begin guarded block to catch runtime failures.
    try {
      // Update React state so the UI reflects the new value.
      setRevoking(true);
      // Update React state so the UI reflects the new value.
      setError(null);
      // Wait for an async operation before continuing.
      await revokeCard(id);
      // Wait for an async operation before continuing.
      await loadStaffCards();
      // Update React state so the UI reflects the new value.
      setMessage(
        // Invoke t to perform this step.
        t(locale, "Картата е отменена в системата", "Card revoked in the system"),
      );
    // Support the surrounding logic for this step.
    } catch (err) {
      // Update React state so the UI reflects the new value.
      setError(
        // Support the surrounding logic for this step.
        err instanceof Error
          // Support the surrounding logic for this step.
          ? err.message
          // Support the surrounding logic for this step.
          : t(locale, "Неуспешна отмяна", "Revoke failed"),
      );
    // Support the surrounding logic for this step.
    } finally {
      // Update React state so the UI reflects the new value.
      setRevoking(false);
    }
  }

  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    staffCards,
    // Support the surrounding logic for this step.
    staffQ,
    // Support the surrounding logic for this step.
    setStaffQ,
    // Support the surrounding logic for this step.
    staffStatus,
    // Support the surrounding logic for this step.
    setStaffStatus,
    // Support the surrounding logic for this step.
    loading,
    // Support the surrounding logic for this step.
    revoking,
    // Provide busy field used by this structure.
    busy: loading || revoking,
    // Support the surrounding logic for this step.
    onRevoke,
  };
}
