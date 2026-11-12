/**
 * Cross-panel deep-link focus from the live board (and similar sources).
 * Carries concrete entity ids — never room number alone.
 */
import type { Panel } from "../api/capabilities";

// Discriminated union of board deep-link payloads (location vs ticket).
export type BoardFocus =
  | {
      // Focus a room or common-area location on its panel.
      type: "location";
      // Stable location id used by the destination panel.
      locationId: string;
      // Distinguishes rooms vs common-area destination panels.
      locationKind: "room" | "common_area";
      // Optional cleaning task to highlight within the location.
      taskId?: string;
      // Optional cleaning session associated with the focus.
      sessionId?: string;
    }
  | {
      // Focus a maintenance ticket on the repairs panel.
      type: "ticket";
      // Stable ticket id used by the destination panel.
      ticketId: string;
      // Optional related location for contextual navigation.
      locationId?: string;
    };

// Callback signature for navigating to a panel with optional focus payload.
export type NavigateToFocus = (panel: Panel, focus?: BoardFocus | null) => void;

/** Map location kind to the rooms/common panel. */
export function panelForLocationKind(
  kind: string,
): "rooms" | "common" {
  // Common areas open the common panel; everything else opens rooms.
  return kind === "common_area" ? "common" : "rooms";
}
