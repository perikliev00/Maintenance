/**
 * API-side fixtures for E2E flows (setup only; asserted actions stay in the UI).
 */
import { expect } from "@playwright/test";
// Import bindings from ./api.
import { apiGet, apiLogin, apiPatch, apiPost, apiPut, API_ORIGIN } from "./api";
// Import bindings from ./auth.
import { USERS } from "./auth";

// Export RoomRow for shared test/setup consumers.
export type RoomRow = {
  // Execute the next setup or assertion step for this scenario.
  id: string;
  // Execute the next setup or assertion step for this scenario.
  number: string;
  // Execute the next setup or assertion step for this scenario.
  readiness?: string;
  // Execute the next setup or assertion step for this scenario.
  readinessReasons?: string[];
  // Execute the next setup or assertion step for this scenario.
  occupancy?: string;
  // Execute the next setup or assertion step for this scenario.
  cleaningStatus?: string;
  // Execute the next setup or assertion step for this scenario.
  catalogStatus?: string;
};

// Export helper ownerApi for reuse across related tests.
export async function ownerApi() {
  // Return the arranged value/result to the caller.
  return apiLogin(USERS.owner);
}

// Export helper listRooms for reuse across related tests.
export async function listRooms(token: string): Promise<RoomRow[]> {
  // res: HTTP response captured for status/body checks.
  const res = await apiGet(token, "/rooms");
  // Assert response/page reached the expected status.
  expect(res.status).toBe(200);
  // Return the arranged value/result to the caller.
  return res.body as RoomRow[];
}

// Export helper getRoom for reuse across related tests.
export async function getRoom(token: string, id: string): Promise<RoomRow> {
  // res: HTTP response captured for status/body checks.
  const res = await apiGet(token, `/rooms/${id}`);
  // Assert response/page reached the expected status.
  expect(res.status).toBe(200);
  // Return the arranged value/result to the caller.
  return res.body as RoomRow;
}

/** Hotel calendar "today" (YYYY-MM-DD) from operations settings when available. */
export async function hotelToday(token: string): Promise<string> {
  // settings: HTTP response captured for status/body checks.
  const settings = await apiGet(token, "/settings");
  // Bind ops for later setup or assertions in this scope.
  const ops = (
    // Execute the next setup or assertion step for this scenario.
    settings.body as { operations?: { value?: { hotelTimezone?: string } } }
  // Execute the next setup or assertion step for this scenario.
  ).operations?.value;
  // Bind tz for later setup or assertions in this scope.
  const tz = ops?.hotelTimezone ?? "Europe/Sofia";
  // Return the arranged value/result to the caller.
  return new Intl.DateTimeFormat("en-CA", {
    // Execute the next setup or assertion step for this scenario.
    timeZone: tz,
    // Execute the next setup or assertion step for this scenario.
    year: "numeric",
    // Execute the next setup or assertion step for this scenario.
    month: "2-digit",
    // Execute the next setup or assertion step for this scenario.
    day: "2-digit",
  // Execute the next setup or assertion step for this scenario.
  }).format(new Date());
}

// Local helper forceVacantDirty used by cases in this file.
async function forceVacantDirty(token: string, roomId: string): Promise<RoomRow> {
  // Await async work before asserting or releasing locks.
  await apiPatch(token, `/locations/${roomId}/occupancy`, {
    // Execute the next setup or assertion step for this scenario.
    occupancy: "vacant",
  });
  // Await async work before asserting or releasing locks.
  await apiPatch(token, `/locations/${roomId}/service-status`, {
    // Execute the next setup or assertion step for this scenario.
    serviceStatus: "in_service",
  });
  // Await async work before asserting or releasing locks.
  await apiPost(token, `/rooms/${roomId}/mark-dirty`, {});
  // Return the arranged value/result to the caller.
  return getRoom(token, roomId);
}

/**
 * Attach a location to a sector supervised by the demo supervisor so
 * supervisor-scoped Rooms UI can see it (without wiping other memberships).
 */
