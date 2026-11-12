/**
 * Regression coverage for Control page P2 defects –10.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addBusyId, isBusy, removeBusyId } from "./locations/busyIds";
import { createDebouncedSearch } from "./team/debouncedSearch";
import {
  assignedEmployeeIdPayload,
  bannerAfterLoad,
  controlLoadPlan,
  defaultTaskAssigneeIfNeeded,
  formatRoleConflicts,
  mergeMutationAndRefresh,
  mergeRecentTickets,
  mergeRoleDraftsOnRefresh,
  replaceSectionErrors,
  sectionErrorViews,
  sectionFromSettled,
  settleOptional,
  shouldApplyControlRefresh,
  taskAssigneeSelectValue,
  techniciansFromPeople,
  type TaskAssigneeState,
} from "./controlPageState";

type FakeTimer = {
  id: number;
  fn: () => void;
  due: number;
};

// Define function createFakeTimers and its behavior.
function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers: FakeTimer[] = [];
  return {
    advance(ms: number) {
      now += ms;
      const due = timers
        .filter((t) => t.due <= now)
        .sort((a, b) => a.due - b.due || a.id - b.id);
      for (const t of due) {
        const idx = timers.indexOf(t);
        if (idx >= 0) timers.splice(idx, 1);
        t.fn();
      }
    },
    api: {
      setTimeout: (fn: () => void, ms: number) => {
        const id = nextId++;
        timers.push({ id, fn, due: now + ms });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (id: ReturnType<typeof setTimeout>) => {
        const n = id as unknown as number;
        const idx = timers.findIndex((t) => t.id === n);
        if (idx >= 0) timers.splice(idx, 1);
      },
    },
  };
}

describe("Unassigned assignee selection", () => {
  it("defaults only while uninitialized; keeps explicit Unassigned across refresh", () => {
    let state: TaskAssigneeState = { status: "uninitialized" };
    state = defaultTaskAssigneeIfNeeded(state, "hk-1");
    assert.deepEqual(state, { status: "chosen", employeeId: "hk-1" });

    state = { status: "chosen", employeeId: "" };
    state = defaultTaskAssigneeIfNeeded(state, "hk-1");
    assert.deepEqual(state, { status: "chosen", employeeId: "" });
    assert.equal(taskAssigneeSelectValue(state), "");
    assert.equal(assignedEmployeeIdPayload(state), undefined);
  });

  it("does not coerce empty string as uninitialized (legacy bug reproduction)", () => {
    // Old code: if (!taskAssigneeId && hk) setTaskAssigneeId(hk)
    const taskAssigneeId = "";
    const hkData = [{ id: "hk-1" }];
    let next = taskAssigneeId;
    if (!taskAssigneeId && hkData[0]) next = hkData[0].id;
    assert.equal(next, "hk-1", "legacy path wrongly replaces Unassigned");

    const fixed = defaultTaskAssigneeIfNeeded(
      { status: "chosen", employeeId: "" },
      "hk-1",
    );
    assert.equal(fixed.status, "chosen");
    if (fixed.status === "chosen") assert.equal(fixed.employeeId, "");
  });
});

describe("role draft merge on refresh", () => {
  it("preserves unsaved dirty drafts while updating clean rows", () => {
    const merged = mergeRoleDraftsOnRefresh({
      prevDrafts: { u1: "technician", u2: "housekeeper" },
      prevServerRoles: { u1: "housekeeper", u2: "housekeeper" },
      nextPeople: [
        { userId: "u1", role: "housekeeper" },
        { userId: "u2", role: "supervisor" },
      ],
    });
    assert.equal(merged.drafts.u1, "technician");
    assert.equal(merged.drafts.u2, "supervisor");
    assert.equal(merged.conflicts.length, 0);
  });

  it("surfaces server conflicts without silently overwriting the draft", () => {
    const merged = mergeRoleDraftsOnRefresh({
      prevDrafts: { u1: "technician" },
      prevServerRoles: { u1: "housekeeper" },
      nextPeople: [{ userId: "u1", role: "supervisor" }],
    });
    assert.equal(merged.drafts.u1, "technician");
    assert.equal(merged.conflicts.length, 1);
    assert.equal(merged.conflicts[0]?.server, "supervisor");
    assert.match(
      formatRoleConflicts(merged.conflicts, { u1: "Ada" }) ?? "",
      /Ada/,
    );
  });

  it("force-replaces a just-saved user while keeping a sibling dirty draft", () => {
    const merged = mergeRoleDraftsOnRefresh({
      prevDrafts: { u1: "technician", u2: "manager" },
      prevServerRoles: { u1: "housekeeper", u2: "supervisor" },
      nextPeople: [
        { userId: "u1", role: "technician" },
        { userId: "u2", role: "supervisor" },
      ],
      replaceUserIds: new Set(["u1"]),
    });
    assert.equal(merged.drafts.u1, "technician");
    assert.equal(merged.drafts.u2, "manager");
  });
});

describe("assign technicians independent of role search", () => {
  it("filters technicians from the assignee feed, not the searched people list", () => {
    const searchedPeople = [
      { id: "e1", role: "technician" as const, fullName: "Only Match" },
    ];
    const assigneeFeed = [
      { id: "e1", role: "technician" as const, fullName: "Only Match" },
      { id: "e2", role: "supervisor" as const, fullName: "Hidden By Search" },
      { id: "e3", role: "housekeeper" as const, fullName: "HK" },
    ];
    assert.equal(techniciansFromPeople(searchedPeople).length, 1);
    assert.equal(techniciansFromPeople(assigneeFeed).length, 2);
  });
});

describe("independent section settlement + permission plan", () => {
  it("skips unauthorized fetches and isolates section failures", async () => {
    const plan = controlLoadPlan({
      canChangeRole: true,
      canCreateCleaning: false,
      canWorkTickets: true,
    });
    assert.equal(plan.people, true);
    assert.equal(plan.rooms, false);
    assert.equal(plan.housekeepers, false);
    assert.equal(plan.openTickets, true);

    const people = sectionFromSettled(
      { status: "fulfilled", value: [{ id: "1" }] },
      plan.people,
    );
    const rooms = sectionFromSettled(undefined, plan.rooms);
    const tickets = sectionFromSettled(
      { status: "rejected", reason: new Error("tickets down") },
      plan.openTickets,
    );
    assert.equal(people.status, "ok");
    assert.equal(rooms.status, "skipped");
    assert.equal(tickets.status, "error");
    if (tickets.status === "error") {
      assert.match(tickets.message, /tickets down/);
    }

    const skipped = await settleOptional(null);
    assert.equal(skipped, undefined);
    const failed = await settleOptional(
      Promise.reject(new Error("boom")),
    );
    assert.equal(failed?.status, "rejected");
    const ok = await settleOptional(Promise.resolve(42));
    assert.deepEqual(ok, { status: "fulfilled", value: 42 });
  });
});

describe("stale refresh generation", () => {
  it("late response A must not overwrite newer B", async () => {
    let gen = 0;
    let people = ["initial"];

    // Define function refresh and its behavior.
    async function refresh(label: string, delayMs: number) {
      const mine = ++gen;
      await new Promise((r) => setTimeout(r, delayMs));
      if (!shouldApplyControlRefresh(mine, gen)) return;
      people = [label];
    }

    await Promise.all([refresh("stale-A", 40), refresh("fresh-B", 10)]);
    assert.deepEqual(people, ["fresh-B"]);
  });
});

describe("debounced search keeps input independent of fetch", () => {
  it("commits after debounce with final value; pending does not require remount", () => {
    const clocks = createFakeTimers();
    const commits: string[] = [];
    let pendingUi = false;
    const bridge = createDebouncedSearch({
      debounceMs: 200,
      timers: clocks.api,
      onInvalidate: () => {
        pendingUi = true;
      },
      onCommit: (q) => {
        pendingUi = false;
        commits.push(q);
      },
    });

    bridge.onInput("a");
    bridge.onInput("ab");
    bridge.onInput("abc");
    assert.equal(bridge.getInput(), "abc");
    assert.equal(pendingUi, true);
    assert.deepEqual(commits, []);
    clocks.advance(200);
    assert.deepEqual(commits, ["abc"]);
    assert.equal(pendingUi, false);
  });
});

describe("parallel busy tracking", () => {
  it("finishing A does not unlock B; double-begin on same id is rejected", () => {
    let busy = new Set<string>();
    const begin = (id: string) => {
      if (isBusy(busy, id)) return false;
      busy = addBusyId(busy, id);
      return true;
    };
    const end = (id: string) => {
      busy = removeBusyId(busy, id);
    };

    assert.equal(begin("t1"), true);
    assert.equal(begin("t2"), true);
    assert.equal(begin("t1"), false);
    end("t1");
    assert.equal(isBusy(busy, "t1"), false);
    assert.equal(isBusy(busy, "t2"), true);
  });
});

describe("mutation success vs refresh failure", () => {
  it("keeps success message when follow-up refresh fails", () => {
    assert.deepEqual(
      mergeMutationAndRefresh({
        successMessage: "Updated role for Ada",
        refreshError: "Failed to reload",
      }),
      {
        message: "Updated role for Ada",
        refreshWarning: "Failed to reload",
      },
    );
  });
});

describe("per-section error slots", () => {
  it("a load replaces only the slots it covers", () => {
    const prev = { people: "people down", rooms: "rooms down" };
    const next = replaceSectionErrors(prev, ["people"], {});
    assert.deepEqual(next, { rooms: "rooms down" });
    assert.deepEqual(prev, { people: "people down", rooms: "rooms down" });

    const failed = replaceSectionErrors(
      { rooms: "rooms down" },
      ["openTickets", "resolvedTickets", "closedTickets"],
      { closedTickets: "closed down" },
    );
    assert.deepEqual(failed, {
      rooms: "rooms down",
      closedTickets: "closed down",
    });
  });

  it("maps slots to the section that owns them", () => {
    assert.deepEqual(
      sectionErrorViews({
        people: "p",
        assignees: "a",
        resolvedTickets: "r",
        closedTickets: "c",
        housekeepers: "h",
      }),
      {
        peopleError: "p",
        ticketsError: "a",
        recentError: "r",
        cleaningError: "h",
      },
    );
    assert.equal(sectionErrorViews({ rooms: "r" }).peopleError, undefined);
    assert.equal(sectionErrorViews({ people: "p" }).ticketsError, undefined);
    assert.equal(
      sectionErrorViews({ openTickets: "o", assignees: "a" }).ticketsError,
      "o",
    );
  });

  it("page banner: first error only during initial load, cleared when all sections recover", () => {
    // Fixed slot order decides which error leads, not report order.
    assert.deepEqual(
      bannerAfterLoad({ rooms: "rooms", people: "people" }, true),
      { action: "set", message: "people" },
    );
    assert.deepEqual(bannerAfterLoad({ rooms: "rooms" }, false), {
      action: "keep",
    });
    assert.deepEqual(bannerAfterLoad({}, false), { action: "clear" });
    assert.deepEqual(bannerAfterLoad({}, true), { action: "clear" });
  });

  it("another section's error keeps the banner while one section recovers", () => {
    const afterTicketsOk = replaceSectionErrors(
      { people: "people down" },
      ["openTickets", "resolvedTickets", "closedTickets"],
      {},
    );
    assert.deepEqual(bannerAfterLoad(afterTicketsOk, false), {
      action: "keep",
    });
  });
});

describe("recent tickets merge", () => {
  it("dedupes resolved and closed by id, closed winning", () => {
    const merged = mergeRecentTickets(
      [
        { id: "1", status: "resolved" },
        { id: "2", status: "resolved" },
      ],
      [
        { id: "2", status: "closed" },
        { id: "3", status: "closed" },
      ],
    );
    assert.deepEqual(merged, [
      { id: "1", status: "resolved" },
      { id: "2", status: "closed" },
      { id: "3", status: "closed" },
    ]);
  });

  it("uses whichever feed loaded; null keeps the previous list", () => {
    assert.deepEqual(mergeRecentTickets([{ id: "1" }], undefined), [
      { id: "1" },
    ]);
    assert.deepEqual(mergeRecentTickets(undefined, [{ id: "9" }]), [
      { id: "9" },
    ]);
    assert.deepEqual(mergeRecentTickets([], []), []);
    assert.equal(mergeRecentTickets(undefined, undefined), null);
  });
});