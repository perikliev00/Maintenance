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

export function ActivePanel({
  view,
  user,
  locale,
  publicSettings,
  panels,
  setView,
  setUser,
}: ActivePanelProps) {
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
            if (panels.includes(panel)) setView(panel);
          }}
        />
      )}
    </>
  );
}
