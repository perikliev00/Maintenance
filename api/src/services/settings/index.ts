/**
 * App settings store: Zod-validated JSON rows with a short in-process TTL cache.
 * Invalid/missing DB values fall back to DEFAULT_SETTINGS without throwing.
 * Updates use optimistic concurrency (version CAS) so concurrent writers cannot
 * silently clobber each other; audit `before` is read inside the same transaction.
 */
import { LocationKind, Prisma, SessionStatus } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../constants for this service.
import { OPEN_TICKET_STATUSES } from "../../constants";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module dependency for this service.
import {
  // Run next step: DEFAULT_SETTINGS,
  DEFAULT_SETTINGS,
  // Run next step: SETTING_KEYS,
  SETTING_KEYS,
  // Run next step: SETTING_SCHEMAS,
  SETTING_SCHEMAS,
  // Declare type AccessSettings for callers and internals.
  type AccessSettings,
  // Declare type FlagsSettings for callers and internals.
  type FlagsSettings,
  // Declare type OperationsSettings for callers and internals.
  type OperationsSettings,
  // Declare type SettingKey for callers and internals.
  type SettingKey,
  // Run next step: isSettingKey,
  isSettingKey,
// Run next step: } from "./schema";
} from "./schema";
// Import module ../../events/bus for this service.
import { publish } from "../../events/bus";
// Import module ../audit for this service.
import { listAuditEvents, recordAudit } from "../audit";
// Import module ../db/prismaErrors for this service.
import { isP2002 } from "../db/prismaErrors";

// Declare type CacheEntry for callers and internals.
type CacheEntry = { value: unknown; loadedAt: number };

// Capture cache for use in this scope.
const cache = new Map<SettingKey, CacheEntry>();
/** Short TTL so multi-instance lag is bounded without a shared cache. */
const CACHE_TTL_MS = 5_000;

/** Drop one key or the entire in-process settings cache. */
function invalidateCache(key?: SettingKey) {
  // Single-key invalidation after updateSetting; clear-all for rare resets.
  if (key) cache.delete(key);
  // Run next step: else cache.clear();
  else cache.clear();
}

/** Upsert missing keys with defaults; never overwrites existing values. */
export async function ensureDefaultSettings() {
  // Idempotent seed: create-only path; update is intentionally empty.
  for (const key of SETTING_KEYS) {
    // Wait for the async step before continuing.
    await prisma.appSetting.upsert({
      // Set where on the structure being built.
      where: { key },
      // Set create on the structure being built.
      create: { key, value: DEFAULT_SETTINGS[key] as Prisma.InputJsonValue },
      // Set update on the structure being built.
      update: {},
    });
  }
}

/** Cached get; corrupt/missing rows return the typed default for that key. */
export async function getSetting<K extends SettingKey>(
  // Set key on the structure being built.
  key: K,
// Run next step: ): Promise<(typeof DEFAULT_SETTINGS)[K]> {
): Promise<(typeof DEFAULT_SETTINGS)[K]> {
  // Serve from TTL cache when still fresh.
  const hit = cache.get(key);
  // Branch when this condition holds so the right path runs.
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) {
    // Return the computed result to the caller.
    return hit.value as (typeof DEFAULT_SETTINGS)[K];
  }

  // Load the JSON row; missing → typed default (still cache the fallback).
  const row = await prisma.appSetting.findUnique({ where: { key } });
  // Branch when this condition holds so the right path runs.
  if (!row) {
    // Capture fallback for use in this scope.
    const fallback = DEFAULT_SETTINGS[key];
    // Store a keyed value for later lookup.
    cache.set(key, { value: fallback, loadedAt: Date.now() });
    // Return the computed result to the caller.
    return fallback;
  }

  // Corrupt JSON falls back to default rather than throwing at read time.
  const parsed = SETTING_SCHEMAS[key].safeParse(row.value);
  // Define value as a callable used by this flow.
  const value = (parsed.success ? parsed.data : DEFAULT_SETTINGS[key]) as (typeof DEFAULT_SETTINGS)[K];
  // Store a keyed value for later lookup.
  cache.set(key, { value, loadedAt: Date.now() });
  // Return the computed result to the caller.
  return value;
}

