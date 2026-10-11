import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearSession,
  fetchMe,
  fetchPublicSettings,
  filterPanelsByModules,
  getStoredUser,
  hasCachedSession,
  landingForUser,
  panelsForUser,
  type AuthUser,
  type Panel,
  type PublicSettings,
} from "../api/client";
import {
  classifyBootstrapError,
  shouldWipeOfflineOnBootstrap,
} from "../api/sessionPolicy";
import {
  applyTheme,
  getStoredTheme,
  hasUserThemePreference,
  toggleTheme,
  type ThemeMode,
} from "../theme";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { setOfflineUser } from "../offline";

export function useAuthBootstrap() {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [signedIn, setSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [view, setView] = useState<Panel>("home");
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(
    null,
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    setOfflineUser(user?.id ?? null);
  }, [user?.id]);

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
      } catch (err) {
        if (cancelled) return;
        const failure = classifyBootstrapError(err);
        const wipe = shouldWipeOfflineOnBootstrap({
          hasCachedUser: hasCachedSession(),
          failure,
        });
        if (wipe) {
          clearSession();
          setSignedIn(false);
          setUser(null);
          setPublicSettings(null);
        } else {
          // Transient / unverified: keep cached identity + offline outbox.
          const cached = getStoredUser();
          setUser(cached);
          setSignedIn(Boolean(cached));
          setPublicSettings(null);
        }
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

  const navPanels = useMemo(
    () => panels.filter((p) => p !== "notifications"),
    [panels],
  );

  const locale: "bg" | "en" = publicSettings?.interface.locale ?? "bg";

  useEffect(() => {
    if (!user) return;
    if (!panels.includes(view)) {
      const landing = landingForUser(user);
      setView(panels.includes(landing) ? landing : panels[0] ?? "home");
    }
  }, [user, view, panels]);

  function onToggleTheme() {
    setTheme((prev) => toggleTheme(prev));
  }

  return {
    user,
    setUser,
    signedIn,
    setSignedIn,
    authReady,
    authEpoch,
    setAuthEpoch,
    view,
    setView,
    theme,
    publicSettings,
    panels,
    navPanels,
    locale,
    onToggleTheme,
  };
}
