import { z } from "zod";

export const SETTING_KEYS = [
  "modules",
  "flags",
  "interface",
  "operations",
  "access",
  "notifications",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

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

export const flagsSchema = z.object({
  require_inspection: z.boolean(),
  one_active_session_per_employee: z.boolean(),
  allow_reception_reassign: z.boolean(),
  block_room_on_urgent_ticket: z.boolean(),
  show_overdue_banner: z.boolean(),
});

export const interfaceSchema = z.object({
  defaultTheme: z.enum(["dark", "light"]),
  locale: z.enum(["bg", "en"]),
  density: z.enum(["comfortable", "compact"]),
});

export const operationsSchema = z.object({
  overdueSessionMinutes: z.number().int().min(15).max(24 * 60),
  defaultTaskDueHours: z.number().int().min(1).max(72),
  defaultTicketSlaHours: z.number().int().min(1).max(168).default(24),
  riskTicketThreshold: z.number().int().min(1).max(50).default(2),
  riskWindowDays: z.number().int().min(1).max(365).default(30),
  hotelTimezone: z.string().min(1),
});

export const accessSchema = z.object({
  invitationTtlHours: z.number().int().min(1).max(168),
  sessionIdleDays: z.number().int().min(1).max(365),
  lockInactiveUsers: z.boolean(),
});

export const notificationChannelSchema = z.object({
  enabled: z.boolean(),
  status: z.enum(["active", "disabled", "not_configured"]),
});

export const notificationsSchema = z.object({
  in_app: notificationChannelSchema,
  device_push: notificationChannelSchema,
  email: notificationChannelSchema,
});

export const SETTING_SCHEMAS = {
  modules: modulesSchema,
  flags: flagsSchema,
  interface: interfaceSchema,
  operations: operationsSchema,
  access: accessSchema,
  notifications: notificationsSchema,
} as const;

export type ModulesSettings = z.infer<typeof modulesSchema>;
export type FlagsSettings = z.infer<typeof flagsSchema>;
export type InterfaceSettings = z.infer<typeof interfaceSchema>;
export type OperationsSettings = z.infer<typeof operationsSchema>;
export type AccessSettings = z.infer<typeof accessSchema>;
export type NotificationsSettings = z.infer<typeof notificationsSchema>;

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

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}
