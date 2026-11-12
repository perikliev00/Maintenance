/**
 * Pre-shell routing via location hash, plus panel switcher for the shell.
 *
 * Hash routes: `#/activate` (invite redeem). Legacy `#/room-qr/...` is cleared.
 * Until `authReady`, render nothing to avoid a login flash over a valid cookie.
 * Authenticated panels are React.lazy so Vite can split page chunks.
 */
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { LoginPage } from "../pages/LoginPage";
import { ActivatePage } from "../pages/ActivatePage";
import {
  landingForUser,
  type AuthUser,
  type Panel,
  type PublicSettings,
} from "../api/client";
import type { ThemeMode } from "../theme";

// Lazy-load this panel chunk so Vite can code-split pages.
const HomePage = lazy(() =>
  import("../pages/HomePage").then((m) => ({ default: m.HomePage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const MyWorkPage = lazy(() =>
  import("../pages/myWork/MyWorkPage").then((m) => ({ default: m.MyWorkPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const RepairsPage = lazy(() =>
  import("../pages/RepairsPage").then((m) => ({ default: m.RepairsPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const AuditPage = lazy(() =>
  import("../pages/AuditPage").then((m) => ({ default: m.AuditPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const RoomsPage = lazy(() =>
  import("../pages/RoomsPage").then((m) => ({ default: m.RoomsPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const CommonAreasPage = lazy(() =>
  import("../pages/CommonAreasPage").then((m) => ({
    // Handle the default switch case.
    default: m.CommonAreasPage,
  })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const TeamPage = lazy(() =>
  import("../pages/TeamPage").then((m) => ({ default: m.TeamPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const ControlPage = lazy(() =>
  import("../pages/ControlPage").then((m) => ({ default: m.ControlPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const SettingsPage = lazy(() =>
  import("../pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const PermissionsPage = lazy(() =>
  import("../pages/PermissionsPage").then((m) => ({
    // Handle the default switch case.
    default: m.PermissionsPage,
  })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const ResultsPage = lazy(() =>
  import("../pages/ResultsPage").then((m) => ({ default: m.ResultsPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const AnalyticsPage = lazy(() =>
  import("../pages/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const PlanPage = lazy(() =>
  import("../pages/PlanPage").then((m) => ({ default: m.PlanPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const LiveBoardPage = lazy(() =>
  import("../pages/LiveBoardPage").then((m) => ({ default: m.LiveBoardPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const AttendancePage = lazy(() =>
  import("../pages/AttendancePage").then((m) => ({
    // Handle the default switch case.
    default: m.AttendancePage,
  })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const CardsPage = lazy(() =>
  import("../pages/CardsPage").then((m) => ({ default: m.CardsPage })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const HousekeepingPage = lazy(() =>
  import("../pages/HousekeepingPage").then((m) => ({
    // Handle the default switch case.
    default: m.HousekeepingPage,
  })),
);
// Lazy-load this panel chunk so Vite can code-split pages.
const NotificationsPage = lazy(() =>
  import("../pages/NotificationsPage").then((m) => ({
    // Handle the default switch case.
    default: m.NotificationsPage,
  })),
);

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
  const [hash, setHash] = useState(
    () => (typeof window !== "undefined" ? window.location.hash : ""),
  );

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (hash.startsWith("#/room-qr/")) {
      // Pass window.location.hash prop/value into the element or config.
      window.location.hash = "";
    }
  }, [hash]);

  const isActivateRoute = hash.startsWith("#/activate");

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
        user={user}
        locale={locale}
        focusTicketId={
          ticketFocus && view === "repairs" ? ticketFocus.ticketId : null
        }
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
    );
  } else if (view === "common") {
    panel = (
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
    );
  } else if (view === "team") {
    panel = <TeamPage user={user} locale={locale} />;
  } else if (view === "live") {
    panel = (
      <LiveBoardPage
        user={user}
        locale={locale}
        modules={publicSettings?.modules ?? null}
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
        user={user}
        onUserUpdated={(me) => setUser(me)}
      />
    );
  } else if (view === "notifications") {
    panel = (
      <NotificationsPage
        locale={locale}
        onNavigate={(panelName) => {
          if (panels.includes(panelName)) setView(panelName);
        }}
      />
    );
  }

  return <Suspense fallback={<PanelFallback />}>{panel}</Suspense>;
}
