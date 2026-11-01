/**
 * Pre-shell routing via location hash, plus panel switcher for the shell.
 *
 * Hash routes: `#/activate` (invite redeem). Legacy `#/room-qr/...` is cleared.
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

/** Gate login / activate before rendering the authenticated shell. */
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

  // Clear retired room-QR deep links so old stickers land on the normal shell.
  useEffect(() => {
    if (hash.startsWith("#/room-qr/")) {
      window.location.hash = "";
    }
  }, [hash]);

  // Hash deep-links checked before the authenticated shell.
  const isActivateRoute = hash.startsWith("#/activate");

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
  boardFocus: import("./boardFocus").BoardFocus | null;
  onBoardFocusConsumed: () => void;
  onNavigateToFocus: import("./boardFocus").NavigateToFocus;
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
  boardFocus,
  onBoardFocusConsumed,
  onNavigateToFocus,
}: ActivePanelProps) {
  const locationFocus =
    boardFocus?.type === "location" ? boardFocus : null;
  const ticketFocus =
    boardFocus?.type === "ticket" ? boardFocus : null;

  return (
    <>
      {view === "mywork" && (
        <MyWorkPage user={user} locale={locale} />
      )}
      {view === "repairs" && (
        <RepairsPage
          user={user}
          locale={locale}
          focusTicketId={
            ticketFocus && view === "repairs" ? ticketFocus.ticketId : null
          }
          onFocusConsumed={onBoardFocusConsumed}
        />
      )}
      {view === "audit" && (
        <AuditPage user={user} locale={locale} />
      )}
      {view === "home" && <HomePage user={user} locale={locale} />}
      {view === "rooms" && (
        <RoomsPage
          user={user}
          publicSettings={publicSettings}
          locale={locale}
          focusLocationId={
            locationFocus && locationFocus.locationKind === "room"
              ? locationFocus.locationId
              : null
          }
          focusTaskId={
            locationFocus && locationFocus.locationKind === "room"
              ? locationFocus.taskId ?? null
              : null
          }
          focusSessionId={
            locationFocus && locationFocus.locationKind === "room"
              ? locationFocus.sessionId ?? null
              : null
          }
          onFocusConsumed={onBoardFocusConsumed}
        />
      )}
      {view === "common" && (
        <CommonAreasPage
          user={user}
          publicSettings={publicSettings}
          locale={locale}
          focusLocationId={
            locationFocus && locationFocus.locationKind === "common_area"
              ? locationFocus.locationId
              : null
          }
          focusTaskId={
            locationFocus && locationFocus.locationKind === "common_area"
              ? locationFocus.taskId ?? null
              : null
          }
          focusSessionId={
            locationFocus && locationFocus.locationKind === "common_area"
              ? locationFocus.sessionId ?? null
              : null
          }
          onFocusConsumed={onBoardFocusConsumed}
        />
      )}
      {view === "team" && <TeamPage user={user} locale={locale} />}
      {view === "live" && (
        <LiveBoardPage
          user={user}
          locale={locale}
          modules={publicSettings?.modules ?? null}
          onNavigate={onNavigateToFocus}
        />
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
            if (panels.includes(panel)) setView(panel);
          }}
        />
      )}
    </>
  );
}
