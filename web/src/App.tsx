import { useEffect, useState } from "react";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";
import { RoomsPage } from "./pages/RoomsPage";
import { TeamPage } from "./pages/TeamPage";
import { ControlPage } from "./pages/ControlPage";
import { BrandMark } from "./components/BrandMark";
import {
  clearToken,
  fetchMe,
  getToken,
  getStoredUser,
  landingForUser,
  panelsForUser,
  ROLE_LABELS,
  type AuthUser,
  type Panel,
} from "./api/client";
import { applyTheme, getStoredTheme, toggleTheme, type ThemeMode } from "./theme";
import "./App.css";

const PANEL_LABELS: Record<Panel, string> = {
  home: "Home",
  rooms: "Rooms",
  team: "Team",
  control: "Control",
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
    case "team":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <circle cx="16.5" cy="9" r="2.5" />
          <path d="M3.5 18.5c.8-2.6 2.8-4 5.5-4s4.7 1.4 5.5 4" />
          <path d="M14 14.5c1.7-.4 3.4.2 4.5 1.8" />
        </svg>
      );
    case "control":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
        </svg>
      );
  }
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => getToken());
  const [view, setView] = useState<Panel>("home");
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setView((current) => {
          const panels = panelsForUser(me);
          if (panels.includes(current)) return current;
          return landingForUser(me);
        });
      })
      .catch(() => {
        if (cancelled) return;
        clearToken();
        setToken(null);
        setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!user) return;
    const panels = panelsForUser(user);
    if (!panels.includes(view)) {
      setView(landingForUser(user));
    }
  }, [user, view]);

  useEffect(() => {
    setNavOpen(false);
  }, [view]);

  function onToggleTheme() {
    setTheme((prev) => toggleTheme(prev));
  }

  if (!token || !user) {
    return (
      <LoginPage
        theme={theme}
        onToggleTheme={onToggleTheme}
        onLogin={(nextToken, nextUser) => {
          setToken(nextToken);
          setUser(nextUser);
          setView(landingForUser(nextUser));
        }}
      />
    );
  }

  const panels = panelsForUser(user);

  return (
    <div className={`app-shell${navOpen ? " nav-open" : ""}`}>
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
              {PANEL_LABELS[panel]}
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
                clearToken();
                setToken(null);
                setUser(null);
              }}
            >
              Log out
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
          {view === "home" && <HomePage user={user} />}
          {view === "rooms" && <RoomsPage user={user} />}
          {view === "team" && <TeamPage />}
          {view === "control" && <ControlPage user={user} />}
        </div>
      </div>
    </div>
  );
}
