import { LocationKind, Prisma, SessionStatus } from "@prisma/client";
import { prisma } from "../db";
import { OPEN_TICKET_STATUSES } from "../constants";
import { AppError } from "../errors";
import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  SETTING_SCHEMAS,
  type AccessSettings,
  type FlagsSettings,
  type ModulesSettings,
  type OperationsSettings,
  type SettingKey,
  isSettingKey,
} from "./settingsSchema";
import { publish } from "../events/bus";
import { listAuditEvents, recordAudit } from "./audit";

type CacheEntry = { value: unknown; loadedAt: number };

const cache = new Map<SettingKey, CacheEntry>();
const CACHE_TTL_MS = 5_000;

function invalidateCache(key?: SettingKey) {
  if (key) cache.delete(key);
  else cache.clear();
}

export async function ensureDefaultSettings() {
  for (const key of SETTING_KEYS) {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: DEFAULT_SETTINGS[key] as Prisma.InputJsonValue },
      update: {},
    });
  }
}

export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<(typeof DEFAULT_SETTINGS)[K]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) {
    return hit.value as (typeof DEFAULT_SETTINGS)[K];
  }

  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) {
    const fallback = DEFAULT_SETTINGS[key];
    cache.set(key, { value: fallback, loadedAt: Date.now() });
    return fallback;
  }

  const parsed = SETTING_SCHEMAS[key].safeParse(row.value);
  const value = (parsed.success ? parsed.data : DEFAULT_SETTINGS[key]) as (typeof DEFAULT_SETTINGS)[K];
  cache.set(key, { value, loadedAt: Date.now() });
  return value;
}

export async function getAllSettings() {
  await ensureDefaultSettings();
  const rows = await prisma.appSetting.findMany();
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const result: Record<string, { key: string; value: unknown; updatedAt: Date; updatedByEmployeeId: string | null }> = {};
  for (const key of SETTING_KEYS) {
    const row = byKey[key];
    const parsed = SETTING_SCHEMAS[key].safeParse(row?.value ?? DEFAULT_SETTINGS[key]);
    result[key] = {
      key,
      value: parsed.success ? parsed.data : DEFAULT_SETTINGS[key],
      updatedAt: row?.updatedAt ?? new Date(),
      updatedByEmployeeId: row?.updatedByEmployeeId ?? null,
    };
  }
  return result;
}

export async function getPublicSettings() {
  const [modules, iface, operations, flags] = await Promise.all([
    getSetting("modules"),
    getSetting("interface"),
    getSetting("operations"),
    getSetting("flags"),
  ]);
  return {
    modules,
    interface: iface,
    operations: {
      overdueSessionMinutes: operations.overdueSessionMinutes,
      defaultTaskDueHours: operations.defaultTaskDueHours,
      defaultTicketSlaHours: operations.defaultTicketSlaHours,
      riskTicketThreshold: operations.riskTicketThreshold,
      riskWindowDays: operations.riskWindowDays,
      hotelTimezone: operations.hotelTimezone,
    },
    flags: {
      show_overdue_banner: flags.show_overdue_banner,
      require_inspection: flags.require_inspection,
    },
  };
}

export async function updateSetting(input: {
  key: string;
  value: unknown;
  actorEmployeeId: string;
  reason?: string;
}) {
  if (!isSettingKey(input.key)) {
    throw new AppError(400, "validation", `Unknown setting key: ${input.key}`);
  }
  const key = input.key;
  const schema = SETTING_SCHEMAS[key];
  let value = input.value;

  // Device push cannot be enabled without an adapter
  if (key === "notifications" && value && typeof value === "object") {
    const v = { ...(value as Record<string, unknown>) };
    const device = v.device_push as { enabled?: boolean; status?: string } | undefined;
    if (device) {
      v.device_push = {
        enabled: false,
        status: "not_configured",
      };
    }
    value = v;
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, "validation", "Invalid setting value", parsed.error.flatten());
  }

  const existing = await prisma.appSetting.findUnique({ where: { key } });
  const before = existing?.value ?? DEFAULT_SETTINGS[key];

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.appSetting.upsert({
      where: { key },
      create: {
        key,
        value: parsed.data as Prisma.InputJsonValue,
        updatedByEmployeeId: input.actorEmployeeId,
      },
      update: {
        value: parsed.data as Prisma.InputJsonValue,
        updatedByEmployeeId: input.actorEmployeeId,
      },
    });
    await recordAudit({
      actorEmployeeId: input.actorEmployeeId,
      action: "setting.update",
      entityType: "setting",
      entityId: key,
      reason: input.reason,
      before,
      after: parsed.data,
      summary: `Updated setting ${key}`,
    }, tx);
    return row;
  });

  invalidateCache(key);
  publish("settings.changed");
  return {
    key,
    value: parsed.data,
    updatedAt: updated.updatedAt,
    updatedByEmployeeId: updated.updatedByEmployeeId,
  };
}

export async function listSettingHistory(input: {
  key?: string;
  limit?: number;
}) {
  const rows = await listAuditEvents({
    entityType: "setting",
    entityId: input.key && isSettingKey(input.key) ? input.key : undefined,
    limit: input.limit,
  });
  return rows.map((r) => ({
    id: r.id,
    key: r.entityId,
    before: r.before,
    after: r.after,
    reason: r.reason,
    createdAt: r.occurredAt,
    actor: r.actor ?? {
      id: "",
      fullName: "System",
      employeeNumber: "",
    },
  }));
}

export async function getSystemStatus() {
  const t0 = Date.now();
  let dbOk = false;
  let dbPingMs = 0;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
    dbPingMs = Date.now() - t0;
  } catch {
    dbPingMs = Date.now() - t0;
  }

  const [rooms, commonAreas, openTickets, runningSessions] = await Promise.all([
    prisma.location.count({
      where: { kind: LocationKind.room, catalogStatus: "active" },
    }),
    prisma.location.count({
      where: { kind: LocationKind.common_area, catalogStatus: "active" },
    }),
    prisma.maintenanceTicket.count({
      where: { status: { in: [...OPEN_TICKET_STATUSES] } },
    }),
    prisma.cleaningSession.count({
      where: { status: SessionStatus.running },
    }),
  ]);

  return {
    api: { ok: true },
    database: { ok: dbOk, pingMs: dbPingMs },
    counts: { rooms, commonAreas, openTickets, runningSessions },
    serverTime: new Date().toISOString(),
    version: process.env.npm_package_version ?? "0.1.0",
  };
}

export async function getFlags(): Promise<FlagsSettings> {
  return getSetting("flags");
}

export async function getOperations(): Promise<OperationsSettings> {
  return getSetting("operations");
}

export async function getAccess(): Promise<AccessSettings> {
  return getSetting("access");
}

export async function getModules(): Promise<ModulesSettings> {
  return getSetting("modules");
}
