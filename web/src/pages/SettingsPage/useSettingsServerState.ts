/**
 * Last-known server snapshot for Settings: the settings bundle, the interface
 * locale derived from it, and SLA policy rows.
 *
 * Read side only — it never touches the draft. Callers decide separately
 * whether a freshly loaded bundle may replace the draft (see useSettingsDraft).
 */
import { useCallback, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  fetchAllSettings,
  // Support the surrounding logic for this step.
  fetchSlaPolicies,
  // Declare type alias SettingsBundle.
  type SettingsBundle,
  // Declare type alias SlaPolicyRow.
  type SlaPolicyRow,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ./settingsDraftLogic.
import { upsertSlaPolicy } from "./settingsDraftLogic";

// Export function useSettingsServerState as part of this module's API.
export function useSettingsServerState() {
  // React state slot for local UI/data that can change over time.
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  // React state slot for local UI/data that can change over time.
  const [locale, setLocale] = useState<"bg" | "en">("bg");
  // React state slot for local UI/data that can change over time.
  const [slaPolicies, setSlaPolicies] = useState<SlaPolicyRow[]>([]);

  /**
   * Fetch bundle and SLA rows together and commit both. The bundle fetch is
   * authoritative: if it rejects, nothing is committed and the error
   * propagates. An SLA fetch failure never fails settings — it commits `[]`
   * (the Operations tab then shows built-in defaults).
   */
  const load = useCallback(async (): Promise<SettingsBundle> => {
    // Bind a local value for the following logic.
    const [all, policies] = await Promise.all([
      // Invoke fetchAllSettings to perform this step.
      fetchAllSettings(),
      // Invoke fetchSlaPolicies to perform this step.
      fetchSlaPolicies().catch((): SlaPolicyRow[] => []),
    // Support the surrounding logic for this step.
    ]);
    // Update React state so the UI reflects the new value.
    setSlaPolicies(policies);
    // Update React state so the UI reflects the new value.
    setBundle(all);
    // Bind iface for use in the following logic.
    const iface = all.interface?.value as { locale?: "bg" | "en" } | undefined;
    // Conditional branch for the case described by this guard.
    if (iface?.locale) setLocale(iface.locale);
    // Return early result or rendered output from this path.
    return all;
  // Support the surrounding logic for this step.
  }, []);

  /** Reflect a just-saved SLA policy without refetching the bundle. */
  const applySlaPolicy = useCallback((row: SlaPolicyRow) => {
    // Update React state so the UI reflects the new value.
    setSlaPolicies((prev) => upsertSlaPolicy(prev, row));
  // Support the surrounding logic for this step.
  }, []);

  // Return early result or rendered output from this path.
  return { bundle, locale, slaPolicies, load, applySlaPolicy };
}