/** Ensure defaults exist, then return every key with metadata for admin UI. */
export async function getAllSettings() {
  // Guarantee every SETTING_KEYS row exists before listing.
  await ensureDefaultSettings();
  // Load rows asynchronously for the next steps.
  const rows = await prisma.appSetting.findMany();
  // Index by key for O(1) lookup while iterating SETTING_KEYS order.
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  // Capture result for use in this scope.
  const result: Record<
    // Run next step: string,
    string,
    // Run next step: {
    {
      // Set key on the structure being built.
      key: string;
      // Set value on the structure being built.
      value: unknown;
      // Set version on the structure being built.
      version: number;
      // Set updatedAt on the structure being built.
      updatedAt: Date;
      // Set updatedByEmployeeId on the structure being built.
      updatedByEmployeeId: string | null;
      /** False when stored JSON failed schema validation (UI should not treat defaults as saved). */
      valueValid: boolean;
    }
  // Run next step: > = {};
  > = {};
  // Iterate items to apply the same logic to each entry.
  for (const key of SETTING_KEYS) {
    // Capture row for use in this scope.
    const row = byKey[key];
    // Validate stored JSON; fall back to default on parse failure.
    const parsed = SETTING_SCHEMAS[key].safeParse(row?.value ?? DEFAULT_SETTINGS[key]);
    // Run next step: result[key] = {
    result[key] = {
      // Run next step: key,
      key,
      // Set value on the structure being built.
      value: parsed.success ? parsed.data : DEFAULT_SETTINGS[key],
      // Set version on the structure being built.
      version: row?.version ?? 1,
      // Set updatedAt on the structure being built.
      updatedAt: row?.updatedAt ?? new Date(),
      // Set updatedByEmployeeId on the structure being built.
      updatedByEmployeeId: row?.updatedByEmployeeId ?? null,
      // Set valueValid on the structure being built.
      valueValid: parsed.success,
    };
  }
  // Return the computed result to the caller.
  return result;
}

/**
 * Subset safe for authenticated clients (no access/notification secrets).
 * Omits invitation/session policies and channel enablement details.
 */
export async function getPublicSettings() {
  // Parallel fetch of the four public-facing setting groups.
  const [modules, iface, operations, flags] = await Promise.all([
    // Run next step: getSetting("modules"),
    getSetting("modules"),
    // Run next step: getSetting("interface"),
    getSetting("interface"),
    // Run next step: getSetting("operations"),
    getSetting("operations"),
    // Run next step: getSetting("flags"),
    getSetting("flags"),
  ]);
  // Whitelist fields — strip secrets / internal notification channels.
  return {
    // Run next step: modules,
    modules,
    // Set interface on the structure being built.
    interface: iface,
    // Set operations on the structure being built.
    operations: {
      // Set overdueSessionMinutes on the structure being built.
      overdueSessionMinutes: operations.overdueSessionMinutes,
      // Set defaultTaskDueHours on the structure being built.
      defaultTaskDueHours: operations.defaultTaskDueHours,
      // Set defaultTicketSlaHours on the structure being built.
      defaultTicketSlaHours: operations.defaultTicketSlaHours,
      // Set riskTicketThreshold on the structure being built.
      riskTicketThreshold: operations.riskTicketThreshold,
      // Set riskWindowDays on the structure being built.
      riskWindowDays: operations.riskWindowDays,
      // Set hotelTimezone on the structure being built.
      hotelTimezone: operations.hotelTimezone,
    },
    // Set flags on the structure being built.
    flags: {
      // Set show_overdue_banner on the structure being built.
      show_overdue_banner: flags.show_overdue_banner,
      // Set require_inspection on the structure being built.
      require_inspection: flags.require_inspection,
      // Set allow_reception_reassign on the structure being built.
      allow_reception_reassign: flags.allow_reception_reassign,
    },
  };
}

