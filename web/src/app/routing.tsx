/**
 * Pre-shell routing via location hash, plus panel switcher for the shell.
 *
 * Hash routes: `#/activate` (invite redeem). Legacy `#/room-qr/...` is cleared.
 * Until `authReady`, render nothing to avoid a login flash over a valid cookie.
 * Authenticated panels are React.lazy so Vite can split page chunks.
 */
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
// Import module dependency from ../pages/LoginPage.
import { LoginPage } from "../pages/LoginPage";
// Import module dependency from ../pages/ActivatePage.
import { ActivatePage } from "../pages/ActivatePage";
// Import module dependency used by this file.
import {
  // List item in import/export/params.
  landingForUser,
  // Declare type alias AuthUser.
  type AuthUser,
  // Declare type alias Panel.
  type Panel,
  // Declare type alias PublicSettings.
  type PublicSettings,
// Support the surrounding logic for this step.
} from "../api/client";
// Import type-only dependency for typing without runtime cost.
import type { ThemeMode } from "../theme";

// Lazy-load this panel chunk so Vite can code-split pages.
const HomePage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/HomePage").then((m) => ({ default: m.HomePage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const MyWorkPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/myWork/MyWorkPage").then((m) => ({ default: m.MyWorkPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const RepairsPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/RepairsPage").then((m) => ({ default: m.RepairsPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const AuditPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/AuditPage").then((m) => ({ default: m.AuditPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const RoomsPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/RoomsPage").then((m) => ({ default: m.RoomsPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const CommonAreasPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/CommonAreasPage").then((m) => ({
    // Handle the default switch case.
    default: m.CommonAreasPage,
  // Support the surrounding logic for this step.
  })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const TeamPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/TeamPage").then((m) => ({ default: m.TeamPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const ControlPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/ControlPage").then((m) => ({ default: m.ControlPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const SettingsPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const PermissionsPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/PermissionsPage").then((m) => ({
    // Handle the default switch case.
    default: m.PermissionsPage,
  // Support the surrounding logic for this step.
  })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const ResultsPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/ResultsPage").then((m) => ({ default: m.ResultsPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const AnalyticsPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const PlanPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/PlanPage").then((m) => ({ default: m.PlanPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const LiveBoardPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/LiveBoardPage").then((m) => ({ default: m.LiveBoardPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const AttendancePage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/AttendancePage").then((m) => ({
    // Handle the default switch case.
    default: m.AttendancePage,
  // Support the surrounding logic for this step.
  })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const CardsPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/CardsPage").then((m) => ({ default: m.CardsPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const HousekeepingPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/HousekeepingPage").then((m) => ({
    // Handle the default switch case.
    default: m.HousekeepingPage,
  // Support the surrounding logic for this step.
  })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const NotificationsPage = lazy(() =>
  // Invoke import to perform this step.
  import("../pages/NotificationsPage").then((m) => ({
    // Handle the default switch case.
    default: m.NotificationsPage,
  // Support the surrounding logic for this step.
  })),
);

// Declare type alias AppRoutingProps.
type AppRoutingProps = {
  // Provide authReady field/parameter used by this structure.
  authReady: boolean;
  // Provide signedIn field/parameter used by this structure.
  signedIn: boolean;
  // Provide user field/parameter used by this structure.
  user: AuthUser | null;
  // Provide theme field/parameter used by this structure.
  theme: ThemeMode;
  // Provide onToggleTheme field/parameter used by this structure.
  onToggleTheme: () => void;
  // Provide setUser field/parameter used by this structure.
  setUser: (user: AuthUser | null) => void;
  // Provide setSignedIn field/parameter used by this structure.
  setSignedIn: (signedIn: boolean) => void;
  // Provide setView field/parameter used by this structure.
  setView: (view: Panel) => void;
  // Provide setAuthEpoch field/parameter used by this structure.
  setAuthEpoch: (updater: (n: number) => number) => void;
  // Provide children field/parameter used by this structure.
  children: ReactNode;
};

/** Gate login / activate before rendering the authenticated shell. */
export function AppRouting({
  // List item in import/export/params.
  authReady,
  // List item in import/export/params.
  signedIn,
  // List item in import/export/params.
  user,
  // List item in import/export/params.
  theme,
  // List item in import/export/params.
  onToggleTheme,
  // List item in import/export/params.
  setUser,
  // List item in import/export/params.
  setSignedIn,
  // List item in import/export/params.
  setView,
  // List item in import/export/params.
  setAuthEpoch,
  // List item in import/export/params.
  children,
// Support the surrounding logic for this step.
}: AppRoutingProps) {
  // React state slot for local UI/data that can change over time.
  const [hash, setHash] = useState(
    // Support the surrounding logic for this step.
    () => (typeof window !== "undefined" ? window.location.hash : ""),
  );

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Bind onHash for use in the following logic.
    const onHash = () => setHash(window.location.hash);
    // Invoke window.addEventListener to perform this step.
    window.addEventListener("hashchange", onHash);
    // Return early result or rendered output from this path.
    return () => window.removeEventListener("hashchange", onHash);
  // Support the surrounding logic for this step.
  }, []);

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Conditional branch for the case described by this guard.
    if (hash.startsWith("#/room-qr/")) {
      // Pass window.location.hash prop/value into the element or config.
      window.location.hash = "";
    }
  // Support the surrounding logic for this step.
  }, [hash]);

  // Bind isActivateRoute for use in the following logic.
  const isActivateRoute = hash.startsWith("#/activate");

  // Conditional branch for the case described by this guard.
  if (!authReady) {
    // Return early result or rendered output from this path.
    return null;
  }

  // Conditional branch for the case described by this guard.
  if (isActivateRoute && (!signedIn || !user)) {
    // Return the JSX/UI tree for this render path.
    return (
      // Render ActivatePage as part of this view composition.
      <ActivatePage
        // Pass theme prop/value into the element or config.
        theme={theme}
        // Pass onToggleTheme prop/value into the element or config.
        onToggleTheme={onToggleTheme}
        // Pass onBackToLogin prop/value into the element or config.
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
        // Pass theme prop/value into the element or config.
        theme={theme}
        // Pass onToggleTheme prop/value into the element or config.
        onToggleTheme={onToggleTheme}
        // Pass onLogin prop/value into the element or config.
        onLogin={(nextUser) => {
          setUser(nextUser);
          setSignedIn(true);
          setView(landingForUser(nextUser));
          setAuthEpoch((n) => n + 1);
        }}
      />
    );
  }

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

function PanelFallback() {
  return <p className="muted">…</p>;
}

/** Mount the page component for the current nav panel (lazy chunk). */
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

  let panel: ReactNode = null;
  if (view === "mywork") {
    panel = <MyWorkPage user={user} locale={locale} />;
  } else if (view === "repairs") {
    panel = (
      <RepairsPage
        // Pass user prop/value into the element or config.
        user={user}
        // Pass locale prop/value into the element or config.
        locale={locale}
        // Pass focusTicketId prop/value into the element or config.
        focusTicketId={
          // Support the surrounding logic for this step.
          ticketFocus && view === "repairs" ? ticketFocus.ticketId : null
        }
        // Pass onFocusConsumed prop/value into the element or config.
        onFocusConsumed={onBoardFocusConsumed}
      />
    );
  } else if (view === "audit") {
    panel = <AuditPage user={user} locale={locale} />;
  } else if (view === "home") {
    panel = <HomePage user={user} locale={locale} />;
  } else if (view === "rooms") {
    panel = (
      <RoomsPage
        // Pass user prop/value into the element or config.
        user={user}
        // Pass publicSettings prop/value into the element or config.
        publicSettings={publicSettings}
        // Pass locale prop/value into the element or config.
        locale={locale}
        // Pass focusLocationId prop/value into the element or config.
        focusLocationId={
          // Support the surrounding logic for this step.
          locationFocus && locationFocus.locationKind === "room"
            // Support the surrounding logic for this step.
            ? locationFocus.locationId
            // Support the surrounding logic for this step.
            : null
        }
        // Pass focusTaskId prop/value into the element or config.
        focusTaskId={
          // Support the surrounding logic for this step.
          locationFocus && locationFocus.locationKind === "room"
            // Support the surrounding logic for this step.
            ? locationFocus.taskId ?? null
            // Support the surrounding logic for this step.
            : null
        }
        // Pass focusSessionId prop/value into the element or config.
        focusSessionId={
          // Support the surrounding logic for this step.
          locationFocus && locationFocus.locationKind === "room"
            // Support the surrounding logic for this step.
            ? locationFocus.sessionId ?? null
            // Support the surrounding logic for this step.
            : null
        }
        // Pass onFocusConsumed prop/value into the element or config.
        onFocusConsumed={onBoardFocusConsumed}
      />
    );
  } else if (view === "common") {
    panel = (
      <CommonAreasPage
        // Pass user prop/value into the element or config.
        user={user}
        // Pass publicSettings prop/value into the element or config.
        publicSettings={publicSettings}
        // Pass locale prop/value into the element or config.
        locale={locale}
        // Pass focusLocationId prop/value into the element or config.
        focusLocationId={
          // Support the surrounding logic for this step.
          locationFocus && locationFocus.locationKind === "common_area"
            // Support the surrounding logic for this step.
            ? locationFocus.locationId
            // Support the surrounding logic for this step.
            : null
        }
        // Pass focusTaskId prop/value into the element or config.
        focusTaskId={
          // Support the surrounding logic for this step.
          locationFocus && locationFocus.locationKind === "common_area"
            // Support the surrounding logic for this step.
            ? locationFocus.taskId ?? null
            // Support the surrounding logic for this step.
            : null
        }
        // Pass focusSessionId prop/value into the element or config.
        focusSessionId={
          // Support the surrounding logic for this step.
          locationFocus && locationFocus.locationKind === "common_area"
            // Support the surrounding logic for this step.
            ? locationFocus.sessionId ?? null
            // Support the surrounding logic for this step.
            : null
        }
        // Pass onFocusConsumed prop/value into the element or config.
        onFocusConsumed={onBoardFocusConsumed}
      />
    );
  } else if (view === "team") {
    panel = <TeamPage user={user} locale={locale} />;
  } else if (view === "live") {
    panel = (
      <LiveBoardPage
        // Pass user prop/value into the element or config.
        user={user}
        // Pass locale prop/value into the element or config.
        locale={locale}
        // Pass modules prop/value into the element or config.
        modules={publicSettings?.modules ?? null}
        // Pass onNavigate prop/value into the element or config.
        onNavigate={onNavigateToFocus}
      />
    );
  } else if (view === "plan") {
    panel = <PlanPage user={user} />;
  } else if (view === "attendance") {
    panel = <AttendancePage user={user} />;
  } else if (view === "cards") {
    panel = <CardsPage user={user} locale={locale} />;
  } else if (view === "results") {
    panel = <ResultsPage />;
  } else if (view === "analytics") {
    panel = <AnalyticsPage locale={locale} />;
  } else if (view === "cleaning") {
    panel = <HousekeepingPage user={user} />;
  } else if (view === "control") {
    panel = <ControlPage user={user} />;
  } else if (view === "settings") {
    panel = <SettingsPage user={user} />;
  } else if (view === "permissions") {
    panel = (
      <PermissionsPage
        // Pass user prop/value into the element or config.
        user={user}
        // Pass onUserUpdated prop/value into the element or config.
        onUserUpdated={(me) => setUser(me)}
      />
    );
  } else if (view === "notifications") {
    panel = (
      <NotificationsPage
        // Pass locale prop/value into the element or config.
        locale={locale}
        // Pass onNavigate prop/value into the element or config.
        onNavigate={(panelName) => {
          if (panels.includes(panelName)) setView(panelName);
        }}
      />
    );
  }

  return <Suspense fallback={<PanelFallback />}>{panel}</Suspense>;
}
