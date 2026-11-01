/**
 * API-side fixtures for E2E flows (setup only; asserted actions stay in the UI).
 */
import { expect } from "@playwright/test";
import { apiGet, apiLogin, apiPatch, apiPost, apiPut, API_ORIGIN } from "./api";
import { USERS } from "./auth";

export type RoomRow = {
  id: string;
  number: string;
  readiness?: string;
  readinessReasons?: string[];
  occupancy?: string;
  cleaningStatus?: string;
  catalogStatus?: string;
};

export async function ownerApi() {
  return apiLogin(USERS.owner);
}

export async function listRooms(token: string): Promise<RoomRow[]> {
  const res = await apiGet(token, "/rooms");
  expect(res.status).toBe(200);
  return res.body as RoomRow[];
}

export async function getRoom(token: string, id: string): Promise<RoomRow> {
  const res = await apiGet(token, `/rooms/${id}`);
  expect(res.status).toBe(200);
  return res.body as RoomRow;
}

/** Hotel calendar "today" (YYYY-MM-DD) from operations settings when available. */
export async function hotelToday(token: string): Promise<string> {
  const settings = await apiGet(token, "/settings");
  const ops = (
    settings.body as { operations?: { value?: { hotelTimezone?: string } } }
  ).operations?.value;
  const tz = ops?.hotelTimezone ?? "Europe/Sofia";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function forceVacantDirty(token: string, roomId: string): Promise<RoomRow> {
  await apiPatch(token, `/locations/${roomId}/occupancy`, {
    occupancy: "vacant",
  });
  await apiPatch(token, `/locations/${roomId}/service-status`, {
    serviceStatus: "in_service",
  });
  await apiPost(token, `/rooms/${roomId}/mark-dirty`, {});
  return getRoom(token, roomId);
}

/**
 * Attach a location to a sector supervised by the demo supervisor so
 * supervisor-scoped Rooms UI can see it (without wiping other memberships).
 */
export async function ensureRoomInSupervisorSector(
  token: string,
  locationId: string,
): Promise<void> {
  const people = await apiGet(token, "/people");
  expect(people.status).toBe(200);
  const supervisor = (
    people.body as Array<{ email?: string; employeeId?: string }>
  ).find((p) => (p.email ?? "").toLowerCase() === USERS.supervisor.toLowerCase());
  expect(supervisor?.employeeId, "supervisor employeeId").toBeTruthy();

  const sectorsRes = await apiGet(token, "/sectors");
  expect(sectorsRes.status).toBe(200);
  const sectors = sectorsRes.body as Array<{
    id: string;
    isActive: boolean;
    version?: number;
    primarySupervisor: { id: string } | null;
    locationIds: string[];
  }>;
  const sector = sectors.find(
    (s) =>
      s.isActive &&
      s.primarySupervisor?.id === supervisor!.employeeId,
  );
  expect(sector, "need active sector for demo supervisor").toBeTruthy();

  if (sector!.locationIds.includes(locationId)) return;

  const detail = await apiGet(token, `/sectors/${sector!.id}`);
  expect(detail.status).toBe(200);
  const version = (detail.body as { version: number }).version;

  const put = await apiPut(token, `/sectors/${sector!.id}/locations`, {
    locationIds: [...sector!.locationIds, locationId],
    expectedVersion: version,
  });
  expect(
    put.status,
    `sector membership → ${put.status} ${JSON.stringify(put.body)}`,
  ).toBe(200);
}

/**
 * Create an isolated vacant+dirty room (unique number) with no active cleaning
 * task, attached to the demo supervisor's sector so HK + supervisor scopes see it.
 */
export async function prepareVacantDirtyRoom(token: string): Promise<RoomRow> {
  const hier = await apiGet(token, "/locations/hierarchy");
  expect(hier.status).toBe(200);
  const buildings = hier.body as Array<{
    floors: Array<{ id: string }>;
  }>;
  const floorId = buildings[0]?.floors[0]?.id;
  expect(floorId, "need a floor to create an isolated room").toBeTruthy();

  const number = `E2E${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const created = await apiPost(token, "/locations", {
    floorId,
    number,
    kind: "room",
    occupancy: "vacant",
    serviceStatus: "in_service",
  });
  expect(
    created.status,
    `create location → ${created.status} ${JSON.stringify(created.body)}`,
  ).toBe(201);
  const room = created.body as RoomRow;
  await ensureRoomInSupervisorSector(token, room.id);
  return forceVacantDirty(token, room.id);
}

export async function findActiveIssueOption(token: string): Promise<{
  id: string;
  maintenanceCategoryId: string;
}> {
  const res = await apiGet(token, "/maintenance/issue-options");
  expect(res.status).toBe(200);
  const options = res.body as Array<{
    id: string;
    isActive?: boolean;
    maintenanceCategoryId: string;
  }>;
  const opt = options.find((o) => o.isActive !== false) ?? options[0];
  expect(opt, "need issue option").toBeTruthy();
  return opt!;
}

export async function findHousekeeperEmployeeId(
  token: string,
): Promise<string> {
  const res = await apiGet(token, "/people");
  expect(res.status).toBe(200);
  const people = res.body as Array<{
    employeeId?: string;
    email?: string;
    role?: string;
  }>;
  const hk = people.find(
    (p) => (p.email ?? "").toLowerCase() === USERS.housekeeper.toLowerCase(),
  );
  expect(hk?.employeeId, "housekeeper employeeId").toBeTruthy();
  return hk!.employeeId!;
}

export async function findTechnicianEmployeeId(
  token: string,
): Promise<string> {
  const res = await apiGet(token, "/people");
  expect(res.status).toBe(200);
  const people = res.body as Array<{
    employeeId?: string;
    email?: string;
  }>;
  const tech = people.find(
    (p) => (p.email ?? "").toLowerCase() === USERS.technician.toLowerCase(),
  );
  expect(tech?.employeeId, "technician employeeId").toBeTruthy();
  return tech!.employeeId!;
}

/**
 * Create a dedicated technician (new employee+user) via invite+redeem.
 * Does not mutate seed roles such as Elena.
 */
export async function createDedicatedTechnician(
  ownerToken: string,
): Promise<{ employeeId: string; email: string }> {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-tech2-${stamp}@test.local`;
  const employeeNumber = `E2E-T2-${stamp}`.slice(0, 32);
  const issue = await apiPost(ownerToken, "/invitations", {
    kind: "new",
    fullName: `E2E Tech Two ${stamp}`,
    employeeNumber,
    email,
    role: "technician",
  });
  expect(
    issue.status,
    `issue invite → ${issue.status} ${JSON.stringify(issue.body)}`,
  ).toBe(201);
  const code = (issue.body as { code?: string }).code;
  const invitationEmployeeId = (
    issue.body as { invitation?: { employeeId?: string } }
  ).invitation?.employeeId;
  expect(code, "invite code").toBeTruthy();
  expect(invitationEmployeeId, "invite employeeId").toBeTruthy();

  const redeem = await fetch(`${API_ORIGIN}/invitations/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      password: "demo1234",
      deviceLabel: `e2e-${stamp}`,
      fingerprint: `fp-${stamp}`,
    }),
  });
  expect(
    redeem.ok,
    `redeem invite → ${redeem.status} ${await redeem.text()}`,
  ).toBeTruthy();

  return { employeeId: invitationEmployeeId!, email };
}

export async function createBlockingTicket(
  token: string,
  locationId: string,
): Promise<{ id: string }> {
  const opt = await findActiveIssueOption(token);
  const res = await apiPost(token, "/maintenance/tickets", {
    locationId,
    issueOptionId: opt.id,
    blocksRoom: true,
    commandId: crypto.randomUUID(),
    allowDuplicate: true,
    duplicateOverrideReason: "e2e createBlockingTicket fixture",
  });
  expect(
    res.status === 200 || res.status === 201,
    `create ticket → ${res.status}`,
  ).toBeTruthy();
  return res.body as { id: string };
}

export async function assignAndStartTicket(
  token: string,
  ticketId: string,
  technicianEmployeeId: string,
): Promise<void> {
  const assign = await apiPost(token, `/maintenance/tickets/${ticketId}/assign`, {
    assigneeId: technicianEmployeeId,
  });
  expect(assign.status).toBe(200);
  // Owner can start with bypass
  const start = await apiPost(token, `/maintenance/tickets/${ticketId}/start`, {
    commandId: crypto.randomUUID(),
  });
  expect(start.status).toBe(200);
}

export async function resolveTicket(
  token: string,
  ticketId: string,
  notes = "e2e resolve",
): Promise<void> {
  const res = await apiPost(token, `/maintenance/tickets/${ticketId}/resolve`, {
    commandId: crypto.randomUUID(),
    resolutionNotes: notes,
  });
  expect(res.status).toBe(200);
}

export async function reopenTicket(
  token: string,
  ticketId: string,
  reason = "e2e reopen",
): Promise<void> {
  const res = await apiPost(token, `/maintenance/tickets/${ticketId}/reopen`, {
    reason,
  });
  expect(res.status).toBe(200);
}

export async function createAndStartCleaningTask(
  token: string,
  locationId: string,
  housekeeperEmployeeId: string,
): Promise<{ taskId: string }> {
  const today = await hotelToday(token);
  const create = await apiPost(token, "/cleaning/tasks", {
    locationId,
    hotelDate: today,
    assignedEmployeeId: housekeeperEmployeeId,
  });
  expect(
    create.status === 200 || create.status === 201,
    `create cleaning → ${create.status} ${JSON.stringify(create.body)}`,
  ).toBeTruthy();
  const task = create.body as { id: string; version: number };
  const hk = await apiLogin(USERS.housekeeper);
  let started = await apiPost(hk.token, `/cleaning/tasks/${task.id}/start`, {
    commandId: crypto.randomUUID(),
    expectedVersion: task.version,
  });
  // Prior Playwright tests may leave the shared demo HK with a running session.
  if (
    started.status === 409 &&
    JSON.stringify(started.body).includes("already has a running session")
  ) {
    const ops = await apiGet(token, "/operations/live");
    if (ops.status === 200) {
      const sessions = (
        ops.body as {
          activeSessions?: Array<{
            sessionId: string;
            employee?: { id?: string };
          }>;
        }
      ).activeSessions ?? [];
      for (const session of sessions) {
        if (session.employee?.id === housekeeperEmployeeId) {
          await apiPost(
            hk.token,
            `/cleaning/sessions/${session.sessionId}/complete`,
            {
              commandId: crypto.randomUUID(),
              notes: "e2e clear shared HK session",
            },
          );
        }
      }
    }
    started = await apiPost(hk.token, `/cleaning/tasks/${task.id}/start`, {
      commandId: crypto.randomUUID(),
      expectedVersion: task.version,
    });
  }
  // First start returns 201; idempotent replay returns 200.
  expect(
    started.status,
    `HK start → ${started.status} ${JSON.stringify(started.body)}`,
  ).toBe(201);
  return { taskId: task.id };
}

export { API_ORIGIN };
