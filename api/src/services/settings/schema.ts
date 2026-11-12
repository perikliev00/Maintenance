/**
 * Zod schemas, defaults, and key union for AppSetting JSON values.
 * Keep schemas and DEFAULT_SETTINGS in sync — getSetting falls back on parse failure.
 */
import { z } from "zod/v3";

/** Canonical AppSetting.key values — keep in sync with SETTING_SCHEMAS / defaults. */
export const SETTING_KEYS = [
  "modules",
  "flags",
  "interface",
  "operations",
  "access",
  "notifications",
] as const;

// Declare type SettingKey for callers and internals.
export type SettingKey = (typeof SETTING_KEYS)[number];

/** Which product modules are visible in the web nav. */
export const modulesSchema = z.object({
  rooms: z.boolean(),
  common: z.boolean(),
  cleaning: z.boolean(),
  maintenance: z.boolean(),
  my_work: z.boolean().default(true),
  repairs: z.boolean().default(true),
  team: z.boolean(),
  live: z.boolean().default(true),
  control: z.boolean(),
  daily_plan: z.boolean().default(true),
  attendance: z.boolean(),
  access_cards: z.boolean(),
  analytics: z.boolean(),
  audit: z.boolean().default(true),
});

/** Operational feature toggles (inspection, session limits, banners). */
export const flagsSchema = z.object({
  require_inspection: z.boolean(),
  one_active_session_per_employee: z.boolean(),
  allow_reception_reassign: z.boolean(),
  block_room_on_urgent_ticket: z.boolean(),
  show_overdue_banner: z.boolean(),
});

/** Default UI theme / locale / density for new clients. */
export const interfaceSchema = z.object({
  defaultTheme: z.enum(["dark", "light"]),
  locale: z.enum(["bg", "en"]),
  density: z.enum(["comfortable", "compact"]),
});

/**
 * IANA timezone id check compatible with the runtime Intl implementation.
 * Prefer DateTimeFormat probe (same path hotel-date helpers use); optionally
 * accept ids listed by supportedValuesOf when available.
 */
export function isValidIanaTimeZone(timeZone: string): boolean {
  // Empty / non-string → invalid without probing Intl.
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    // Same Intl probe used by hotelTime helpers.
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    // Optional fallback list when the engine supports supportedValuesOf.
    try {
      const supported = (
        Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
      ).supportedValuesOf;
      if (typeof supported === "function") {
        return supported("timeZone").includes(timeZone);
      }
    } catch {
      /* ignore */
    }
    // Neither probe nor supportedValuesOf accepted the id.
    return false;
  }
}

/** SLA / overdue / risk thresholds and hotel timezone. */
export const operationsSchema = z.object({
  overdueSessionMinutes: z.number().int().min(15).max(24 * 60),
  defaultTaskDueHours: z.number().int().min(1).max(72),
  defaultTicketSlaHours: z.number().int().min(1).max(168).default(24),
  riskTicketThreshold: z.number().int().min(1).max(50).default(2),
  riskWindowDays: z.number().int().min(1).max(365).default(30),
  hotelTimezone: z
    // Continue the chained call from the previous expression.
    .string()
    // Continue the chained call from the previous expression.
    .min(1)
    // Continue the chained call from the previous expression.
    .refine(isValidIanaTimeZone, {
      message: "hotelTimezone must be a valid IANA time zone",
    }),
});

/** Invitation TTL, session idle policy, inactive-user lock. */
export const accessSchema = z.object({
  invitationTtlHours: z.number().int().min(1).max(168),
  sessionIdleDays: z.number().int().min(1).max(365),
  lockInactiveUsers: z.boolean(),
});

/** Per-channel enablement + operational status for notifications. */
export const notificationChannelSchema = z.object({
  enabled: z.boolean(),
  status: z.enum(["active", "disabled", "not_configured"]),
});

/** In-app / push / email channel bundle. */
export const notificationsSchema = z.object({
  in_app: notificationChannelSchema,
  device_push: notificationChannelSchema,
  email: notificationChannelSchema,
});

/** Map SettingKey → Zod schema used by getSetting / updateSetting. */
export const SETTING_SCHEMAS = {
  modules: modulesSchema,
  flags: flagsSchema,
  interface: interfaceSchema,
  operations: operationsSchema,
  access: accessSchema,
  notifications: notificationsSchema,
} as const;

// Declare type ModulesSettings for callers and internals.
export type ModulesSettings = z.infer<typeof modulesSchema>;
// Declare type FlagsSettings for callers and internals.
export type FlagsSettings = z.infer<typeof flagsSchema>;
// Declare type InterfaceSettings for callers and internals.
export type InterfaceSettings = z.infer<typeof interfaceSchema>;
// Declare type OperationsSettings for callers and internals.
export type OperationsSettings = z.infer<typeof operationsSchema>;
// Declare type AccessSettings for callers and internals.
export type AccessSettings = z.infer<typeof accessSchema>;
// Declare type NotificationsSettings for callers and internals.
export type NotificationsSettings = z.infer<typeof notificationsSchema>;

/** Seed + fallback values when a row is missing or fails schema parse. */
export const DEFAULT_SETTINGS = {
  modules: {
    rooms: true,
    common: true,
    cleaning: true,
    maintenance: true,
    my_work: true,
    repairs: true,
    team: true,
    live: true,
    control: true,
    daily_plan: true,
    attendance: true,
    access_cards: true,
    analytics: true,
    audit: true,
  } satisfies ModulesSettings,
  flags: {
    require_inspection: true,
    one_active_session_per_employee: true,
    allow_reception_reassign: true,
    block_room_on_urgent_ticket: false,
    show_overdue_banner: true,
  } satisfies FlagsSettings,
  interface: {
    defaultTheme: "dark",
    locale: "bg",
    density: "comfortable",
  } satisfies InterfaceSettings,
  operations: {
    overdueSessionMinutes: 240,
    defaultTaskDueHours: 4,
    defaultTicketSlaHours: 24,
    riskTicketThreshold: 2,
    riskWindowDays: 30,
    hotelTimezone: "Europe/Sofia",
  } satisfies OperationsSettings,
  access: {
    invitationTtlHours: 2,
    sessionIdleDays: 30,
    lockInactiveUsers: false,
  } satisfies AccessSettings,
  notifications: {
    in_app: { enabled: true, status: "active" },
    device_push: { enabled: false, status: "not_configured" },
    email: { enabled: false, status: "disabled" },
  } satisfies NotificationsSettings,
} as const;

/** Type guard for unknown strings against the SETTING_KEYS catalog. */
export function isSettingKey(key: string): key is SettingKey {
  // Used by settings routes before looking up SETTING_SCHEMAS[key].
  return (SETTING_KEYS as readonly string[]).includes(key);
}
