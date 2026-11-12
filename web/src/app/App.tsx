/**
 * Authenticated shell: sidebar / mobile nav, theme + logout controls, and the
 * active panel. Pre-auth routes (login, activate) are handled by
 * `AppRouting` before this shell renders.
 */
import { useCallback, useEffect, useState } from "react";
// Import module dependency from ../components/BrandMark.
import { BrandMark } from "../components/BrandMark";
// Import module dependency from ../components/NotificationInbox.
import { NotificationInbox } from "../components/NotificationInbox";
// Import module dependency used by this file.
import {
  // List item in import/export/params.
  logout,
  // List item in import/export/params.
  logoutAll,
  // List item in import/export/params.
  ROLE_LABELS,
  // Declare type alias Panel.
  type Panel,
// Support the surrounding logic for this step.
} from "../api/client";
// Import type-only dependency for typing without runtime cost.
import type { BoardFocus } from "./boardFocus";
// Import module dependency from ./NavIcon.
import { NavIcon } from "./NavIcon";
// Import module dependency from ./routing.
import { ActivePanel, AppRouting } from "./routing";
// Import module dependency from ./useAuthBootstrap.
import { useAuthBootstrap } from "./useAuthBootstrap";

/** Bilingual / lookup table `PANEL_LABELS_BG` (data only). */
const PANEL_LABELS_BG: Record<Panel, string> = {
  // Provide mywork field/parameter used by this structure.
  mywork: "Моите задачи",
  // Provide repairs field/parameter used by this structure.
  repairs: "Повреди",
  // Provide home field/parameter used by this structure.
  home: "Начало",
  // Provide rooms field/parameter used by this structure.
  rooms: "Стаи",
  // Provide common field/parameter used by this structure.
  common: "Общи части",
  // Provide team field/parameter used by this structure.
  team: "Екип",
  // Provide live field/parameter used by this structure.
  live: "На живо",
  // Provide plan field/parameter used by this structure.
  plan: "План",
  // Provide attendance field/parameter used by this structure.
  attendance: "Присъствие",
  // Provide cards field/parameter used by this structure.
  cards: "Карти",
  // Provide results field/parameter used by this structure.
  results: "Резултати",
  // Provide analytics field/parameter used by this structure.
  analytics: "Аналитика",
  // Provide cleaning field/parameter used by this structure.
  cleaning: "Почистване",
  // Provide audit field/parameter used by this structure.
  audit: "Одит",
  // Provide control field/parameter used by this structure.
  control: "Контрол",
  // Provide settings field/parameter used by this structure.
  settings: "Настройки",
  // Provide permissions field/parameter used by this structure.
  permissions: "Права",
  // Provide notifications field/parameter used by this structure.
  notifications: "Известия",
};

/** Bilingual / lookup table `PANEL_LABELS_EN` (data only). */
const PANEL_LABELS_EN: Record<Panel, string> = {
  // Provide mywork field/parameter used by this structure.
  mywork: "My Work",
  // Provide repairs field/parameter used by this structure.
  repairs: "Repairs",
  // Provide home field/parameter used by this structure.
  home: "Home",
  // Provide rooms field/parameter used by this structure.
  rooms: "Rooms",
  // Provide common field/parameter used by this structure.
  common: "Common",
  // Provide team field/parameter used by this structure.
  team: "Team",
  // Provide live field/parameter used by this structure.
  live: "Live",
  // Provide plan field/parameter used by this structure.
  plan: "Plan",
  // Provide attendance field/parameter used by this structure.
  attendance: "Attendance",
  // Provide cards field/parameter used by this structure.
  cards: "Cards",
  // Provide results field/parameter used by this structure.
  results: "Results",
  // Provide analytics field/parameter used by this structure.
  analytics: "Analytics",
  // Provide cleaning field/parameter used by this structure.
  cleaning: "Housekeeping",
  // Provide audit field/parameter used by this structure.
  audit: "Audit",
  // Provide control field/parameter used by this structure.
  control: "Control",
  // Provide settings field/parameter used by this structure.
  settings: "Settings",
  // Provide permissions field/parameter used by this structure.
  permissions: "Permissions",
  // Provide notifications field/parameter used by this structure.
  notifications: "Notifications",
};

