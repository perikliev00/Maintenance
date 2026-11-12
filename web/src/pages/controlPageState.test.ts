/**
 * Regression coverage for Control page P2 defects –10.
 */
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency from ./locations/busyIds.
import { addBusyId, isBusy, removeBusyId } from "./locations/busyIds";
// Import module dependency from ./team/debouncedSearch.
import { createDebouncedSearch } from "./team/debouncedSearch";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  assignedEmployeeIdPayload,
  // Support the surrounding logic for this step.
  bannerAfterLoad,
  // Support the surrounding logic for this step.
  controlLoadPlan,
  // Support the surrounding logic for this step.
  defaultTaskAssigneeIfNeeded,
  // Support the surrounding logic for this step.
  formatRoleConflicts,
  // Support the surrounding logic for this step.
  mergeMutationAndRefresh,
  // Support the surrounding logic for this step.
  mergeRecentTickets,
  // Support the surrounding logic for this step.
  mergeRoleDraftsOnRefresh,
  // Support the surrounding logic for this step.
  replaceSectionErrors,
  // Support the surrounding logic for this step.
  sectionErrorViews,
  // Support the surrounding logic for this step.
  sectionFromSettled,
  // Support the surrounding logic for this step.
  settleOptional,
  // Support the surrounding logic for this step.
  shouldApplyControlRefresh,
  // Support the surrounding logic for this step.
  taskAssigneeSelectValue,
  // Support the surrounding logic for this step.
  techniciansFromPeople,
  // Declare type alias TaskAssigneeState.
  type TaskAssigneeState,
// Support the surrounding logic for this step.
} from "./controlPageState";

// Declare type alias FakeTimer.
type FakeTimer = {
  // Provide id field used by this structure.
  id: number;
  // Provide fn field used by this structure.
  fn: () => void;
  // Provide due field used by this structure.
  due: number;
};