// Define throwVersionConflict — core behavior for this module.
function throwVersionConflict(input: {
  // Set key on the structure being built.
  key: SettingKey;
  // Set expectedVersion on the structure being built.
  expectedVersion: number;
  // Set currentVersion on the structure being built.
  currentVersion: number;
  // Set currentValue on the structure being built.
  currentValue: unknown;
// Run next step: }) {
}) {
  // Abort with an error so callers can react.
  throw new AppError(
    // Run next step: 409,
    409,
    // Run next step: "version_conflict",
    "version_conflict",
    // Run next step: `Setting ${input.key} was updated by another user`,
    `Setting ${input.key} was updated by another user`,
    // Run next step: {
    {
      // Set key on the structure being built.
      key: input.key,
      // Set expectedVersion on the structure being built.
      expectedVersion: input.expectedVersion,
      // Set currentVersion on the structure being built.
      currentVersion: input.currentVersion,
      // Set currentValue on the structure being built.
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
  // Set key on the structure being built.
  key: string;
  // Set value on the structure being built.
  value: unknown;
  // Set actorEmployeeId on the structure being built.
  actorEmployeeId: string;
  // Run next step: reason?: string;
  reason?: string;
  // Run next step: expectedVersion?: number;
  expectedVersion?: number;
// Run next step: }) {
}) {
  // Reject unknown keys before any DB work.
  if (!isSettingKey(input.key)) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", `Unknown setting key: ${input.key}`);
  }
  // Capture key for use in this scope.
  const key = input.key;
  // Capture schema for use in this scope.
  const schema = SETTING_SCHEMAS[key];
  // Capture value for use in this scope.
  let value = input.value;

  // Device push cannot be enabled without an adapter
  if (key === "notifications" && value && typeof value === "object") {
    // Build v object holding related fields.
    const v = { ...(value as Record<string, unknown>) };
    // Capture device for use in this scope.
    const device = v.device_push as { enabled?: boolean; status?: string } | undefined;
    // Force-disable regardless of client payload.
    if (device) {
      // Run next step: v.device_push = {
      v.device_push = {
        // Set enabled on the structure being built.
        enabled: false,
        // Set status on the structure being built.
        status: "not_configured",
      };
    }
    // Update value as control flow progresses.
    value = v;
  }

  // Zod validate the (possibly clamped) value.
  const parsed = schema.safeParse(value);
  // Branch when this condition holds so the right path runs.
  if (!parsed.success) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "Invalid setting value", parsed.error.flatten());
  }

  // Upsert + audit in one transaction; before is the locked/CAS-matched prior value.
  const updated = await prisma.$transaction(async (tx) => {
    // Load existing asynchronously for the next steps.
    const existing = await tx.appSetting.findUnique({ where: { key } });
    // Capture current version for use in this scope.
    const currentVersion = existing?.version ?? 0;
    // Capture cas version for use in this scope.
    const casVersion =
      // Run next step: input.expectedVersion !== undefined ? input.expectedVersion …
      input.expectedVersion !== undefined ? input.expectedVersion : currentVersion;

    // Branch when this condition holds so the right path runs.
    if (existing) {
      // Branch when this condition holds so the right path runs.
      if (input.expectedVersion !== undefined && input.expectedVersion !== currentVersion) {
        // Run next step: throwVersionConflict({
        throwVersionConflict({
          // Run next step: key,
          key,
          // Set expectedVersion on the structure being built.
          expectedVersion: input.expectedVersion,
          // Run next step: currentVersion,
          currentVersion,
          // Set currentValue on the structure being built.
          currentValue: existing.value,
        });
      }

      // Capture before for use in this scope.
      const before = existing.value;
      // Load bumped asynchronously for the next steps.
      const bumped = await tx.appSetting.updateMany({
        // Set where on the structure being built.
        where: { key, version: casVersion },
        // Set data on the structure being built.
        data: {
          // Set value on the structure being built.
          value: parsed.data as Prisma.InputJsonValue,
          // Set version on the structure being built.
          version: { increment: 1 },
          // Set updatedByEmployeeId on the structure being built.
          updatedByEmployeeId: input.actorEmployeeId,
        },
      });
      // Branch when this condition holds so the right path runs.
      if (bumped.count === 0) {
        // Load fresh asynchronously for the next steps.
        const fresh = await tx.appSetting.findUnique({ where: { key } });
        // Run next step: throwVersionConflict({
        throwVersionConflict({
          // Run next step: key,
          key,
          // Set expectedVersion on the structure being built.
          expectedVersion: casVersion,
          // Set currentVersion on the structure being built.
          currentVersion: fresh?.version ?? currentVersion,
          // Set currentValue on the structure being built.
          currentValue: fresh?.value ?? existing.value,
        });
      }

      // Wait for the async step before continuing.
      await recordAudit(
        // Run next step: {
        {
          // Set actorEmployeeId on the structure being built.
          actorEmployeeId: input.actorEmployeeId,
          // Set action on the structure being built.
          action: "setting.update",
          // Set entityType on the structure being built.
          entityType: "setting",
          // Set entityId on the structure being built.
          entityId: key,
          // Set reason on the structure being built.
          reason: input.reason,
          // Run next step: before,
          before,
          // Set after on the structure being built.
          after: parsed.data,
          // Set summary on the structure being built.
          summary: `Updated setting ${key}`,
        },
        // Run next step: tx,
        tx,
      );

      // Load row asynchronously for the next steps.
      const row = await tx.appSetting.findUniqueOrThrow({ where: { key } });
      // Return the computed result to the caller.
      return row;
    }

    // First write for this key: create; unique races surface as version_conflict.
    try {
      // Load row asynchronously for the next steps.
      const row = await tx.appSetting.create({
        // Set data on the structure being built.
        data: {
          // Run next step: key,
          key,
          // Set value on the structure being built.
          value: parsed.data as Prisma.InputJsonValue,
          // Set version on the structure being built.
          version: 1,
          // Set updatedByEmployeeId on the structure being built.
          updatedByEmployeeId: input.actorEmployeeId,
        },
      });
      // Wait for the async step before continuing.
      await recordAudit(
        // Run next step: {
        {
          // Set actorEmployeeId on the structure being built.
          actorEmployeeId: input.actorEmployeeId,
          // Set action on the structure being built.
          action: "setting.update",
          // Set entityType on the structure being built.
          entityType: "setting",
          // Set entityId on the structure being built.
          entityId: key,
          // Set reason on the structure being built.
          reason: input.reason,
          // Set before on the structure being built.
          before: DEFAULT_SETTINGS[key],
          // Set after on the structure being built.
          after: parsed.data,
          // Set summary on the structure being built.
          summary: `Updated setting ${key}`,
        },
        // Run next step: tx,
        tx,
      );
      // Return the computed result to the caller.
      return row;
    // Run next step: } catch (err) {
    } catch (err) {
      // Branch when this condition holds so the right path runs.
      if (isP2002(err)) {
        // Load fresh asynchronously for the next steps.
        const fresh = await tx.appSetting.findUnique({ where: { key } });
        // Run next step: throwVersionConflict({
        throwVersionConflict({
          // Run next step: key,
          key,
          // Set expectedVersion on the structure being built.
          expectedVersion: input.expectedVersion ?? 0,
          // Set currentVersion on the structure being built.
          currentVersion: fresh?.version ?? 1,
          // Set currentValue on the structure being built.
          currentValue: fresh?.value ?? DEFAULT_SETTINGS[key],
        });
      }
      // Abort with an error so callers can react.
      throw err;
    }
  });

  // Drop stale cache entry and notify live subscribers.
  invalidateCache(key);
  // Run next step: publish("settings.changed");
  publish("settings.changed");
  // Return the computed result to the caller.
  return {
    // Run next step: key,
    key,
    // Set value on the structure being built.
    value: parsed.data,
    // Set version on the structure being built.
    version: updated.version,
    // Set updatedAt on the structure being built.
    updatedAt: updated.updatedAt,
    // Set updatedByEmployeeId on the structure being built.
    updatedByEmployeeId: updated.updatedByEmployeeId,
  };
}