/** Root authenticated shell; pre-auth gates live in `AppRouting`. */
export default function App() {
  // Bind a local value for the following logic.
  const {
    // List item in import/export/params.
    user,
    // List item in import/export/params.
    setUser,
    // List item in import/export/params.
    signedIn,
    // List item in import/export/params.
    setSignedIn,
    // List item in import/export/params.
    authReady,
    // List item in import/export/params.
    setAuthEpoch,
    // List item in import/export/params.
    view,
    // List item in import/export/params.
    setView,
    // List item in import/export/params.
    theme,
    // List item in import/export/params.
    publicSettings,
    // List item in import/export/params.
    panels,
    // List item in import/export/params.
    navPanels,
    // List item in import/export/params.
    locale,
    // List item in import/export/params.
    onToggleTheme,
  // Support the surrounding logic for this step.
  } = useAuthBootstrap();

  // Local React state.
  const [navOpen, setNavOpen] = useState(false);
  // React state slot for local UI/data that can change over time.
  const [signOutError, setSignOutError] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [boardFocus, setBoardFocus] = useState<BoardFocus | null>(null);
  // Run side effects after render when dependencies change.
  useEffect(() => { if (user) setSignOutError(null); }, [user?.id]);
  // Locale-driven sidebar labels (BG default, EN when settings say so).
  const panelLabels = locale === "en" ? PANEL_LABELS_EN : PANEL_LABELS_BG;

  // Memoize callback identity for stable child/effect deps.
  const onNavigateToFocus = useCallback(
    // Support the surrounding logic for this step.
    (panel: Panel, focus?: BoardFocus | null) => {
      // Conditional branch for the case described by this guard.
      if (!panels.includes(panel)) return;
      // Update React state so the UI reflects the new value.
      setBoardFocus(focus ?? null);
      // Update React state so the UI reflects the new value.
      setView(panel);
    },
    // Support the surrounding logic for this step.
    [panels, setView],
  );
  // Memoize callback identity for stable child/effect deps.
  const onBoardFocusConsumed = useCallback(() => setBoardFocus(null), []);

  // Close the mobile drawer whenever the active panel changes.
  useEffect(() => {
    // Update React state so the UI reflects the new value.
    setNavOpen(false);
  // Support the surrounding logic for this step.
  }, [view]);

  // Return value / early exit.
  return (
    // Render UI node.
    <>
    // Support the surrounding logic for this step.
    {signOutError && <p role="alert" className="error">{signOutError}</p>}
    // Render AppRouting as part of this view composition.
    <AppRouting
      // Pass authReady prop/value into the element or config.
      authReady={authReady}
      // Pass signedIn prop/value into the element or config.
      signedIn={signedIn}
      // Pass user prop/value into the element or config.
      user={user}
      // Pass theme prop/value into the element or config.
      theme={theme}
      // Pass onToggleTheme prop/value into the element or config.
      onToggleTheme={onToggleTheme}
      // Pass setUser prop/value into the element or config.
      setUser={setUser}
      // Pass setSignedIn prop/value into the element or config.
      setSignedIn={setSignedIn}
      // Pass setView prop/value into the element or config.
      setView={setView}
      // Pass setAuthEpoch prop/value into the element or config.
      setAuthEpoch={setAuthEpoch}
    >
      {/* Shell only mounts once bootstrap has a signed-in user. */}
      {user && (
        // Render UI node.
        <div
          // Pass className prop/value into the element or config.
          className={`app-shell${navOpen ? " nav-open" : ""}${
            // Support the surrounding logic for this step.
            publicSettings?.interface.density === "compact"
              // Support the surrounding logic for this step.
              ? " density-compact"
              // Support the surrounding logic for this step.
              : ""
          // Support the surrounding logic for this step.
          }`}
        >
          {/* Mobile overlay — tap outside to close the drawer. */}
          {navOpen && (
            // Render UI node.
            <button
              // Declare a type alias.
              type="button"
              // Pass className prop/value into the element or config.
              className="sidebar-backdrop"
              // Set accessibility attribute for assistive tech.
              aria-label="Close navigation"
              // Pass onClick prop/value into the element or config.
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
                  // Pass key prop/value into the element or config.
                  key={panel}
                  // Declare a type alias.
                  type="button"
                  // Pass className prop/value into the element or config.
                  className={view === panel ? "nav-tab active" : "nav-tab"}
                  // Pass onClick prop/value into the element or config.
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
                  // Pass locale prop/value into the element or config.
                  locale={locale}
                  // Pass active prop/value into the element or config.
                  active={view === "notifications"}
                  // Pass onOpen prop/value into the element or config.
                  onOpen={() => setView("notifications")}
                />
              </div>
              <div className="sidebar-actions">
                <button type="button" className="ghost" onClick={onToggleTheme}>
                  {theme === "dark" ? "Light" : "Dark"}
                </button>
                <button
                  // Declare a type alias.
                  type="button"
                  // Pass className prop/value into the element or config.
                  className="ghost"
                  // Pass onClick prop/value into the element or config.
                  onClick={() => {
                    // Clear cookies + local cache, then re-bootstrap as logged out.
                    void logout().finally(() => {
                      // State transition.
                      setSignedIn(false);
                      // State transition.
                      setUser(null);
                      // State transition.
                      setAuthEpoch((n) => n + 1);
                    });
                  }}
                >
                  Log out
                </button>
                <button
                  // Declare a type alias.
                  type="button"
                  // Pass className prop/value into the element or config.
                  className="ghost"
                  // Pass title prop/value into the element or config.
                  title="Revoke all sessions on all devices"
                  // Pass onClick prop/value into the element or config.
                  onClick={() => {
                    // Revoke every device session, then same local wipe as logout.
                    void logoutAll().then(() => {
                      // State transition.
                      setSignedIn(false);
                      // State transition.
                      setUser(null);
                      // State transition.
                      setAuthEpoch((n) => n + 1);
                    }).catch(() => {
                      setSignedIn(false);
                      setUser(null);
                      // Do not bootstrap with credentials whose global revoke
                      // failed. Local private data has already been purged.
                      setSignOutError(locale === "bg"
                        ? "Не успяхме да потвърдим излизането от всички устройства. Локалните данни са почистени."
                        : "Could not confirm sign out on all devices. Local data has been cleared.");
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
                  // Pass locale prop/value into the element or config.
                  locale={locale}
                  // Pass active prop/value into the element or config.
                  active={view === "notifications"}
                  // Pass onOpen prop/value into the element or config.
                  onOpen={() => {
                    // State transition.
                    setView("notifications");
                    // State transition.
                    setNavOpen(false);
                  }}
                />
                <button
                  // Declare a type alias.
                  type="button"
                  // Pass className prop/value into the element or config.
                  className="ghost"
                  // Set accessibility attribute for assistive tech.
                  aria-expanded={navOpen}
                  // Set accessibility attribute for assistive tech.
                  aria-label="Open navigation"
                  // Pass onClick prop/value into the element or config.
                  onClick={() => setNavOpen((open) => !open)}
                >
                  Menu
                </button>
              </div>
            </div>

            <div key={view} className="page-enter">
              <ActivePanel
                // Pass view prop/value into the element or config.
                view={view}
                // Pass user prop/value into the element or config.
                user={user}
                // Pass locale prop/value into the element or config.
                locale={locale}
                // Pass publicSettings prop/value into the element or config.
                publicSettings={publicSettings}
                // Pass panels prop/value into the element or config.
                panels={panels}
                // Pass setView prop/value into the element or config.
                setView={setView}
                // Pass setUser prop/value into the element or config.
                setUser={setUser}
                // Pass boardFocus prop/value into the element or config.
                boardFocus={boardFocus}
                // Pass onBoardFocusConsumed prop/value into the element or config.
                onBoardFocusConsumed={onBoardFocusConsumed}
                // Pass onNavigateToFocus prop/value into the element or config.
                onNavigateToFocus={onNavigateToFocus}
              />
            </div>
          </div>
        </div>
      )}
    </AppRouting>
    </>
  );
}
