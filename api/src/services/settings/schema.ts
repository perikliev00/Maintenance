/**
 * Zod schemas, defaults, and key union for AppSetting JSON values.
 * Keep schemas and DEFAULT_SETTINGS in sync — getSetting falls back on parse failure.
 */
import { z } from "zod/v3";

/** Canonical AppSetting.key values — keep in sync with SETTING_SCHEMAS / defaults. */
export const SETTING_KEYS = [
  // Run next step: "modules",
  "modules",
  // Run next step: "flags",
  "flags",
  // Run next step: "interface",
  "interface",
  // Run next step: "operations",
  "operations",
  // Run next step: "access",
  "access",
  // Run next step: "notifications",
  "notifications",
// Run next step: ] as const;
] as const;

// Declare type SettingKey for callers and internals.
export type SettingKey = (typeof SETTING_KEYS)[number];

/** Which product modules are visible in the web nav. */
export const modulesSchema = z.object({
  // Set rooms on the structure being built.
  rooms: z.boolean(),
  // Set common on the structure being built.
  common: z.boolean(),
  // Set cleaning on the structure being built.
  cleaning: z.boolean(),
  // Set maintenance on the structure being built.
  maintenance: z.boolean(),
  // Set my_work on the structure being built.
  my_work: z.boolean().default(true),
  // Set repairs on the structure being built.
  repairs: z.boolean().default(true),
  // Set team on the structure being built.
  team: z.boolean(),
  // Set live on the structure being built.
  live: z.boolean().default(true),
  // Set control on the structure being built.
  control: z.boolean(),
  // Set daily_plan on the structure being built.
  daily_plan: z.boolean().default(true),
  // Set attendance on the structure being built.
  attendance: z.boolean(),
  // Set access_cards on the structure being built.
  access_cards: z.boolean(),
  // Set analytics on the structure being built.
  analytics: z.boolean(),
  // Set audit on the structure being built.
  audit: z.boolean().default(true),
});

/** Operational feature toggles (inspection, session limits, banners). */
export const flagsSchema = z.object({
  // Set require_inspection on the structure being built.
  require_inspection: z.boolean(),
  // Set one_active_session_per_employee on the structure being built.
  one_active_session_per_employee: z.boolean(),
  // Set allow_reception_reassign on the structure being built.
  allow_reception_reassign: z.boolean(),
  // Set block_room_on_urgent_ticket on the structure being built.
  block_room_on_urgent_ticket: z.boolean(),
  // Set show_overdue_banner on the structure being built.
  show_overdue_banner: z.boolean(),
});