/** Audit trail for setting updates (optionally filtered to one key). */
export async function listSettingHistory(input: {
  // Run next step: key?: string;
  key?: string;
  // Run next step: limit?: number;
  limit?: number;
// Run next step: }) {
}) {
  // Reuse listAuditEvents with entityType=setting.
  const rows = await listAuditEvents({
    // Set entityType on the structure being built.
    entityType: "setting",
    // Only filter by entityId when the key is a known SettingKey.
    entityId: input.key && isSettingKey(input.key) ? input.key : undefined,
    // Set limit on the structure being built.
    limit: input.limit,
  });
  // Shape for the settings history UI (key alias of entityId).
  return rows.map((r) => ({
    // Set id on the structure being built.
    id: r.id,
    // Set key on the structure being built.
    key: r.entityId,
    // Set before on the structure being built.
    before: r.before,
    // Set after on the structure being built.
    after: r.after,
    // Set reason on the structure being built.
    reason: r.reason,
    // Set createdAt on the structure being built.
    createdAt: r.occurredAt,
    // System actor placeholder when actorEmployeeId was null.
    actor: r.actor ?? {
      // Set id on the structure being built.
      id: "",
      // Set fullName on the structure being built.
      fullName: "System",
      // Set employeeNumber on the structure being built.
      employeeNumber: "",
    },
  }));
}

/** Best-effort count; never throws — null means UNKNOWN, not zero. */
export async function safeEntityCount(
  // Set run on the structure being built.
  run: () => Promise<number>,
// Run next step: ): Promise<number | null> {
): Promise<number | null> {
  // Attempt the fallible work so errors can be handled below.
  try {
    // Return the computed result to the caller.
    return await run();
  // Run next step: } catch {
  } catch {
    // Return the computed result to the caller.
    return null;
  }
}

