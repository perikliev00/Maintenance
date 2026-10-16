/**
 * Pre-shell routing via location hash, plus panel switcher for the shell.
 *
 * Hash routes: `#/activate` (invite), `#/room-qr/:token` (scan deep-link).
 * Until `authReady`, render nothing to avoid a login flash over a valid cookie.
 */
import { useEffect, useState, type ReactNode } from "react";
import { LoginPage } from "../pages/LoginPage";
import { ActivatePage } from "../pages/ActivatePage";
import { HomePage } from "../pages/HomePage";
import { MyWorkPage } from "../pages/MyWorkPage";
import { RepairsPage } from "../pages/RepairsPage";
import { AuditPage } from "../pages/AuditPage";
import { RoomsPage } from "../pages/RoomsPage";
import { CommonAreasPage } from "../pages/CommonAreasPage";
import { TeamPage } from "../pages/TeamPage";
import { ControlPage } from "../pages/ControlPage";
import { SettingsPage } from "../pages/SettingsPage";
import { PermissionsPage } from "../pages/PermissionsPage";
import { ResultsPage } from "../pages/ResultsPage";
import { AnalyticsPage } from "../pages/AnalyticsPage";
import { PlanPage } from "../pages/PlanPage";
import { LiveBoardPage } from "../pages/LiveBoardPage";
import { AttendancePage } from "../pages/AttendancePage";
import { CardsPage } from "../pages/CardsPage";
import { HousekeepingPage } from "../pages/HousekeepingPage";
import { NotificationsPage } from "../pages/NotificationsPage";
import { RoomQrPage } from "../pages/RoomQrPage";
import {
  landingForUser,
  type AuthUser,
  type Panel,
  type PublicSettings,
} from "../api/client";
import type { ThemeMode } from "../theme";

type AppRoutingProps = {
  authReady: boolean;
  signedIn: boolean;
  user: AuthUser | null;
  theme: ThemeMode;
  onToggleTheme: () => void;
  setUser: (user: AuthUser | null) => void;
  setSignedIn: (signedIn: boolean) => void;
  setView: (view: Panel) => void;
  setAuthEpoch: (updater: (n: number) => number) => void;
  children: ReactNode;
};

/** Gate login / activate / room-QR before rendering the authenticated shell. */
export function AppRouting({
  authReady,
  signedIn,
  user,
  theme,
  onToggleTheme,
  setUser,
  setSignedIn,
  setView,
  setAuthEpoch,
  children,
}: AppRoutingProps) {
  // Local React state.
  const [hash, setHash] = useState(
    () => (typeof window !== "undefined" ? window.location.hash : ""),
  );

  // Effect: sync props/state to side effects.
  useEffect(() => {
    /**
     * Handler `onHash` for UI or form events.
     */
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    // Return value / early exit.
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Hash deep-links checked before the authenticated shell.
  const isActivateRoute = hash.startsWith("#/activate");
  const roomQrMatch = hash.match(/^#\/room-qr\/([^/?#]+)/);
  const roomQrToken = roomQrMatch?.[1]
    ? decodeURIComponent(roomQrMatch[1])
    : null;

  // Avoid login flash while bootstrap is still resolving cookies.
  if (!authReady) {
    // Return value / early exit.
    return null;
  }

  // Invite redeem — only when not already signed in.
  if (isActivateRoute && (!signedIn || !user)) {
    // Return value / early exit.
    return (
      <ActivatePage
        theme={theme}
        onToggleTheme={onToggleTheme}
        onBackToLogin={() => {
          window.location.hash = "";
        }}
        onActivated={(nextUser) => {
          // Clear hash, bind identity, land on role home, re-bootstrap.
          window.location.hash = "";
          // State transition.
          setUser(nextUser);
          // State transition.
          setSignedIn(true);
          // State transition.
          setView(landingForUser(nextUser));
          // State transition.
          setAuthEpoch((n) => n + 1);
        }}
      />
    );
  }

  // Unauthenticated → login.
  if (!signedIn || !user) {
    // Return value / early exit.
    return (
      <LoginPage
        theme={theme}
        onToggleTheme={onToggleTheme}
        onLogin={(nextUser) => {
          // State transition.
          setUser(nextUser);
          // State transition.
          setSignedIn(true);
          // State transition.
          setView(landingForUser(nextUser));
          // State transition.
          setAuthEpoch((n) => n + 1);
        }}
      />
    );
  }

  // QR deep-link overlays the shell (signed-in scan flow).
  if (roomQrToken) {
    // Return value / early exit.
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

  // Authenticated shell (sidebar + ActivePanel) from App.tsx.
  return children;
}

type ActivePanelProps = {
  view: Panel;
  user: AuthUser;
  locale: "bg" | "en";
  publicSettings: PublicSettings | null;
  panels: Panel[];
  setView: (view: Panel) => void;
  setUser: (user: AuthUser) => void;
};

/** Mount the page component for the current nav panel. */
export function ActivePanel({
  view,
  user,
  locale,
  publicSettings,
  panels,
  setView,
  setUser,
}: ActivePanelProps) {
  // Return value / early exit.
  return (
    <>
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
      {view === "notifications" && (
        <NotificationsPage
          locale={locale}
          onNavigate={(panel) => {
            // Branch: conditional gate.
            if (panels.includes(panel)) setView(panel);
          }}
        />
      )}
    </>
  );
}
