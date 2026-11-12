/**
 * Staff access-card list, filters, and revoke.
 * Loading is independent of the issue wizard so revoke never freezes issue UI.
 */
import { useCallback, useEffect, useState } from "react";
import {
  fetchCards,
  revokeCard,
  type AccessCard,
  type CardStatus,
} from "../../api/client";
import { t } from "../../i18n";

export type UseStaffCardsOptions = {
  locale: "bg" | "en";
  canRevoke: boolean;
  /** Staff list loads only while this tab is active. */
  active: boolean;
  setError: (message: string | null) => void;
  setMessage: (message: string | null) => void;
};

// Export function useStaffCards as part of this module's API.
export function useStaffCards({
  locale,
  canRevoke,
  active,
  setError,
  setMessage,
}: UseStaffCardsOptions) {
  const [staffCards, setStaffCards] = useState<AccessCard[]>([]);
  const [staffQ, setStaffQ] = useState("");
  const [staffStatus, setStaffStatus] = useState<"" | CardStatus>("");
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const loadStaffCards = useCallback(async () => {
    const cards = await fetchCards({
      staffOnly: true,
      q: staffQ.trim() || undefined,
      status: staffStatus || undefined,
    });
    setStaffCards(cards);
  }, [staffQ, staffStatus]);

  useEffect(() => {
    if (!active) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await loadStaffCards();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t(locale, "Грешка при зареждане", "Failed to load"),
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [active, loadStaffCards, locale, setError]);

  // Define function onRevoke and its behavior.
  async function onRevoke(id: string) {
    if (!canRevoke) return;
    try {
      setRevoking(true);
      setError(null);
      await revokeCard(id);
      await loadStaffCards();
      setMessage(
        t(locale, "Картата е отменена в системата", "Card revoked in the system"),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t(locale, "Неуспешна отмяна", "Revoke failed"),
      );
    } finally {
      setRevoking(false);
    }
  }

  return {
    staffCards,
    staffQ,
    setStaffQ,
    staffStatus,
    setStaffStatus,
    loading,
    revoking,
    busy: loading || revoking,
    onRevoke,
  };
}
