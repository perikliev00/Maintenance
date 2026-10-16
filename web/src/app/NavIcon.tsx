/** Inline SVG icons for sidebar / mobile nav tabs (decorative, aria-hidden). */
import type { Panel } from "../api/client";

/** Map a nav panel id to its decorative SVG glyph. */
export function NavIcon({ panel }: { panel: Panel }) {
  // Shared stroke attrs — each case only supplies paths/shapes.
  const common = {
    className: "nav-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  // One glyph per panel; TypeScript exhaustiveness covers all Panel keys.
  switch (panel) {
    // Checklist / clipboard — My Work queue.
    case "mywork":
      return (
        <svg {...common}>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      );
    // Wrench — maintenance / repairs board.
    case "repairs":
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-1.9-.5-.5-1.9 2.1-2.1Z" />
        </svg>
      );
    // Bullet list — audit log.
    case "audit":
      return (
        <svg {...common}>
          <path d="M8 6h11M8 12h11M8 18h11" />
          <path d="M4 6h.01M4 12h.01M4 18h.01" />
        </svg>
      );
    // House — home / overview.
    case "home":
      return (
        <svg {...common}>
          <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
        </svg>
      );
    // Floor plan box — guest rooms.
    case "rooms":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M4 10h16M10 10v9" />
        </svg>
      );
    // Building — common areas.
    case "common":
      return (
        <svg {...common}>
          <path d="M4 20V9l8-5 8 5v11" />
          <path d="M9 20v-6h6v6" />
          <path d="M4 9h16" />
        </svg>
      );
    // People — team roster.
    case "team":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <circle cx="16.5" cy="9" r="2.5" />
          <path d="M3.5 18.5c.8-2.6 2.8-4 5.5-4s4.7 1.4 5.5 4" />
          <path d="M14 14.5c1.7-.4 3.4.2 4.5 1.8" />
        </svg>
      );
    // Radar — operations live board.
    case "live":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="7" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
        </svg>
      );
    // Calendar — daily plan.
    case "plan":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v4M16 3v4M4 11h16" />
        </svg>
      );
    // Clock — attendance.
    case "attendance":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4.5l3 1.5" />
        </svg>
      );
    // Badge card — access cards.
    case "cards":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M3 10h18" />
        </svg>
      );
    // Bar chart — cleaning results.
    case "results":
      return (
        <svg {...common}>
          <path d="M4 19V5M4 19h16" />
          <path d="M8 16V10M12 16V7M16 16v-4" />
        </svg>
      );
    // Trend line — analytics KPIs.
    case "analytics":
      return (
        <svg {...common}>
          <path d="M4 19h16" />
          <path d="M7 16l3-5 3 3 4-7" />
        </svg>
      );
    // Broom / mop — cleaning ops.
    case "cleaning":
      return (
        <svg {...common}>
          <path d="M8 4h8l1 4H7l1-4Z" />
          <path d="M9 8v11a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V8" />
          <path d="M12 8v13" />
        </svg>
      );
    // Gear hub — control center.
    case "control":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
        </svg>
      );
    // Cog — settings.
    case "settings":
      return (
        <svg {...common}>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.1.7.7 1.2 1.5 1.3H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      );
    // Padlock — permissions matrix.
    case "permissions":
      return (
        <svg {...common}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          <circle cx="12" cy="16" r="1.2" />
        </svg>
      );
    // Bell — notifications inbox.
    case "notifications":
      return (
        <svg {...common}>
          <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" />
          <path d="M9.5 17a2.5 2.5 0 0 0 5 0" />
        </svg>
      );
  }
}
