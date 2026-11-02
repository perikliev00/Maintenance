/**
 * App settings store: Zod-validated JSON rows with a short in-process TTL cache.
 * Invalid/missing DB values fall back to DEFAULT_SETTINGS without throwing.
 * Updates use optimistic concurrency (version CAS) so concurrent writers cannot
 * silently clobber each other; audit `before` is read inside the same transaction.
 */
import { LocationKind, Prisma, SessionStatus } from "@prisma/client";
import { prisma } from "../../db";
import { OPEN_TICKET_STATUSES } from "../../constants";
import { AppError } from "../../errors";
import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  SETTING_SCHEMAS,
  type AccessSettings,
  type FlagsSettings,
  type OperationsSettings,
  type SettingKey,
  isSettingKey,
} from "./schema";
import { publish } from "../../events/bus";
import { listAuditEvents, recordAudit } from "../audit";
import { isP2002 } from "../db/prismaErrors";

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
  const result: Record<
    string,
    {
      key: string;
      value: unknown;
      version: number;
      updatedAt: Date;
      updatedByEmployeeId: string | null;
      /** False when stored JSON failed schema validation (UI should not treat defaults as saved). */
      valueValid: boolean;
    }
  > = {};
  for (const key of SETTING_KEYS) {
    const row = byKey[key];
    // Validate stored JSON; fall back to default on parse failure.
    const parsed = SETTING_SCHEMAS[key].safeParse(row?.value ?? DEFAULT_SETTINGS[key]);
    result[key] = {
      key,
      value: parsed.success ? parsed.data : DEFAULT_SETTINGS[key],
      version: row?.version ?? 1,
      updatedAt: row?.updatedAt ?? new Date(),
      updatedByEmployeeId: row?.updatedByEmployeeId ?? null,
      valueValid: parsed.success,
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
      allow_reception_reassign: flags.allow_reception_reassign,
    },
  };
}

function throwVersionConflict(input: {
  key: SettingKey;
  expectedVersion: number;
  currentVersion: number;
  currentValue: unknown;
}) {
  throw new AppError(
    409,
    "version_conflict",
    `Setting ${input.key} was updated by another user`,
    {
      key: input.key,
      expectedVersion: input.expectedVersion,
      currentVersion: input.currentVersion,
      currentValue: input.currentValue,
    },
  );
}

/**
 * Validate, persist, audit, invalidate cache, and publish settings.changed.
 * Force-clamps device_push to disabled/not_configured (no push adapter yet).
 *
 * Concurrency: optional `expectedVersion` enables optimistic CAS. When omitted
 * (internal callers), the write still CAS-es against the version observed inside
 * the transaction so `before`/`after` stay truthful under races.
 */
