/**
 * Session bootstrap and shell state (user, panels, theme, locale, view).
 *
 * On failure, uses `sessionPolicy` so transient/network errors keep the cached
 * user and offline outbox, while hard auth rejection wipes them. Binds
 * `setOfflineUser` to the signed-in id for scoped IndexedDB access.
 */
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
import { setOfflineUser } from "../offline/session";

/** Auth + settings bootstrap for the root shell. */
export function useAuthBootstrap() {
  // Local React state.
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  // Local React state.
  const [signedIn, setSignedIn] = useState(false);
  // Local React state.
  const [authReady, setAuthReady] = useState(false);
  // Local React state.
  const [authEpoch, setAuthEpoch] = useState(0);
  // Local React state.
  const [view, setView] = useState<Panel>("home");
  // Local React state.
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  // Local React state.
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(
    null,
  );

  // Effect: sync props/state to side effects.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Scope offline stores to this account (purge on change via userScope).
  useEffect(() => {
    setOfflineUser(user?.id ?? null);
  }, [user?.id]);

  // Re-run when authEpoch bumps (login / logout / activate) to re-fetch /me.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Try block for fallible work.
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

  /** Refetch /me + public settings after SSE settings/people events. */
  const refreshPublicSettings = useCallback(async () => {
    if (!signedIn) return;
    const [me, pub] = await Promise.all([fetchMe(), fetchPublicSettings()]);
    setUser(me);
    setPublicSettings(pub);
    // Only apply hotel default theme when the user has never chosen one.
    if (!hasUserThemePreference()) {
      setTheme(pub.interface.defaultTheme);
    }
    document.documentElement.setAttribute(
      "data-density",
      pub.interface.density,
    );
  }, [signedIn]);

  // Live refresh of capabilities when settings, people, or grants change.
  useLiveRefresh(refreshPublicSettings, {
    enabled: Boolean(signedIn && user),
    eventTypes: ["settings.changed", "people.changed", "permissions.changed"],
  });

  // Role panels ∩ enabled modules (null modules → no filter).
  const panels = useMemo(() => {
    if (!user) return [] as Panel[];
    return filterPanelsByModules(panelsForUser(user), publicSettings?.modules);
  }, [user, publicSettings]);

  // Inbox is opened from the bell, not the sidebar list.
  const navPanels = useMemo(
    () => panels.filter((p) => p !== "notifications"),
    [panels],
  );

  const locale: "bg" | "en" = publicSettings?.interface.locale ?? "bg";

  // If modules/role revoke the current panel, jump to a still-allowed landing.
  useEffect(() => {
    if (!user) return;
    if (!panels.includes(view)) {
      const landing = landingForUser(user);
      setView(panels.includes(landing) ? landing : panels[0] ?? "home");
    }
  }, [user, view, panels]);

  /** Flip theme and persist via `theme.ts`. */
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
