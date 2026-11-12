/**
 * Session bootstrap and shell state (user, panels, theme, locale, view).
 *
 * On failure, uses `sessionPolicy` so transient/network errors keep the cached
 * user and offline outbox, while hard auth rejection wipes them. Binds
 * `setOfflineUser` to the signed-in id for scoped IndexedDB access.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  clearSession,
  // Support the surrounding logic for this step.
  fetchMe,
  // Support the surrounding logic for this step.
  fetchPublicSettings,
  // Support the surrounding logic for this step.
  filterPanelsByModules,
  // Support the surrounding logic for this step.
  getStoredUser,
  // Support the surrounding logic for this step.
  hasCachedSession,
  // Support the surrounding logic for this step.
  landingForUser,
  // Support the surrounding logic for this step.
  panelsForUser,
  // Declare type alias AuthUser.
  type AuthUser,
  // Declare type alias Panel.
  type Panel,
  // Declare type alias PublicSettings.
  type PublicSettings,
// Support the surrounding logic for this step.
} from "../api/client";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  classifyBootstrapError,
  // Support the surrounding logic for this step.
  shouldWipeOfflineOnBootstrap,
// Support the surrounding logic for this step.
} from "../api/sessionPolicy";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  applyTheme,
  // Support the surrounding logic for this step.
  getStoredTheme,
  // Support the surrounding logic for this step.
  hasUserThemePreference,
  // Support the surrounding logic for this step.
  toggleTheme,
  // Declare type alias ThemeMode.
  type ThemeMode,
// Support the surrounding logic for this step.
} from "../theme";
// Import module dependency from ../hooks/useLiveRefresh.
import { useLiveRefresh } from "../hooks/useLiveRefresh";
// Import module dependency from ../offline/session.
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
    // Support the surrounding logic for this step.
    null,
  );

  // Effect: sync props/state to side effects.
  useEffect(() => {
    // Invoke applyTheme to perform this step.
    applyTheme(theme);
  // Support the surrounding logic for this step.
  }, [theme]);

  // Scope offline stores to this account (purge on change via userScope).
  useEffect(() => {
    // State transition.
    setOfflineUser(user?.id ?? null);
  // Support the surrounding logic for this step.
  }, [user?.id]);

  // Re-run when authEpoch bumps (login / logout / activate) to re-fetch /me.
  useEffect(() => {
    // Bind cancelled for use in the following logic.
    let cancelled = false;
    // Support the surrounding logic for this step.
    (async () => {
      // Try block for fallible work.
      try {
        // Bind a local value for the following logic.
        const [me, pub] = await Promise.all([fetchMe(), fetchPublicSettings()]);
        // Branch: conditional gate.
        if (cancelled) return;
        // State transition.
        setUser(me);
        // State transition.
        setSignedIn(true);
        // State transition.
        setPublicSettings(pub);
        // Branch: conditional gate.
        if (!hasUserThemePreference()) {
          // State transition.
          setTheme(pub.interface.defaultTheme);
        }
        // Invoke document.documentElement.setAttribute to perform this step.
        document.documentElement.setAttribute(
          // Support the surrounding logic for this step.
          "data-density",
          // Support the surrounding logic for this step.
          pub.interface.density,
        );
        // State transition.
        setView((current) => {
          // Bind panels for use in the following logic.
          const panels = filterPanelsByModules(
            // Invoke panelsForUser to perform this step.
            panelsForUser(me),
            // Support the surrounding logic for this step.
            pub.modules,
          );
          // Branch: conditional gate.
          if (panels.includes(current)) return current;
          // Bind landing for use in the following logic.
          const landing = landingForUser(me);
          // Return value / early exit.
          return panels.includes(landing) ? landing : panels[0] ?? "home";
        });
      // Support the surrounding logic for this step.
      } catch (err) {
        // Branch: conditional gate.
        if (cancelled) return;
        // Bind failure for use in the following logic.
        const failure = classifyBootstrapError(err);
        // Bind wipe for use in the following logic.
        const wipe = shouldWipeOfflineOnBootstrap({
          // Provide hasCachedUser field used by this structure.
          hasCachedUser: hasCachedSession(),
          // Support the surrounding logic for this step.
          failure,
        });
        // Branch: conditional gate.
        if (wipe) {
          // Invoke clearSession to perform this step.
          clearSession();
          // State transition.
          setSignedIn(false);
          // State transition.
          setUser(null);
          // State transition.
          setPublicSettings(null);
        // Support the surrounding logic for this step.
        } else {
          // Transient / unverified: keep cached identity + offline outbox.
          const cached = getStoredUser();
          // State transition.
          setUser(cached);
          // State transition.
          setSignedIn(Boolean(cached));
          // State transition.
          setPublicSettings(null);
        }
      // Support the surrounding logic for this step.
      } finally {
        // Branch: conditional gate.
        if (!cancelled) setAuthReady(true);
      }
    // Support the surrounding logic for this step.
    })();
    // Return value / early exit.
    return () => {
      // Support the surrounding logic for this step.
      cancelled = true;
    };
  // Support the surrounding logic for this step.
  }, [authEpoch]);

  /** Refetch /me + public settings after SSE settings/people events. */
  const refreshPublicSettings = useCallback(async () => {
    // Branch: conditional gate.
    if (!signedIn) return;
    // Bind a local value for the following logic.
    const [me, pub] = await Promise.all([fetchMe(), fetchPublicSettings()]);
    // State transition.
    setUser(me);
    // State transition.
    setPublicSettings(pub);
    // Only apply hotel default theme when the user has never chosen one.
    if (!hasUserThemePreference()) {
      // State transition.
      setTheme(pub.interface.defaultTheme);
    }
    // Invoke document.documentElement.setAttribute to perform this step.
    document.documentElement.setAttribute(
      // Support the surrounding logic for this step.
      "data-density",
      // Support the surrounding logic for this step.
      pub.interface.density,
    );
  // Support the surrounding logic for this step.
  }, [signedIn]);

  // Live refresh of capabilities when settings, people, or grants change.
  useLiveRefresh(refreshPublicSettings, {
    // Provide enabled field used by this structure.
    enabled: Boolean(signedIn && user),
    // Provide eventTypes field used by this structure.
    eventTypes: ["settings.changed", "people.changed", "permissions.changed"],
  });

  // Role panels ∩ enabled modules (null modules → no filter).
  const panels = useMemo(() => {
    // Branch: conditional gate.
    if (!user) return [] as Panel[];
    // Return value / early exit.
    return filterPanelsByModules(panelsForUser(user), publicSettings?.modules);
  // Support the surrounding logic for this step.
  }, [user, publicSettings]);

  // Inbox is opened from the bell, not the sidebar list.
  const navPanels = useMemo(
    // Support the surrounding logic for this step.
    () => panels.filter((p) => p !== "notifications"),
    // Support the surrounding logic for this step.
    [panels],
  );

  // Bind locale for use in the following logic.
  const locale: "bg" | "en" = publicSettings?.interface.locale ?? "bg";

  // If modules/role revoke the current panel, jump to a still-allowed landing.
  useEffect(() => {
    // Branch: conditional gate.
    if (!user) return;
    // Branch: conditional gate.
    if (!panels.includes(view)) {
      // Bind landing for use in the following logic.
      const landing = landingForUser(user);
      // State transition.
      setView(panels.includes(landing) ? landing : panels[0] ?? "home");
    }
  // Support the surrounding logic for this step.
  }, [user, view, panels]);

  /** Flip theme and persist via `theme.ts`. */
  function onToggleTheme() {
    // State transition.
    setTheme((prev) => toggleTheme(prev));
  }

  // Return value / early exit.
  return {
    // Support the surrounding logic for this step.
    user,
    // Support the surrounding logic for this step.
    setUser,
    // Support the surrounding logic for this step.
    signedIn,
    // Support the surrounding logic for this step.
    setSignedIn,
    // Support the surrounding logic for this step.
    authReady,
    // Support the surrounding logic for this step.
    authEpoch,
    // Support the surrounding logic for this step.
    setAuthEpoch,
    // Support the surrounding logic for this step.
    view,
    // Support the surrounding logic for this step.
    setView,
    // Support the surrounding logic for this step.
    theme,
    // Support the surrounding logic for this step.
    publicSettings,
    // Support the surrounding logic for this step.
    panels,
    // Support the surrounding logic for this step.
    navPanels,
    // Support the surrounding logic for this step.
    locale,
    // Support the surrounding logic for this step.
    onToggleTheme,
  };
}