/** Optional count runners for tests (inject a failing query without mocking Prisma). */
export type SystemStatusCountFns = {
  // Set rooms on the structure being built.
  rooms: () => Promise<number>;
  // Set commonAreas on the structure being built.
  commonAreas: () => Promise<number>;
  // Set openTickets on the structure being built.
  openTickets: () => Promise<number>;
  // Set runningSessions on the structure being built.
  runningSessions: () => Promise<number>;
};

// Define defaultSystemCountFns — core behavior for this module.
function defaultSystemCountFns(): SystemStatusCountFns {
  // Return the computed result to the caller.
  return {
    // Set rooms on the structure being built.
    rooms: () =>
      // Persist or query via Prisma for durable state.
      prisma.location.count({
        // Set where on the structure being built.
        where: { kind: LocationKind.room, catalogStatus: "active" },
      }),
    // Set commonAreas on the structure being built.
    commonAreas: () =>
      // Persist or query via Prisma for durable state.
      prisma.location.count({
        // Set where on the structure being built.
        where: { kind: LocationKind.common_area, catalogStatus: "active" },
      }),
    // Set openTickets on the structure being built.
    openTickets: () =>
      // Persist or query via Prisma for durable state.
      prisma.maintenanceTicket.count({
        // Set where on the structure being built.
        where: { status: { in: [...OPEN_TICKET_STATUSES] } },
      }),
    // Set runningSessions on the structure being built.
    runningSessions: () =>
      // Persist or query via Prisma for durable state.
      prisma.cleaningSession.count({
        // Set where on the structure being built.
        where: { status: SessionStatus.running },
      }),
  };
}

/** Lightweight health: DB ping + coarse entity counts for admin status pages. */
export async function getSystemStatus(opts?: {
  // Run next step: counts?: Partial<SystemStatusCountFns>;
  counts?: Partial<SystemStatusCountFns>;
  /** Override ping; tests can force a DOWN database without killing the pool. */
  ping?: () => Promise<void>;
// Run next step: }) {
}) {
  // Capture t0 for use in this scope.
  const t0 = Date.now();
  // Capture db ok for use in this scope.
  let dbOk = false;
  // Capture db ping ms for use in this scope.
  let dbPingMs = 0;
  // Capture ping for use in this scope.
  const ping = opts?.ping ?? (async () => {
    // Wait for the async step before continuing.
    await prisma.$queryRaw`SELECT 1`;
  });
  // Best-effort ping; failures still return status with ok=false.
  try {
    // Wait for the async step before continuing.
    await ping();
    // Update db ok as control flow progresses.
    dbOk = true;
    // Update db ping ms as control flow progresses.
    dbPingMs = Date.now() - t0;
  // Run next step: } catch {
  } catch {
    // Update db ping ms as control flow progresses.
    dbPingMs = Date.now() - t0;
  }

  // Build runners object holding related fields.
  const runners = { ...defaultSystemCountFns(), ...opts?.counts };
  // Independent counts so one failure cannot reject the whole diagnostic payload.
  const [rooms, commonAreas, openTickets, runningSessions] = await Promise.all([
    // Run next step: safeEntityCount(runners.rooms),
    safeEntityCount(runners.rooms),
    // Run next step: safeEntityCount(runners.commonAreas),
    safeEntityCount(runners.commonAreas),
    // Run next step: safeEntityCount(runners.openTickets),
    safeEntityCount(runners.openTickets),
    // Run next step: safeEntityCount(runners.runningSessions),
    safeEntityCount(runners.runningSessions),
  ]);

  // Capture server time for use in this scope.
  const serverTime = new Date().toISOString();
  // Return the computed result to the caller.
  return {
    // Set api on the structure being built.
    api: { ok: true },
    // Set database on the structure being built.
    database: { ok: dbOk, pingMs: dbPingMs },
    // Set counts on the structure being built.
    counts: { rooms, commonAreas, openTickets, runningSessions },
    // Run next step: serverTime,
    serverTime,
    /** Wall-clock of this successful diagnostic assembly (client stale markers). */
    fetchedAt: serverTime,
    // Set version on the structure being built.
    version: process.env.npm_package_version ?? "0.1.0",
  };
}

/** Typed shortcut for feature flags settings. */
export async function getFlags(): Promise<FlagsSettings> {
  // Return the computed result to the caller.
  return getSetting("flags");
}

/** Typed shortcut for operations (timezone, SLA defaults, etc.). */
export async function getOperations(): Promise<OperationsSettings> {
  // Return the computed result to the caller.
  return getSetting("operations");
}

/** Typed shortcut for access / invitation policy settings. */
export async function getAccess(): Promise<AccessSettings> {
  // Return the computed result to the caller.
  return getSetting("access");
}