export async function ensureRoomInSupervisorSector(
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  locationId: string,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // people: HTTP response captured for status/body checks.
  const people = await apiGet(token, "/people");
  // Assert response/page reached the expected status.
  expect(people.status).toBe(200);
  // Bind supervisor for later setup or assertions in this scope.
  const supervisor = (
    // Execute the next setup or assertion step for this scenario.
    people.body as Array<{ email?: string; employeeId?: string }>
  // Execute the next setup or assertion step for this scenario.
  ).find((p) => (p.email ?? "").toLowerCase() === USERS.supervisor.toLowerCase());
  // Assert browser/UI outcome matches the scenario intent.
  expect(supervisor?.employeeId, "supervisor employeeId").toBeTruthy();

  // sectorsRes: HTTP response captured for status/body checks.
  const sectorsRes = await apiGet(token, "/sectors");
  // Assert response/page reached the expected status.
  expect(sectorsRes.status).toBe(200);
  // Bind sectors for later setup or assertions in this scope.
  const sectors = sectorsRes.body as Array<{
    // Execute the next setup or assertion step for this scenario.
    id: string;
    // Execute the next setup or assertion step for this scenario.
    isActive: boolean;
    // Execute the next setup or assertion step for this scenario.
    version?: number;
    // Execute the next setup or assertion step for this scenario.
    primarySupervisor: { id: string } | null;
    // Execute the next setup or assertion step for this scenario.
    locationIds: string[];
  // Execute the next setup or assertion step for this scenario.
  }>;
  // Bind sector for later setup or assertions in this scope.
  const sector = sectors.find(
    // Execute the next setup or assertion step for this scenario.
    (s) =>
      // Execute the next setup or assertion step for this scenario.
      s.isActive &&
      // Execute the next setup or assertion step for this scenario.
      s.primarySupervisor?.id === supervisor!.employeeId,
  );
  // Assert browser/UI outcome matches the scenario intent.
  expect(sector, "need active sector for demo supervisor").toBeTruthy();

  // Conditional path for setup, cleanup, or alternate outcomes.
  if (sector!.locationIds.includes(locationId)) return;

  // detail: HTTP response captured for status/body checks.
  const detail = await apiGet(token, `/sectors/${sector!.id}`);
  // Assert response/page reached the expected status.
  expect(detail.status).toBe(200);
  // Bind version for later setup or assertions in this scope.
  const version = (detail.body as { version: number }).version;

  // put: HTTP response captured for status/body checks.
  const put = await apiPut(token, `/sectors/${sector!.id}/locations`, {
    // Execute the next setup or assertion step for this scenario.
    locationIds: [...sector!.locationIds, locationId],
    // Execute the next setup or assertion step for this scenario.
    expectedVersion: version,
  });
  // Assert browser/UI outcome matches the scenario intent.
  expect(
    // Execute the next setup or assertion step for this scenario.
    put.status,
    // Execute the next setup or assertion step for this scenario.
    `sector membership → ${put.status} ${JSON.stringify(put.body)}`,
  // Execute the next setup or assertion step for this scenario.
  ).toBe(200);
}

/**
 * Create an isolated vacant+dirty room (unique number) with no active cleaning
 * task, attached to the demo supervisor's sector so HK + supervisor scopes see it.
 */