export async function updateSetting(input: {
  key: string;
  value: unknown;
  actorEmployeeId: string;
  reason?: string;
  expectedVersion?: number;
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

  // Upsert + audit in one transaction; before is the locked/CAS-matched prior value.
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.appSetting.findUnique({ where: { key } });
    const currentVersion = existing?.version ?? 0;
    const casVersion =
      input.expectedVersion !== undefined ? input.expectedVersion : currentVersion;

    if (existing) {
      if (input.expectedVersion !== undefined && input.expectedVersion !== currentVersion) {
        throwVersionConflict({
          key,
          expectedVersion: input.expectedVersion,
          currentVersion,
          currentValue: existing.value,
        });
      }

      const before = existing.value;
      const bumped = await tx.appSetting.updateMany({
        where: { key, version: casVersion },
        data: {
          value: parsed.data as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedByEmployeeId: input.actorEmployeeId,
        },
      });
      if (bumped.count === 0) {
        const fresh = await tx.appSetting.findUnique({ where: { key } });
        throwVersionConflict({
          key,
          expectedVersion: casVersion,
          currentVersion: fresh?.version ?? currentVersion,
          currentValue: fresh?.value ?? existing.value,
        });
      }

      await recordAudit(
        {
          actorEmployeeId: input.actorEmployeeId,
          action: "setting.update",
          entityType: "setting",
          entityId: key,
          reason: input.reason,
          before,
          after: parsed.data,
          summary: `Updated setting ${key}`,
        },
        tx,
      );

      const row = await tx.appSetting.findUniqueOrThrow({ where: { key } });
      return row;
    }

    // First write for this key: create; unique races surface as version_conflict.
    try {
      const row = await tx.appSetting.create({
        data: {
          key,
          value: parsed.data as Prisma.InputJsonValue,
          version: 1,
          updatedByEmployeeId: input.actorEmployeeId,
        },
      });
      await recordAudit(
        {
          actorEmployeeId: input.actorEmployeeId,
          action: "setting.update",
          entityType: "setting",
          entityId: key,
          reason: input.reason,
          before: DEFAULT_SETTINGS[key],
          after: parsed.data,
          summary: `Updated setting ${key}`,
        },
        tx,
      );
      return row;
    } catch (err) {
      if (isP2002(err)) {
        const fresh = await tx.appSetting.findUnique({ where: { key } });
        throwVersionConflict({
          key,
          expectedVersion: input.expectedVersion ?? 0,
          currentVersion: fresh?.version ?? 1,
          currentValue: fresh?.value ?? DEFAULT_SETTINGS[key],
        });
      }
      throw err;
    }
  });

  // Drop stale cache entry and notify live subscribers.
  invalidateCache(key);
  publish("settings.changed");
  return {
    key,
    value: parsed.data,
    version: updated.version,
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

/** Best-effort count; never throws — null means UNKNOWN, not zero. */
export async function safeEntityCount(
  run: () => Promise<number>,
): Promise<number | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

/** Optional count runners for tests (inject a failing query without mocking Prisma). */
export type SystemStatusCountFns = {
  rooms: () => Promise<number>;
  commonAreas: () => Promise<number>;
  openTickets: () => Promise<number>;
  runningSessions: () => Promise<number>;
};

function defaultSystemCountFns(): SystemStatusCountFns {
  return {
    rooms: () =>
      prisma.location.count({
        where: { kind: LocationKind.room, catalogStatus: "active" },
      }),
    commonAreas: () =>
      prisma.location.count({
        where: { kind: LocationKind.common_area, catalogStatus: "active" },
      }),
    openTickets: () =>
      prisma.maintenanceTicket.count({
        where: { status: { in: [...OPEN_TICKET_STATUSES] } },
      }),
    runningSessions: () =>
      prisma.cleaningSession.count({
        where: { status: SessionStatus.running },
      }),
  };
}

/** Lightweight health: DB ping + coarse entity counts for admin status pages. */
export async function getSystemStatus(opts?: {
  counts?: Partial<SystemStatusCountFns>;
  /** Override ping; tests can force a DOWN database without killing the pool. */
  ping?: () => Promise<void>;
}) {
  const t0 = Date.now();
  let dbOk = false;
  let dbPingMs = 0;
  const ping = opts?.ping ?? (async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  // Best-effort ping; failures still return status with ok=false.
  try {
    await ping();
    dbOk = true;
    dbPingMs = Date.now() - t0;
  } catch {
    dbPingMs = Date.now() - t0;
  }

  const runners = { ...defaultSystemCountFns(), ...opts?.counts };
  // Independent counts so one failure cannot reject the whole diagnostic payload.
  const [rooms, commonAreas, openTickets, runningSessions] = await Promise.all([
    safeEntityCount(runners.rooms),
    safeEntityCount(runners.commonAreas),
    safeEntityCount(runners.openTickets),
    safeEntityCount(runners.runningSessions),
  ]);

  const serverTime = new Date().toISOString();
  return {
    api: { ok: true },
    database: { ok: dbOk, pingMs: dbPingMs },
    counts: { rooms, commonAreas, openTickets, runningSessions },
    serverTime,
    /** Wall-clock of this successful diagnostic assembly (client stale markers). */
    fetchedAt: serverTime,
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
