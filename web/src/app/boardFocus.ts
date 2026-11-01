/**
 * Cross-panel deep-link focus from the live board (and similar sources).
 * Carries concrete entity ids — never room number alone.
 */
import type { Panel } from "../api/capabilities";

export type BoardFocus =
  | {
      type: "location";
      locationId: string;
      locationKind: "room" | "common_area";
      taskId?: string;
      sessionId?: string;
    }
  | {
      type: "ticket";
      ticketId: string;
      locationId?: string;
    };

export type NavigateToFocus = (panel: Panel, focus?: BoardFocus | null) => void;

/** Map location kind to the rooms/common panel. */
export function panelForLocationKind(
  kind: string,
): "rooms" | "common" {
  return kind === "common_area" ? "common" : "rooms";
}