export async function prepareVacantDirtyRoom(token: string): Promise<RoomRow> {
  // hier: HTTP response captured for status/body checks.
  const hier = await apiGet(token, "/locations/hierarchy");
  // Assert response/page reached the expected status.
  expect(hier.status).toBe(200);
  // Bind buildings for later setup or assertions in this scope.
  const buildings = hier.body as Array<{
    // Execute the next setup or assertion step for this scenario.
    floors: Array<{ id: string }>;
  // Execute the next setup or assertion step for this scenario.
  }>;
  // floorId: unique stamp so parallel runs do not collide.
  const floorId = buildings[0]?.floors[0]?.id;
  // Assert browser/UI outcome matches the scenario intent.
  expect(floorId, "need a floor to create an isolated room").toBeTruthy();

  // Bind number for later setup or assertions in this scope.
  const number = `E2E${Date.now().toString(36).slice(-5).toUpperCase()}`;
  // created: seeded entity required before the mutation under test.
  const created = await apiPost(token, "/locations", {
    // Execute the next setup or assertion step for this scenario.
    floorId,
    // Execute the next setup or assertion step for this scenario.
    number,
    // Execute the next setup or assertion step for this scenario.
    kind: "room",
    // Execute the next setup or assertion step for this scenario.
    occupancy: "vacant",
    // Execute the next setup or assertion step for this scenario.
    serviceStatus: "in_service",
  });
  // Assert browser/UI outcome matches the scenario intent.
  expect(
    // Execute the next setup or assertion step for this scenario.
    created.status,
    // Execute the next setup or assertion step for this scenario.
    `create location → ${created.status} ${JSON.stringify(created.body)}`,
  // Execute the next setup or assertion step for this scenario.
  ).toBe(201);
  // Bind room for later setup or assertions in this scope.
  const room = created.body as RoomRow;
  // Await async work before asserting or releasing locks.
  await ensureRoomInSupervisorSector(token, room.id);
  // Return the arranged value/result to the caller.
  return forceVacantDirty(token, room.id);
}

// Export helper findActiveIssueOption for reuse across related tests.
export async function findActiveIssueOption(token: string): Promise<{
  // Execute the next setup or assertion step for this scenario.
  id: string;
  // Execute the next setup or assertion step for this scenario.
  maintenanceCategoryId: string;
// Execute the next setup or assertion step for this scenario.
}> {
  // res: HTTP response captured for status/body checks.
  const res = await apiGet(token, "/maintenance/issue-options");
  // Assert response/page reached the expected status.
  expect(res.status).toBe(200);
  // Bind options for later setup or assertions in this scope.
  const options = res.body as Array<{
    // Execute the next setup or assertion step for this scenario.
    id: string;
    // Execute the next setup or assertion step for this scenario.
    isActive?: boolean;
    // Execute the next setup or assertion step for this scenario.
    maintenanceCategoryId: string;
  // Execute the next setup or assertion step for this scenario.
  }>;
  // Bind opt for later setup or assertions in this scope.
  const opt = options.find((o) => o.isActive !== false) ?? options[0];
  // Assert browser/UI outcome matches the scenario intent.
  expect(opt, "need issue option").toBeTruthy();
  // Return the arranged value/result to the caller.
  return opt!;
}

// Export helper findHousekeeperEmployeeId for reuse across related tests.
export async function findHousekeeperEmployeeId(
  // Execute the next setup or assertion step for this scenario.
  token: string,
// Execute the next setup or assertion step for this scenario.
): Promise<string> {
  // res: HTTP response captured for status/body checks.
  const res = await apiGet(token, "/people");
  // Assert response/page reached the expected status.
  expect(res.status).toBe(200);
  // Bind people for later setup or assertions in this scope.
  const people = res.body as Array<{
    // Execute the next setup or assertion step for this scenario.
    employeeId?: string;
    // Execute the next setup or assertion step for this scenario.
    email?: string;
    // Execute the next setup or assertion step for this scenario.
    role?: string;
  // Execute the next setup or assertion step for this scenario.
  }>;
  // Bind hk for later setup or assertions in this scope.
  const hk = people.find(
    // Execute the next setup or assertion step for this scenario.
    (p) => (p.email ?? "").toLowerCase() === USERS.housekeeper.toLowerCase(),
  );
  // Assert browser/UI outcome matches the scenario intent.
  expect(hk?.employeeId, "housekeeper employeeId").toBeTruthy();
  // Return the arranged value/result to the caller.
  return hk!.employeeId!;
}

