import { useEffect, useState } from "react";
import { BrandMark } from "../components/BrandMark";
import { NotificationInbox } from "../components/NotificationInbox";
import {
  logout,
  logoutAll,
  ROLE_LABELS,
  type Panel,
} from "../api/client";
import { NavIcon } from "./NavIcon";
import { ActivePanel, AppRouting } from "./routing";
import { useAuthBootstrap } from "./useAuthBootstrap";

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
  notifications: "Известия",
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
  notifications: "Notifications",
};

export default function App() {
  const {
    user,
    setUser,
    signedIn,
    setSignedIn,
    authReady,
    setAuthEpoch,
    view,
    setView,
    theme,
    publicSettings,
    panels,
    navPanels,
    locale,
    onToggleTheme,
  } = useAuthBootstrap();

  const [navOpen, setNavOpen] = useState(false);
  const panelLabels = locale === "en" ? PANEL_LABELS_EN : PANEL_LABELS_BG;

  useEffect(() => {
    setNavOpen(false);
  }, [view]);

  return (
    <AppRouting
      authReady={authReady}
      signedIn={signedIn}
      user={user}
      theme={theme}
      onToggleTheme={onToggleTheme}
      setUser={setUser}
      setSignedIn={setSignedIn}
      setView={setView}
      setAuthEpoch={setAuthEpoch}
    >
      {user && (
        <div
          className={`app-shell${navOpen ? " nav-open" : ""}${
            publicSettings?.interface.density === "compact"
              ? " density-compact"
              : ""
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
              {navPanels.map((panel) => (
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
              <div className="sidebar-user-row">
                <div className="sidebar-user">
                  <strong>{user.fullName}</strong>
                  <span>{ROLE_LABELS[user.role] ?? user.role}</span>
                </div>
                <NotificationInbox
                  locale={locale}
                  active={view === "notifications"}
                  onOpen={() => setView("notifications")}
                />
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
              <div className="mobile-bar-actions">
                <NotificationInbox
                  locale={locale}
                  active={view === "notifications"}
                  onOpen={() => {
                    setView("notifications");
                    setNavOpen(false);
                  }}
                />
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
            </div>

            <div key={view} className="page-enter">
              <ActivePanel
                view={view}
                user={user}
                locale={locale}
                publicSettings={publicSettings}
                panels={panels}
                setView={setView}
                setUser={setUser}
              />
            </div>
          </div>
        </div>
      )}
    </AppRouting>
  );
}