/** Default UI theme / locale / density for new clients. */
export const interfaceSchema = z.object({
  // Set defaultTheme on the structure being built.
  defaultTheme: z.enum(["dark", "light"]),
  // Set locale on the structure being built.
  locale: z.enum(["bg", "en"]),
  // Set density on the structure being built.
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
  // Attempt the fallible work so errors can be handled below.
  try {
    // Same Intl probe used by hotelTime helpers.
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    // Return the computed result to the caller.
    return true;
  // Run next step: } catch {
  } catch {
    // Optional fallback list when the engine supports supportedValuesOf.
    try {
      // Define supported as a callable used by this flow.
      const supported = (
        // Run next step: Intl as unknown as { supportedValuesOf?: (key: string) => st…
        Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
      // Run next step: ).supportedValuesOf;
      ).supportedValuesOf;
      // Branch when this condition holds so the right path runs.
      if (typeof supported === "function") {
        // Return the computed result to the caller.
        return supported("timeZone").includes(timeZone);
      }
    // Run next step: } catch {
    } catch {
      /* ignore */
    }
    // Neither probe nor supportedValuesOf accepted the id.
    return false;
  }
}

/** SLA / overdue / risk thresholds and hotel timezone. */
export const operationsSchema = z.object({
  // Set overdueSessionMinutes on the structure being built.
  overdueSessionMinutes: z.number().int().min(15).max(24 * 60),
  // Set defaultTaskDueHours on the structure being built.
  defaultTaskDueHours: z.number().int().min(1).max(72),
  // Set defaultTicketSlaHours on the structure being built.
  defaultTicketSlaHours: z.number().int().min(1).max(168).default(24),
  // Set riskTicketThreshold on the structure being built.
  riskTicketThreshold: z.number().int().min(1).max(50).default(2),
  // Set riskWindowDays on the structure being built.
  riskWindowDays: z.number().int().min(1).max(365).default(30),
  // Set hotelTimezone on the structure being built.
  hotelTimezone: z
    // Continue the chained call from the previous expression.
    .string()
    // Continue the chained call from the previous expression.
    .min(1)
    // Continue the chained call from the previous expression.
    .refine(isValidIanaTimeZone, {
      // Set message on the structure being built.
      message: "hotelTimezone must be a valid IANA time zone",
    }),
});

/** Invitation TTL, session idle policy, inactive-user lock. */
export const accessSchema = z.object({
  // Set invitationTtlHours on the structure being built.
  invitationTtlHours: z.number().int().min(1).max(168),
  // Set sessionIdleDays on the structure being built.
  sessionIdleDays: z.number().int().min(1).max(365),
  // Set lockInactiveUsers on the structure being built.
  lockInactiveUsers: z.boolean(),
});

/** Per-channel enablement + operational status for notifications. */
export const notificationChannelSchema = z.object({
  // Set enabled on the structure being built.
  enabled: z.boolean(),
  // Set status on the structure being built.
  status: z.enum(["active", "disabled", "not_configured"]),
});

/** In-app / push / email channel bundle. */
export const notificationsSchema = z.object({
  // Set in_app on the structure being built.
  in_app: notificationChannelSchema,
  // Set device_push on the structure being built.
  device_push: notificationChannelSchema,
  // Set email on the structure being built.
  email: notificationChannelSchema,
});

/** Map SettingKey → Zod schema used by getSetting / updateSetting. */
export const SETTING_SCHEMAS = {
  // Set modules on the structure being built.
  modules: modulesSchema,
  // Set flags on the structure being built.
  flags: flagsSchema,
  // Set interface on the structure being built.
  interface: interfaceSchema,
  // Set operations on the structure being built.
  operations: operationsSchema,
  // Set access on the structure being built.
  access: accessSchema,
  // Set notifications on the structure being built.
  notifications: notificationsSchema,
// Run next step: } as const;
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
  // Set modules on the structure being built.
  modules: {
    // Set rooms on the structure being built.
    rooms: true,
    // Set common on the structure being built.
    common: true,
    // Set cleaning on the structure being built.
    cleaning: true,
    // Set maintenance on the structure being built.
    maintenance: true,
    // Set my_work on the structure being built.
    my_work: true,
    // Set repairs on the structure being built.
    repairs: true,
    // Set team on the structure being built.
    team: true,
    // Set live on the structure being built.
    live: true,
    // Set control on the structure being built.
    control: true,
    // Set daily_plan on the structure being built.
    daily_plan: true,
    // Set attendance on the structure being built.
    attendance: true,
    // Set access_cards on the structure being built.
    access_cards: true,
    // Set analytics on the structure being built.
    analytics: true,
    // Set audit on the structure being built.
    audit: true,
  // Run next step: } satisfies ModulesSettings,
  } satisfies ModulesSettings,
  // Set flags on the structure being built.
  flags: {
    // Set require_inspection on the structure being built.
    require_inspection: true,
    // Set one_active_session_per_employee on the structure being built.
    one_active_session_per_employee: true,
    // Set allow_reception_reassign on the structure being built.
    allow_reception_reassign: true,
    // Set block_room_on_urgent_ticket on the structure being built.
    block_room_on_urgent_ticket: false,
    // Set show_overdue_banner on the structure being built.
    show_overdue_banner: true,
  // Run next step: } satisfies FlagsSettings,
  } satisfies FlagsSettings,
  // Set interface on the structure being built.
  interface: {
    // Set defaultTheme on the structure being built.
    defaultTheme: "dark",
    // Set locale on the structure being built.
    locale: "bg",
    // Set density on the structure being built.
    density: "comfortable",
  // Run next step: } satisfies InterfaceSettings,
  } satisfies InterfaceSettings,
  // Set operations on the structure being built.
  operations: {
    // Set overdueSessionMinutes on the structure being built.
    overdueSessionMinutes: 240,
    // Set defaultTaskDueHours on the structure being built.
    defaultTaskDueHours: 4,
    // Set defaultTicketSlaHours on the structure being built.
    defaultTicketSlaHours: 24,
    // Set riskTicketThreshold on the structure being built.
    riskTicketThreshold: 2,
    // Set riskWindowDays on the structure being built.
    riskWindowDays: 30,
    // Set hotelTimezone on the structure being built.
    hotelTimezone: "Europe/Sofia",
  // Run next step: } satisfies OperationsSettings,
  } satisfies OperationsSettings,
  // Set access on the structure being built.
  access: {
    // Set invitationTtlHours on the structure being built.
    invitationTtlHours: 2,
    // Set sessionIdleDays on the structure being built.
    sessionIdleDays: 30,
    // Set lockInactiveUsers on the structure being built.
    lockInactiveUsers: false,
  // Run next step: } satisfies AccessSettings,
  } satisfies AccessSettings,
  // Set notifications on the structure being built.
  notifications: {
    // Set in_app on the structure being built.
    in_app: { enabled: true, status: "active" },
    // Set device_push on the structure being built.
    device_push: { enabled: false, status: "not_configured" },
    // Set email on the structure being built.
    email: { enabled: false, status: "disabled" },
  // Run next step: } satisfies NotificationsSettings,
  } satisfies NotificationsSettings,
// Run next step: } as const;
} as const;

/** Type guard for unknown strings against the SETTING_KEYS catalog. */
export function isSettingKey(key: string): key is SettingKey {
  // Used by settings routes before looking up SETTING_SCHEMAS[key].
  return (SETTING_KEYS as readonly string[]).includes(key);
}