// Export helper findTechnicianEmployeeId for reuse across related tests.
export async function findTechnicianEmployeeId(
  // Execute the next setup or assertion step for this scenario.
  token: string,
// Execute the next setup or assertion step for this scenario.
): Promise<string> {
  // res: HTTP response captured for status/body checks.
  const res = await apiGet(token, "/people");
  // Assert response/page reached the expected status.
  expect(res.status).toBe(200);
  // Bind people for later setup or assertions in this scope.
  const people = res.body as Array<{
    // Execute the next setup or assertion step for this scenario.
    employeeId?: string;
    // Execute the next setup or assertion step for this scenario.
    email?: string;
  // Execute the next setup or assertion step for this scenario.
  }>;
  // Bind tech for later setup or assertions in this scope.
  const tech = people.find(
    // Execute the next setup or assertion step for this scenario.
    (p) => (p.email ?? "").toLowerCase() === USERS.technician.toLowerCase(),
  );
  // Assert browser/UI outcome matches the scenario intent.
  expect(tech?.employeeId, "technician employeeId").toBeTruthy();
  // Return the arranged value/result to the caller.
  return tech!.employeeId!;
}

/**
 * Create a dedicated technician (new employee+user) via invite+redeem.
 * Does not mutate seed roles such as Elena.
 */
export async function createDedicatedTechnician(
  // Execute the next setup or assertion step for this scenario.
  ownerToken: string,
// Execute the next setup or assertion step for this scenario.
): Promise<{ employeeId: string; email: string }> {
  // stamp: unique stamp so parallel runs do not collide.
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Bind email for later setup or assertions in this scope.
  const email = `e2e-tech2-${stamp}@test.local`;
  // Bind employeeNumber for later setup or assertions in this scope.
  const employeeNumber = `E2E-T2-${stamp}`.slice(0, 32);
  // issue: HTTP response captured for status/body checks.
  const issue = await apiPost(ownerToken, "/invitations", {
    // Execute the next setup or assertion step for this scenario.
    kind: "new",
    // Fixture field fullName for the seeded actor/entity.
    fullName: `E2E Tech Two ${stamp}`,
    // Execute the next setup or assertion step for this scenario.
    employeeNumber,
    // Execute the next setup or assertion step for this scenario.
    email,
    // Fixture field role for the seeded actor/entity.
    role: "technician",
  });
  // Assert browser/UI outcome matches the scenario intent.
  expect(
    // Execute the next setup or assertion step for this scenario.
    issue.status,
    // Execute the next setup or assertion step for this scenario.
    `issue invite → ${issue.status} ${JSON.stringify(issue.body)}`,
  // Execute the next setup or assertion step for this scenario.
  ).toBe(201);
  // Bind code for later setup or assertions in this scope.
  const code = (issue.body as { code?: string }).code;
  // invitationEmployeeId: unique stamp so parallel runs do not collide.
  const invitationEmployeeId = (
    // Execute the next setup or assertion step for this scenario.
    issue.body as { invitation?: { employeeId?: string } }
  // Execute the next setup or assertion step for this scenario.
  ).invitation?.employeeId;
  // Assert browser/UI outcome matches the scenario intent.
  expect(code, "invite code").toBeTruthy();
  // Assert browser/UI outcome matches the scenario intent.
  expect(invitationEmployeeId, "invite employeeId").toBeTruthy();

  // redeem: HTTP response captured for status/body checks.
  const redeem = await fetch(`${API_ORIGIN}/invitations/redeem`, {
    // Configure method for the request/server under test.
    method: "POST",
    // Configure headers for the request/server under test.
    headers: { "Content-Type": "application/json" },
    // Configure body for the request/server under test.
    body: JSON.stringify({
      // Execute the next setup or assertion step for this scenario.
      code,
      // Fixture field password for the seeded actor/entity.
      password: "demo1234",
      // Execute the next setup or assertion step for this scenario.
      deviceLabel: `e2e-${stamp}`,
      // Execute the next setup or assertion step for this scenario.
      fingerprint: `fp-${stamp}`,
    }),
  });
  // Assert browser/UI outcome matches the scenario intent.
  expect(
    // Execute the next setup or assertion step for this scenario.
    redeem.ok,
    // Await async work before asserting or releasing locks.
    `redeem invite → ${redeem.status} ${await redeem.text()}`,
  // Execute the next setup or assertion step for this scenario.
  ).toBeTruthy();

  // Return the arranged value/result to the caller.
  return { employeeId: invitationEmployeeId!, email };
}

