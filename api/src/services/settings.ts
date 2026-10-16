/**
 * App settings store: Zod-validated JSON rows with a short in-process TTL cache.
 * Invalid/missing DB values fall back to DEFAULT_SETTINGS without throwing.
 */
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
/** Short TTL so multi-instance lag is bounded without a shared cache. */
const CACHE_TTL_MS = 5_000;

/** Drop one key or the entire in-process settings cache. */
function invalidateCache(key?: SettingKey) {
  // Single-key invalidation after updateSetting; clear-all for rare resets.
  if (key) cache.delete(key);
  else cache.clear();
}

/** Upsert missing keys with defaults; never overwrites existing values. */
export async function ensureDefaultSettings() {
  // Idempotent seed: create-only path; update is intentionally empty.
  for (const key of SETTING_KEYS) {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: DEFAULT_SETTINGS[key] as Prisma.InputJsonValue },
      update: {},
    });
  }
}

/** Cached get; corrupt/missing rows return the typed default for that key. */
export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<(typeof DEFAULT_SETTINGS)[K]> {
  // Serve from TTL cache when still fresh.
  const hit = cache.get(key);
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) {
    return hit.value as (typeof DEFAULT_SETTINGS)[K];
  }

  // Load the JSON row; missing → typed default (still cache the fallback).
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) {
    const fallback = DEFAULT_SETTINGS[key];
    cache.set(key, { value: fallback, loadedAt: Date.now() });
    return fallback;
  }

  // Corrupt JSON falls back to default rather than throwing at read time.
  const parsed = SETTING_SCHEMAS[key].safeParse(row.value);
  const value = (parsed.success ? parsed.data : DEFAULT_SETTINGS[key]) as (typeof DEFAULT_SETTINGS)[K];
  cache.set(key, { value, loadedAt: Date.now() });
  return value;
}

/** Ensure defaults exist, then return every key with metadata for admin UI. */
export async function getAllSettings() {
  // Guarantee every SETTING_KEYS row exists before listing.
  await ensureDefaultSettings();
  const rows = await prisma.appSetting.findMany();
  // Index by key for O(1) lookup while iterating SETTING_KEYS order.
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const result: Record<string, { key: string; value: unknown; updatedAt: Date; updatedByEmployeeId: string | null }> = {};
  for (const key of SETTING_KEYS) {
    const row = byKey[key];
    // Validate stored JSON; fall back to default on parse failure.
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

/**
 * Subset safe for authenticated clients (no access/notification secrets).
 * Omits invitation/session policies and channel enablement details.
 */
export async function getPublicSettings() {
  // Parallel fetch of the four public-facing setting groups.
  const [modules, iface, operations, flags] = await Promise.all([
    getSetting("modules"),
    getSetting("interface"),
    getSetting("operations"),
    getSetting("flags"),
  ]);
  // Whitelist fields — strip secrets / internal notification channels.
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

/**
 * Validate, persist, audit, invalidate cache, and publish settings.changed.
 * Force-clamps device_push to disabled/not_configured (no push adapter yet).
 */
export async function updateSetting(input: {
  key: string;
  value: unknown;
  actorEmployeeId: string;
  reason?: string;
}) {
  // Reject unknown keys before any DB work.
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
    // Force-disable regardless of client payload.
    if (device) {
      v.device_push = {
        enabled: false,
        status: "not_configured",
      };
    }
    value = v;
  }

  // Zod validate the (possibly clamped) value.
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, "validation", "Invalid setting value", parsed.error.flatten());
  }

  // Capture before snapshot for the audit row.
  const existing = await prisma.appSetting.findUnique({ where: { key } });
  const before = existing?.value ?? DEFAULT_SETTINGS[key];

  // Upsert + audit in one transaction.
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

  // Drop stale cache entry and notify live subscribers.
  invalidateCache(key);
  publish("settings.changed");
  return {
    key,
    value: parsed.data,
    updatedAt: updated.updatedAt,
    updatedByEmployeeId: updated.updatedByEmployeeId,
  };
}

/** Audit trail for setting updates (optionally filtered to one key). */
export async function listSettingHistory(input: {
  key?: string;
  limit?: number;
}) {
  // Reuse listAuditEvents with entityType=setting.
  const rows = await listAuditEvents({
    entityType: "setting",
    // Only filter by entityId when the key is a known SettingKey.
    entityId: input.key && isSettingKey(input.key) ? input.key : undefined,
    limit: input.limit,
  });
  // Shape for the settings history UI (key alias of entityId).
  return rows.map((r) => ({
    id: r.id,
    key: r.entityId,
    before: r.before,
    after: r.after,
    reason: r.reason,
    createdAt: r.occurredAt,
    // System actor placeholder when actorEmployeeId was null.
    actor: r.actor ?? {
      id: "",
      fullName: "System",
      employeeNumber: "",
    },
  }));
}

/** Lightweight health: DB ping + coarse entity counts for admin status pages. */
export async function getSystemStatus() {
  const t0 = Date.now();
  let dbOk = false;
  let dbPingMs = 0;
  // Best-effort ping; failures still return status with ok=false.
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
    dbPingMs = Date.now() - t0;
  } catch {
    dbPingMs = Date.now() - t0;
  }

  // Parallel coarse counts for the admin status cards.
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

/** Typed shortcut for feature flags settings. */
export async function getFlags(): Promise<FlagsSettings> {
  return getSetting("flags");
}

/** Typed shortcut for operations (timezone, SLA defaults, etc.). */
export async function getOperations(): Promise<OperationsSettings> {
  return getSetting("operations");
}

/** Typed shortcut for access / invitation policy settings. */
export async function getAccess(): Promise<AccessSettings> {
  return getSetting("access");
}

/** Typed shortcut for module visibility settings. */
export async function getModules(): Promise<ModulesSettings> {
  return getSetting("modules");
}
