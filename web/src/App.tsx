import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginPage } from "./pages/LoginPage";
import { ActivatePage } from "./pages/ActivatePage";
import { HomePage } from "./pages/HomePage";
import { MyWorkPage } from "./pages/MyWorkPage";
import { RepairsPage } from "./pages/RepairsPage";
import { AuditPage } from "./pages/AuditPage";
import { RoomsPage } from "./pages/RoomsPage";
import { CommonAreasPage } from "./pages/CommonAreasPage";
import { TeamPage } from "./pages/TeamPage";
import { ControlPage } from "./pages/ControlPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PermissionsPage } from "./pages/PermissionsPage";
import { ResultsPage } from "./pages/ResultsPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { PlanPage } from "./pages/PlanPage";
import { LiveBoardPage } from "./pages/LiveBoardPage";
import { AttendancePage } from "./pages/AttendancePage";
import { CardsPage } from "./pages/CardsPage";
import { HousekeepingPage } from "./pages/HousekeepingPage";
import { RoomQrPage } from "./pages/RoomQrPage";
import { BrandMark } from "./components/BrandMark";
import {
  clearSession,
  fetchMe,
  fetchPublicSettings,
  filterPanelsByModules,
  getStoredUser,
  landingForUser,
  logout,
  logoutAll,
  panelsForUser,
  ROLE_LABELS,
  type AuthUser,
  type Panel,
  type PublicSettings,
} from "./api/client";
import {
  applyTheme,
  getStoredTheme,
  hasUserThemePreference,
  toggleTheme,
  type ThemeMode,
} from "./theme";
import { useLiveRefresh } from "./hooks/useLiveRefresh";
import "./App.css";

const PANEL_LABELS_BG: Record<Panel, string> = {
  mywork: "Моите задачи",
  repairs: "Повреди",
  home: "Начало",
  rooms: "Стаи",
  common: "Общи части",
  team: "Екип",
  live: "На живо",
  plan: "План",
  attendance: "Присъствие",
  cards: "Карти",
  results: "Резултати",
  analytics: "Аналитика",
  cleaning: "Почистване",
  audit: "Одит",
  control: "Контрол",
  settings: "Настройки",
  permissions: "Права",
};

const PANEL_LABELS_EN: Record<Panel, string> = {
  mywork: "My Work",
  repairs: "Repairs",
  home: "Home",
  rooms: "Rooms",
  common: "Common",
  team: "Team",
  live: "Live",
  plan: "Plan",
  attendance: "Attendance",
  cards: "Cards",
  results: "Results",
  analytics: "Analytics",
  cleaning: "Housekeeping",
  audit: "Audit",
  control: "Control",
  settings: "Settings",
  permissions: "Permissions",
};