// Export helper createBlockingTicket for reuse across related tests.
export async function createBlockingTicket(
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  locationId: string,
// Execute the next setup or assertion step for this scenario.
): Promise<{ id: string }> {
  // opt: synchronize actors so the race window is observable.
  const opt = await findActiveIssueOption(token);
  // res: HTTP response captured for status/body checks.
  const res = await apiPost(token, "/maintenance/tickets", {
    // Execute the next setup or assertion step for this scenario.
    locationId,
    // Execute the next setup or assertion step for this scenario.
    issueOptionId: opt.id,
    // Concurrency/isolation step for the race under test.
    blocksRoom: true,
    // Execute the next setup or assertion step for this scenario.
    commandId: crypto.randomUUID(),
    // Execute the next setup or assertion step for this scenario.
    allowDuplicate: true,
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    duplicateOverrideReason: "e2e createBlockingTicket fixture",
  });
  // Assert browser/UI outcome matches the scenario intent.
  expect(
    // Execute the next setup or assertion step for this scenario.
    res.status === 200 || res.status === 201,
    // Execute the next setup or assertion step for this scenario.
    `create ticket → ${res.status}`,
  // Execute the next setup or assertion step for this scenario.
  ).toBeTruthy();
  // Return the arranged value/result to the caller.
  return res.body as { id: string };
}

// Export helper assignAndStartTicket for reuse across related tests.
export async function assignAndStartTicket(
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  ticketId: string,
  // Execute the next setup or assertion step for this scenario.
  technicianEmployeeId: string,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // assign: HTTP response captured for status/body checks.
  const assign = await apiPost(token, `/maintenance/tickets/${ticketId}/assign`, {
    // Execute the next setup or assertion step for this scenario.
    assigneeId: technicianEmployeeId,
  });
  // Assert response/page reached the expected status.
  expect(assign.status).toBe(200);
  // Owner can start with bypass
  const start = await apiPost(token, `/maintenance/tickets/${ticketId}/start`, {
    // Execute the next setup or assertion step for this scenario.
    commandId: crypto.randomUUID(),
  });
  // Assert response/page reached the expected status.
  expect(start.status).toBe(200);
}

// Export helper resolveTicket for reuse across related tests.
export async function resolveTicket(
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  ticketId: string,
  // Execute the next setup or assertion step for this scenario.
  notes = "e2e resolve",
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // res: HTTP response captured for status/body checks.
  const res = await apiPost(token, `/maintenance/tickets/${ticketId}/resolve`, {
    // Execute the next setup or assertion step for this scenario.
    commandId: crypto.randomUUID(),
    // Execute the next setup or assertion step for this scenario.
    resolutionNotes: notes,
  });
  // Assert response/page reached the expected status.
  expect(res.status).toBe(200);
}

// Export helper reopenTicket for reuse across related tests.
export async function reopenTicket(
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  ticketId: string,
  // Execute the next setup or assertion step for this scenario.
  reason = "e2e reopen",
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // res: HTTP response captured for status/body checks.
  const res = await apiPost(token, `/maintenance/tickets/${ticketId}/reopen`, {
    // Execute the next setup or assertion step for this scenario.
    reason,
  });
  // Assert response/page reached the expected status.
  expect(res.status).toBe(200);
}