// Define function createFakeTimers and its behavior.
function createFakeTimers() {
  // Bind now for use in the following logic.
  let now = 0;
  // Bind nextId for use in the following logic.
  let nextId = 1;
  // Initialize an array used by subsequent logic.
  const timers: FakeTimer[] = [];
  // Return early result or rendered output from this path.
  return {
    // Invoke advance to perform this step.
    advance(ms: number) {
      // Support the surrounding logic for this step.
      now += ms;
      // Bind due for use in the following logic.
      const due = timers
        // Continue a chained call building on the previous expression.
        .filter((t) => t.due <= now)
        // Continue a chained call building on the previous expression.
        .sort((a, b) => a.due - b.due || a.id - b.id);
      // Iterate a collection or counted range.
      for (const t of due) {
        // Bind idx for use in the following logic.
        const idx = timers.indexOf(t);
        // Conditional branch for the case described by this guard.
        if (idx >= 0) timers.splice(idx, 1);
        // Invoke t.fn to perform this step.
        t.fn();
      }
    },
    // Provide api field used by this structure.
    api: {
      // Provide setTimeout field used by this structure.
      setTimeout: (fn: () => void, ms: number) => {
        // Bind id for use in the following logic.
        const id = nextId++;
        // Invoke timers.push to perform this step.
        timers.push({ id, fn, due: now + ms });
        // Return early result or rendered output from this path.
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      // Provide clearTimeout field used by this structure.
      clearTimeout: (id: ReturnType<typeof setTimeout>) => {
        // Bind n for use in the following logic.
        const n = id as unknown as number;
        // Bind idx for use in the following logic.
        const idx = timers.findIndex((t) => t.id === n);
        // Conditional branch for the case described by this guard.
        if (idx >= 0) timers.splice(idx, 1);
      },
    },
  };
}

// Group related tests under a shared suite name.
describe("Unassigned assignee selection", () => {
  // Define a single test case and its expectation.
  it("defaults only while uninitialized; keeps explicit Unassigned across refresh", () => {
    // Initialize an object holding related fields.
    let state: TaskAssigneeState = { status: "uninitialized" };
    // Support the surrounding logic for this step.
    state = defaultTaskAssigneeIfNeeded(state, "hk-1");
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(state, { status: "chosen", employeeId: "hk-1" });

    // Pass state prop/value into the element or config.
    state = { status: "chosen", employeeId: "" };
    // Support the surrounding logic for this step.
    state = defaultTaskAssigneeIfNeeded(state, "hk-1");
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(state, { status: "chosen", employeeId: "" });
    // Invoke assert.equal to perform this step.
    assert.equal(taskAssigneeSelectValue(state), "");
    // Invoke assert.equal to perform this step.
    assert.equal(assignedEmployeeIdPayload(state), undefined);
  });

  // Define a single test case and its expectation.
  it("does not coerce empty string as uninitialized (legacy bug reproduction)", () => {
    // Old code: if (!taskAssigneeId && hk) setTaskAssigneeId(hk)
    const taskAssigneeId = "";
    // Initialize an array used by subsequent logic.
    const hkData = [{ id: "hk-1" }];
    // Bind next for use in the following logic.
    let next = taskAssigneeId;
    // Conditional branch for the case described by this guard.
    if (!taskAssigneeId && hkData[0]) next = hkData[0].id;
    // Invoke assert.equal to perform this step.
    assert.equal(next, "hk-1", "legacy path wrongly replaces Unassigned");

    // Bind fixed for use in the following logic.
    const fixed = defaultTaskAssigneeIfNeeded(
      // Support the surrounding logic for this step.
      { status: "chosen", employeeId: "" },
      // Support the surrounding logic for this step.
      "hk-1",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(fixed.status, "chosen");
    // Conditional branch for the case described by this guard.
    if (fixed.status === "chosen") assert.equal(fixed.employeeId, "");
  });
});

// Group related tests under a shared suite name.
describe("role draft merge on refresh", () => {
  // Define a single test case and its expectation.
  it("preserves unsaved dirty drafts while updating clean rows", () => {
    // Bind merged for use in the following logic.
    const merged = mergeRoleDraftsOnRefresh({
      // Provide prevDrafts field used by this structure.
      prevDrafts: { u1: "technician", u2: "housekeeper" },
      // Provide prevServerRoles field used by this structure.
      prevServerRoles: { u1: "housekeeper", u2: "housekeeper" },
      // Provide nextPeople field used by this structure.
      nextPeople: [
        // Support the surrounding logic for this step.
        { userId: "u1", role: "housekeeper" },
        // Support the surrounding logic for this step.
        { userId: "u2", role: "supervisor" },
      ],
    });
    // Invoke assert.equal to perform this step.
    assert.equal(merged.drafts.u1, "technician");
    // Invoke assert.equal to perform this step.
    assert.equal(merged.drafts.u2, "supervisor");
    // Invoke assert.equal to perform this step.
    assert.equal(merged.conflicts.length, 0);
  });

  // Define a single test case and its expectation.
  it("surfaces server conflicts without silently overwriting the draft", () => {
    // Bind merged for use in the following logic.
    const merged = mergeRoleDraftsOnRefresh({
      // Provide prevDrafts field used by this structure.
      prevDrafts: { u1: "technician" },
      // Provide prevServerRoles field used by this structure.
      prevServerRoles: { u1: "housekeeper" },
      // Provide nextPeople field used by this structure.
      nextPeople: [{ userId: "u1", role: "supervisor" }],
    });
    // Invoke assert.equal to perform this step.
    assert.equal(merged.drafts.u1, "technician");
    // Invoke assert.equal to perform this step.
    assert.equal(merged.conflicts.length, 1);
    // Invoke assert.equal to perform this step.
    assert.equal(merged.conflicts[0]?.server, "supervisor");
    // Invoke assert.match to perform this step.
    assert.match(
      // Invoke formatRoleConflicts to perform this step.
      formatRoleConflicts(merged.conflicts, { u1: "Ada" }) ?? "",
      // Support the surrounding logic for this step.
      /Ada/,
    );
  });

  // Define a single test case and its expectation.
  it("force-replaces a just-saved user while keeping a sibling dirty draft", () => {
    // Bind merged for use in the following logic.
    const merged = mergeRoleDraftsOnRefresh({
      // Provide prevDrafts field used by this structure.
      prevDrafts: { u1: "technician", u2: "manager" },
      // Provide prevServerRoles field used by this structure.
      prevServerRoles: { u1: "housekeeper", u2: "supervisor" },
      // Provide nextPeople field used by this structure.
      nextPeople: [
        // Support the surrounding logic for this step.
        { userId: "u1", role: "technician" },
        // Support the surrounding logic for this step.
        { userId: "u2", role: "supervisor" },
      ],
      // Provide replaceUserIds field used by this structure.
      replaceUserIds: new Set(["u1"]),
    });
    // Invoke assert.equal to perform this step.
    assert.equal(merged.drafts.u1, "technician");
    // Invoke assert.equal to perform this step.
    assert.equal(merged.drafts.u2, "manager");
  });
});

// Group related tests under a shared suite name.
describe("assign technicians independent of role search", () => {
  // Define a single test case and its expectation.
  it("filters technicians from the assignee feed, not the searched people list", () => {
    // Initialize an array used by subsequent logic.
    const searchedPeople = [
      // Support the surrounding logic for this step.
      { id: "e1", role: "technician" as const, fullName: "Only Match" },
    ];
    // Initialize an array used by subsequent logic.
    const assigneeFeed = [
      // Support the surrounding logic for this step.
      { id: "e1", role: "technician" as const, fullName: "Only Match" },
      // Support the surrounding logic for this step.
      { id: "e2", role: "supervisor" as const, fullName: "Hidden By Search" },
      // Support the surrounding logic for this step.
      { id: "e3", role: "housekeeper" as const, fullName: "HK" },
    ];
    // Invoke assert.equal to perform this step.
    assert.equal(techniciansFromPeople(searchedPeople).length, 1);
    // Invoke assert.equal to perform this step.
    assert.equal(techniciansFromPeople(assigneeFeed).length, 2);
  });
});

// Group related tests under a shared suite name.
describe("independent section settlement + permission plan", () => {
  // Define a single test case and its expectation.
  it("skips unauthorized fetches and isolates section failures", async () => {
    // Bind plan for use in the following logic.
    const plan = controlLoadPlan({
      // Provide canChangeRole field used by this structure.
      canChangeRole: true,
      // Provide canCreateCleaning field used by this structure.
      canCreateCleaning: false,
      // Provide canWorkTickets field used by this structure.
      canWorkTickets: true,
    });
    // Invoke assert.equal to perform this step.
    assert.equal(plan.people, true);
    // Invoke assert.equal to perform this step.
    assert.equal(plan.rooms, false);
    // Invoke assert.equal to perform this step.
    assert.equal(plan.housekeepers, false);
    // Invoke assert.equal to perform this step.
    assert.equal(plan.openTickets, true);

    // Bind people for use in the following logic.
    const people = sectionFromSettled(
      // Support the surrounding logic for this step.
      { status: "fulfilled", value: [{ id: "1" }] },
      // Support the surrounding logic for this step.
      plan.people,
    );
    // Bind rooms for use in the following logic.
    const rooms = sectionFromSettled(undefined, plan.rooms);
    // Bind tickets for use in the following logic.
    const tickets = sectionFromSettled(
      // Support the surrounding logic for this step.
      { status: "rejected", reason: new Error("tickets down") },
      // Support the surrounding logic for this step.
      plan.openTickets,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(people.status, "ok");
    // Invoke assert.equal to perform this step.
    assert.equal(rooms.status, "skipped");
    // Invoke assert.equal to perform this step.
    assert.equal(tickets.status, "error");
    // Conditional branch for the case described by this guard.
    if (tickets.status === "error") {
      // Invoke assert.match to perform this step.
      assert.match(tickets.message, /tickets down/);
    }

    // Bind skipped for use in the following logic.
    const skipped = await settleOptional(null);
    // Invoke assert.equal to perform this step.
    assert.equal(skipped, undefined);
    // Bind failed for use in the following logic.
    const failed = await settleOptional(
      // Invoke Promise.reject to perform this step.
      Promise.reject(new Error("boom")),
    );
    // Invoke assert.equal to perform this step.
    assert.equal(failed?.status, "rejected");
    // Bind ok for use in the following logic.
    const ok = await settleOptional(Promise.resolve(42));
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(ok, { status: "fulfilled", value: 42 });
  });
});

// Group related tests under a shared suite name.
describe("stale refresh generation", () => {
  // Define a single test case and its expectation.
  it("late response A must not overwrite newer B", async () => {
    // Bind gen for use in the following logic.
    let gen = 0;
    // Initialize an array used by subsequent logic.
    let people = ["initial"];

    // Define function refresh and its behavior.
    async function refresh(label: string, delayMs: number) {
      // Bind mine for use in the following logic.
      const mine = ++gen;
      // Wait for an async operation before continuing.
      await new Promise((r) => setTimeout(r, delayMs));
      // Conditional branch for the case described by this guard.
      if (!shouldApplyControlRefresh(mine, gen)) return;
      // Pass people prop/value into the element or config.
      people = [label];
    }

    // Wait for an async operation before continuing.
    await Promise.all([refresh("stale-A", 40), refresh("fresh-B", 10)]);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(people, ["fresh-B"]);
  });
});

// Group related tests under a shared suite name.
describe("debounced search keeps input independent of fetch", () => {
  // Define a single test case and its expectation.
  it("commits after debounce with final value; pending does not require remount", () => {
    // Bind clocks for use in the following logic.
    const clocks = createFakeTimers();
    // Initialize an array used by subsequent logic.
    const commits: string[] = [];
    // Bind pendingUi for use in the following logic.
    let pendingUi = false;
    // Bind bridge for use in the following logic.
    const bridge = createDebouncedSearch({
      // Provide debounceMs field used by this structure.
      debounceMs: 200,
      // Provide timers field used by this structure.
      timers: clocks.api,
      // Provide onInvalidate field used by this structure.
      onInvalidate: () => {
        // Support the surrounding logic for this step.
        pendingUi = true;
      },
      // Provide onCommit field used by this structure.
      onCommit: (q) => {
        // Support the surrounding logic for this step.
        pendingUi = false;
        // Invoke commits.push to perform this step.
        commits.push(q);
      },
    });

    // Invoke bridge.onInput to perform this step.
    bridge.onInput("a");
    // Invoke bridge.onInput to perform this step.
    bridge.onInput("ab");
    // Invoke bridge.onInput to perform this step.
    bridge.onInput("abc");
    // Invoke assert.equal to perform this step.
    assert.equal(bridge.getInput(), "abc");
    // Invoke assert.equal to perform this step.
    assert.equal(pendingUi, true);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(commits, []);
    // Invoke clocks.advance to perform this step.
    clocks.advance(200);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(commits, ["abc"]);
    // Invoke assert.equal to perform this step.
    assert.equal(pendingUi, false);
  });
});

// Group related tests under a shared suite name.
describe("parallel busy tracking", () => {
  // Define a single test case and its expectation.
  it("finishing A does not unlock B; double-begin on same id is rejected", () => {
    // Create a Set/Map for efficient membership or keyed lookup.
    let busy = new Set<string>();
    // Bind begin for use in the following logic.
    const begin = (id: string) => {
      // Conditional branch for the case described by this guard.
      if (isBusy(busy, id)) return false;
      // Support the surrounding logic for this step.
      busy = addBusyId(busy, id);
      // Return early result or rendered output from this path.
      return true;
    };
    // Bind end for use in the following logic.
    const end = (id: string) => {
      // Support the surrounding logic for this step.
      busy = removeBusyId(busy, id);
    };

    // Invoke assert.equal to perform this step.
    assert.equal(begin("t1"), true);
    // Invoke assert.equal to perform this step.
    assert.equal(begin("t2"), true);
    // Invoke assert.equal to perform this step.
    assert.equal(begin("t1"), false);
    // Invoke end to perform this step.
    end("t1");
    // Invoke assert.equal to perform this step.
    assert.equal(isBusy(busy, "t1"), false);
    // Invoke assert.equal to perform this step.
    assert.equal(isBusy(busy, "t2"), true);
  });
});

// Group related tests under a shared suite name.
describe("mutation success vs refresh failure", () => {
  // Define a single test case and its expectation.
  it("keeps success message when follow-up refresh fails", () => {
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke mergeMutationAndRefresh to perform this step.
      mergeMutationAndRefresh({
        // Provide successMessage field used by this structure.
        successMessage: "Updated role for Ada",
        // Provide refreshError field used by this structure.
        refreshError: "Failed to reload",
      }),
      {
        // Provide message field used by this structure.
        message: "Updated role for Ada",
        // Provide refreshWarning field used by this structure.
        refreshWarning: "Failed to reload",
      },
    );
  });
});

// Group related tests under a shared suite name.
describe("per-section error slots", () => {
  // Define a single test case and its expectation.
  it("a load replaces only the slots it covers", () => {
    // Initialize an object holding related fields.
    const prev = { people: "people down", rooms: "rooms down" };
    // Bind next for use in the following logic.
    const next = replaceSectionErrors(prev, ["people"], {});
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(next, { rooms: "rooms down" });
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(prev, { people: "people down", rooms: "rooms down" });

    // Bind failed for use in the following logic.
    const failed = replaceSectionErrors(
      // Support the surrounding logic for this step.
      { rooms: "rooms down" },
      // Support the surrounding logic for this step.
      ["openTickets", "resolvedTickets", "closedTickets"],
      // Support the surrounding logic for this step.
      { closedTickets: "closed down" },
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(failed, {
      // Provide rooms field used by this structure.
      rooms: "rooms down",
      // Provide closedTickets field used by this structure.
      closedTickets: "closed down",
    });
  });

  // Define a single test case and its expectation.
  it("maps slots to the section that owns them", () => {
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke sectionErrorViews to perform this step.
      sectionErrorViews({
        // Provide people field used by this structure.
        people: "p",
        // Provide assignees field used by this structure.
        assignees: "a",
        // Provide resolvedTickets field used by this structure.
        resolvedTickets: "r",
        // Provide closedTickets field used by this structure.
        closedTickets: "c",
        // Provide housekeepers field used by this structure.
        housekeepers: "h",
      }),
      {
        // Provide peopleError field used by this structure.
        peopleError: "p",
        // Provide ticketsError field used by this structure.
        ticketsError: "a",
        // Provide recentError field used by this structure.
        recentError: "r",
        // Provide cleaningError field used by this structure.
        cleaningError: "h",
      },
    );
    // Invoke assert.equal to perform this step.
    assert.equal(sectionErrorViews({ rooms: "r" }).peopleError, undefined);
    // Invoke assert.equal to perform this step.
    assert.equal(sectionErrorViews({ people: "p" }).ticketsError, undefined);
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke sectionErrorViews to perform this step.
      sectionErrorViews({ openTickets: "o", assignees: "a" }).ticketsError,
      // Support the surrounding logic for this step.
      "o",
    );
  });

  // Define a single test case and its expectation.
  it("page banner: first error only during initial load, cleared when all sections recover", () => {
    // Fixed slot order decides which error leads, not report order.
    assert.deepEqual(
      // Invoke bannerAfterLoad to perform this step.
      bannerAfterLoad({ rooms: "rooms", people: "people" }, true),
      // Support the surrounding logic for this step.
      { action: "set", message: "people" },
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(bannerAfterLoad({ rooms: "rooms" }, false), {
      // Provide action field used by this structure.
      action: "keep",
    });
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(bannerAfterLoad({}, false), { action: "clear" });
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(bannerAfterLoad({}, true), { action: "clear" });
  });

  // Define a single test case and its expectation.
  it("another section's error keeps the banner while one section recovers", () => {
    // Bind afterTicketsOk for use in the following logic.
    const afterTicketsOk = replaceSectionErrors(
      // Support the surrounding logic for this step.
      { people: "people down" },
      // Support the surrounding logic for this step.
      ["openTickets", "resolvedTickets", "closedTickets"],
      // Support the surrounding logic for this step.
      {},
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(bannerAfterLoad(afterTicketsOk, false), {
      // Provide action field used by this structure.
      action: "keep",
    });
  });
});

// Group related tests under a shared suite name.
describe("recent tickets merge", () => {
  // Define a single test case and its expectation.
  it("dedupes resolved and closed by id, closed winning", () => {
    // Bind merged for use in the following logic.
    const merged = mergeRecentTickets(
      [
        // Support the surrounding logic for this step.
        { id: "1", status: "resolved" },
        // Support the surrounding logic for this step.
        { id: "2", status: "resolved" },
      ],
      [
        // Support the surrounding logic for this step.
        { id: "2", status: "closed" },
        // Support the surrounding logic for this step.
        { id: "3", status: "closed" },
      ],
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(merged, [
      // Support the surrounding logic for this step.
      { id: "1", status: "resolved" },
      // Support the surrounding logic for this step.
      { id: "2", status: "closed" },
      // Support the surrounding logic for this step.
      { id: "3", status: "closed" },
    // Support the surrounding logic for this step.
    ]);
  });

  // Define a single test case and its expectation.
  it("uses whichever feed loaded; null keeps the previous list", () => {
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(mergeRecentTickets([{ id: "1" }], undefined), [
      // Support the surrounding logic for this step.
      { id: "1" },
    // Support the surrounding logic for this step.
    ]);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(mergeRecentTickets(undefined, [{ id: "9" }]), [
      // Support the surrounding logic for this step.
      { id: "9" },
    // Support the surrounding logic for this step.
    ]);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(mergeRecentTickets([], []), []);
    // Invoke assert.equal to perform this step.
    assert.equal(mergeRecentTickets(undefined, undefined), null);
  });
});