function NavIcon({ panel }: { panel: Panel }) {
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

  switch (panel) {
    case "mywork":
      return (
        <svg {...common}>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      );
    case "repairs":
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-1.9-.5-.5-1.9 2.1-2.1Z" />
        </svg>
      );
    case "audit":
      return (
        <svg {...common}>
          <path d="M8 6h11M8 12h11M8 18h11" />
          <path d="M4 6h.01M4 12h.01M4 18h.01" />
        </svg>
      );
    case "home":
      return (
        <svg {...common}>
          <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
        </svg>
      );
    case "rooms":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M4 10h16M10 10v9" />
        </svg>
      );
    case "common":
      return (
        <svg {...common}>
          <path d="M4 20V9l8-5 8 5v11" />
          <path d="M9 20v-6h6v6" />
          <path d="M4 9h16" />
        </svg>
      );
    case "team":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <circle cx="16.5" cy="9" r="2.5" />
          <path d="M3.5 18.5c.8-2.6 2.8-4 5.5-4s4.7 1.4 5.5 4" />
          <path d="M14 14.5c1.7-.4 3.4.2 4.5 1.8" />
        </svg>
      );
    case "live":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="7" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
        </svg>
      );
    case "plan":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v4M16 3v4M4 11h16" />
        </svg>
      );
    case "attendance":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4.5l3 1.5" />
        </svg>
      );
    case "cards":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M3 10h18" />
        </svg>
      );
    case "results":
      return (
        <svg {...common}>
          <path d="M4 19V5M4 19h16" />
          <path d="M8 16V10M12 16V7M16 16v-4" />
        </svg>
      );
    case "analytics":
      return (
        <svg {...common}>
          <path d="M4 19h16" />
          <path d="M7 16l3-5 3 3 4-7" />
        </svg>
      );
    case "cleaning":
      return (
        <svg {...common}>
          <path d="M8 4h8l1 4H7l1-4Z" />
          <path d="M9 8v11a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V8" />
          <path d="M12 8v13" />
        </svg>
      );
    case "control":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.1.7.7 1.2 1.5 1.3H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      );
    case "permissions":
      return (
        <svg {...common}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          <circle cx="12" cy="16" r="1.2" />
        </svg>
      );
  }
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [signedIn, setSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [view, setView] = useState<Panel>("home");
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [navOpen, setNavOpen] = useState(false);
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(
    null,
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [me, pub] = await Promise.all([fetchMe(), fetchPublicSettings()]);
        if (cancelled) return;
        setUser(me);
        setSignedIn(true);
        setPublicSettings(pub);
        if (!hasUserThemePreference()) {
          setTheme(pub.interface.defaultTheme);
        }
        document.documentElement.setAttribute(
          "data-density",
          pub.interface.density,
        );
        setView((current) => {
          const panels = filterPanelsByModules(
            panelsForUser(me),
            pub.modules,
          );
          if (panels.includes(current)) return current;
          const landing = landingForUser(me);
          return panels.includes(landing) ? landing : panels[0] ?? "home";
        });
      } catch {
        if (cancelled) return;
        clearSession();
        setSignedIn(false);
        setUser(null);
        setPublicSettings(null);
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authEpoch]);

  const refreshPublicSettings = useCallback(async () => {
    if (!signedIn) return;
    const [me, pub] = await Promise.all([fetchMe(), fetchPublicSettings()]);
    setUser(me);
    setPublicSettings(pub);
    if (!hasUserThemePreference()) {
      setTheme(pub.interface.defaultTheme);
    }
    document.documentElement.setAttribute(
      "data-density",
      pub.interface.density,
    );
  }, [signedIn]);

  useLiveRefresh(refreshPublicSettings, {
    enabled: Boolean(signedIn && user),
    eventTypes: ["settings.changed", "people.changed"],
  });

  const panels = useMemo(() => {
    if (!user) return [] as Panel[];
    return filterPanelsByModules(panelsForUser(user), publicSettings?.modules);
  }, [user, publicSettings]);

  const locale = publicSettings?.interface.locale ?? "bg";
  const panelLabels = locale === "en" ? PANEL_LABELS_EN : PANEL_LABELS_BG;

  useEffect(() => {
    if (!user) return;
    if (!panels.includes(view)) {
      const landing = landingForUser(user);
      setView(panels.includes(landing) ? landing : panels[0] ?? "home");
    }
  }, [user, view, panels]);

  useEffect(() => {
    setNavOpen(false);
  }, [view]);

  const [hash, setHash] = useState(
    () => (typeof window !== "undefined" ? window.location.hash : ""),
  );

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function onToggleTheme() {
    setTheme((prev) => toggleTheme(prev));
  }

  const isActivateRoute = hash.startsWith("#/activate");
  const roomQrMatch = hash.match(/^#\/room-qr\/([^/?#]+)/);
  const roomQrToken = roomQrMatch?.[1]
    ? decodeURIComponent(roomQrMatch[1])
    : null;

  if (!authReady) {
    return null;
  }

  if (isActivateRoute && (!signedIn || !user)) {
    return (
      <ActivatePage
        theme={theme}
        onToggleTheme={onToggleTheme}
        onBackToLogin={() => {
          window.location.hash = "";
        }}
        onActivated={(nextUser) => {
          window.location.hash = "";
          setUser(nextUser);
          setSignedIn(true);
          setView(landingForUser(nextUser));
          setAuthEpoch((n) => n + 1);
        }}
      />
    );
  }

  if (!signedIn || !user) {
    return (
      <LoginPage
        theme={theme}
        onToggleTheme={onToggleTheme}
        onLogin={(nextUser) => {
          setUser(nextUser);
          setSignedIn(true);
          setView(landingForUser(nextUser));
          setAuthEpoch((n) => n + 1);
        }}
      />
    );
  }

  if (roomQrToken) {
    return (
      <div className={`app-shell theme-${theme}`}>
        <RoomQrPage
          user={user}
          token={roomQrToken}
          onClose={() => {
            window.location.hash = "";
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`app-shell${navOpen ? " nav-open" : ""}${
        publicSettings?.interface.density === "compact" ? " density-compact" : ""
      }`}
    >
      {navOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}

      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandMark size={34} />
          <div className="sidebar-brand-text">
            <strong>Meridian</strong>
            <span>Maintenance</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          {panels.map((panel) => (
            <button
              key={panel}
              type="button"
              className={view === panel ? "nav-tab active" : "nav-tab"}
              onClick={() => setView(panel)}
            >
              <NavIcon panel={panel} />
              {panelLabels[panel]}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <strong>{user.fullName}</strong>
            <span>{ROLE_LABELS[user.role] ?? user.role}</span>
          </div>
          <div className="sidebar-actions">
            <button type="button" className="ghost" onClick={onToggleTheme}>
              {theme === "dark" ? "Light" : "Dark"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void logout().finally(() => {
                  setSignedIn(false);
                  setUser(null);
                  setAuthEpoch((n) => n + 1);
                });
              }}
            >
              Log out
            </button>
            <button
              type="button"
              className="ghost"
              title="Revoke all sessions on all devices"
              onClick={() => {
                void logoutAll().finally(() => {
                  setSignedIn(false);
                  setUser(null);
                  setAuthEpoch((n) => n + 1);
                });
              }}
            >
              Sign out everywhere
            </button>
          </div>
        </div>
      </aside>

      <div className="shell-main">
        <div className="mobile-bar">
          <div className="mobile-bar-brand">
            <BrandMark size={26} />
            Meridian
          </div>
          <button
            type="button"
            className="ghost"
            aria-expanded={navOpen}
            aria-label="Open navigation"
            onClick={() => setNavOpen((open) => !open)}
          >
            Menu
          </button>
        </div>

        <div key={view} className="page-enter">
          {view === "mywork" && (
            <MyWorkPage user={user} locale={locale} />
          )}
          {view === "repairs" && (
            <RepairsPage user={user} locale={locale} />
          )}
          {view === "audit" && (
            <AuditPage user={user} locale={locale} />
          )}
          {view === "home" && <HomePage user={user} />}
          {view === "rooms" && (
            <RoomsPage
              user={user}
              publicSettings={publicSettings}
            />
          )}
          {view === "common" && (
            <CommonAreasPage
              user={user}
              publicSettings={publicSettings}
            />
          )}
          {view === "team" && <TeamPage user={user} />}
          {view === "live" && (
            <LiveBoardPage user={user} locale={locale} />
          )}
          {view === "plan" && <PlanPage user={user} />}
          {view === "attendance" && <AttendancePage user={user} />}
          {view === "cards" && <CardsPage user={user} />}
          {view === "results" && <ResultsPage />}
          {view === "analytics" && <AnalyticsPage />}
          {view === "cleaning" && <HousekeepingPage user={user} />}
          {view === "control" && <ControlPage user={user} />}
          {view === "settings" && <SettingsPage user={user} />}
          {view === "permissions" && (
            <PermissionsPage
              user={user}
              onUserUpdated={(me) => setUser(me)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
