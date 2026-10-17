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

  const put = await apiPut(token, `/sectors/${sector!.id}/locations`, {
    locationIds: [...sector!.locationIds, locationId],
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
  const started = await apiPost(hk.token, `/cleaning/tasks/${task.id}/start`, {
    commandId: crypto.randomUUID(),
    expectedVersion: task.version,
  });
  // First start returns 201; idempotent replay returns 200.
  expect(
    started.status,
    `HK start → ${started.status} ${JSON.stringify(started.body)}`,
  ).toBe(201);
  return { taskId: task.id };
}

export { API_ORIGIN };