// Export helper createAndStartCleaningTask for reuse across related tests.
export async function createAndStartCleaningTask(
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  locationId: string,
  // Execute the next setup or assertion step for this scenario.
  housekeeperEmployeeId: string,
// Execute the next setup or assertion step for this scenario.
): Promise<{ taskId: string }> {
  // today: synchronize actors so the race window is observable.
  const today = await hotelToday(token);
  // create: seeded entity required before the mutation under test.
  const create = await apiPost(token, "/cleaning/tasks", {
    // Execute the next setup or assertion step for this scenario.
    locationId,
    // Execute the next setup or assertion step for this scenario.
    hotelDate: today,
    // Execute the next setup or assertion step for this scenario.
    assignedEmployeeId: housekeeperEmployeeId,
  });
  // Assert browser/UI outcome matches the scenario intent.
  expect(
    // Execute the next setup or assertion step for this scenario.
    create.status === 200 || create.status === 201,
    // Execute the next setup or assertion step for this scenario.
    `create cleaning → ${create.status} ${JSON.stringify(create.body)}`,
  // Execute the next setup or assertion step for this scenario.
  ).toBeTruthy();
  // Bind task for later setup or assertions in this scope.
  const task = create.body as { id: string; version: number };
  // hk: synchronize actors so the race window is observable.
  const hk = await apiLogin(USERS.housekeeper);
  // started: HTTP response captured for status/body checks.
  let started = await apiPost(hk.token, `/cleaning/tasks/${task.id}/start`, {
    // Execute the next setup or assertion step for this scenario.
    commandId: crypto.randomUUID(),
    // Execute the next setup or assertion step for this scenario.
    expectedVersion: task.version,
  });
  // Prior Playwright tests may leave the shared demo HK with a running session.
  if (
    // Execute the next setup or assertion step for this scenario.
    started.status === 409 &&
    // Session/CSRF step exercising auth lifecycle.
    JSON.stringify(started.body).includes("already has a running session")
  // Execute the next setup or assertion step for this scenario.
  ) {
    // ops: HTTP response captured for status/body checks.
    const ops = await apiGet(token, "/operations/live");
    // Guard optional cleanup or alternate assertion paths.
    if (ops.status === 200) {
      // sessions: session cookie jar for authenticated requests.
      const sessions = (
        // Execute the next setup or assertion step for this scenario.
        ops.body as {
          // Session/CSRF step exercising auth lifecycle.
          activeSessions?: Array<{
            // Session/CSRF step exercising auth lifecycle.
            sessionId: string;
            // Execute the next setup or assertion step for this scenario.
            employee?: { id?: string };
          // Execute the next setup or assertion step for this scenario.
          }>;
        }
      // Session/CSRF step exercising auth lifecycle.
      ).activeSessions ?? [];
      // Iterate to cover variants or wait until a condition holds.
      for (const session of sessions) {
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (session.employee?.id === housekeeperEmployeeId) {
          // Await async work before asserting or releasing locks.
          await apiPost(
            // Execute the next setup or assertion step for this scenario.
            hk.token,
            // Session/CSRF step exercising auth lifecycle.
            `/cleaning/sessions/${session.sessionId}/complete`,
            {
              // Execute the next setup or assertion step for this scenario.
              commandId: crypto.randomUUID(),
              // Session/CSRF step exercising auth lifecycle.
              notes: "e2e clear shared HK session",
            },
          );
        }
      }
    }
    // Await async work before asserting or releasing locks.
    started = await apiPost(hk.token, `/cleaning/tasks/${task.id}/start`, {
      // Execute the next setup or assertion step for this scenario.
      commandId: crypto.randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      expectedVersion: task.version,
    });
  }
  // First start returns 201; idempotent replay returns 200.
  expect(
    // Execute the next setup or assertion step for this scenario.
    started.status,
    // Execute the next setup or assertion step for this scenario.
    `HK start → ${started.status} ${JSON.stringify(started.body)}`,
  // Execute the next setup or assertion step for this scenario.
  ).toBe(201);
  // Return the arranged value/result to the caller.
  return { taskId: task.id };
}

// Re-export selected symbols for suite consumers.
export { API_ORIGIN };
