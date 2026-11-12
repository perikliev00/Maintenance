/**
 * Last-known server snapshot for Settings: the settings bundle, the interface
 * locale derived from it, and SLA policy rows.
 *
 * Read side only — it never touches the draft. Callers decide separately
 * whether a freshly loaded bundle may replace the draft (see useSettingsDraft).
 */
import { useCallback, useState } from "react";
import {
  fetchAllSettings,
  fetchSlaPolicies,
  type SettingsBundle,
  type SlaPolicyRow,
} from "../../api/client";
import { upsertSlaPolicy } from "./settingsDraftLogic";

// Export function useSettingsServerState as part of this module's API.
export function useSettingsServerState() {
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const [locale, setLocale] = useState<"bg" | "en">("bg");
  const [slaPolicies, setSlaPolicies] = useState<SlaPolicyRow[]>([]);

  /**
   * Fetch bundle and SLA rows together and commit both. The bundle fetch is
   * authoritative: if it rejects, nothing is committed and the error
   * propagates. An SLA fetch failure never fails settings — it commits `[]`
   * (the Operations tab then shows built-in defaults).
   */
  const load = useCallback(async (): Promise<SettingsBundle> => {
    const [all, policies] = await Promise.all([
      fetchAllSettings(),
      fetchSlaPolicies().catch((): SlaPolicyRow[] => []),
    ]);
    setSlaPolicies(policies);
    setBundle(all);
    const iface = all.interface?.value as { locale?: "bg" | "en" } | undefined;
    if (iface?.locale) setLocale(iface.locale);
    return all;
  }, []);

  /** Reflect a just-saved SLA policy without refetching the bundle. */
  const applySlaPolicy = useCallback((row: SlaPolicyRow) => {
    setSlaPolicies((prev) => upsertSlaPolicy(prev, row));
  }, []);

  return { bundle, locale, slaPolicies, load, applySlaPolicy };
}
