/**
 * API-side fixtures for E2E flows (setup only; asserted actions stay in the UI).
 */
import { expect } from "@playwright/test";
import { apiGet, apiLogin, apiPatch, apiPost, API_ORIGIN } from "./api";
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

/** Pick an active room and force vacant + dirty for a clean cleaning cycle. */
export async function prepareVacantDirtyRoom(token: string): Promise<RoomRow> {
  const rooms = await listRooms(token);
  const room = rooms[0];
  expect(room, "need at least one active room").toBeTruthy();
  await apiPatch(token, `/locations/${room!.id}/occupancy`, {
    occupancy: "vacant",
  });
  await apiPatch(token, `/locations/${room!.id}/service-status`, {
    serviceStatus: "in_service",
  });
  await apiPost(token, `/rooms/${room!.id}/mark-dirty`, {});
  return getRoom(token, room!.id);
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
  // Prefer hotel "today" from operations settings when available.
  const settings = await apiGet(token, "/settings");
  const ops = (settings.body as { operations?: { value?: { hotelTimezone?: string } } })
    .operations?.value;
  const tz = ops?.hotelTimezone ?? "Europe/Sofia";
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
  expect(
    started.status,
    `HK start → ${started.status} ${JSON.stringify(started.body)}`,
  ).toBe(200);
  return { taskId: task.id };
}

export { API_ORIGIN };
