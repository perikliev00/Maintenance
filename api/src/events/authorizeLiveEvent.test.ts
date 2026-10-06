import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Role } from "@prisma/client";
import { AppError } from "../errors";
import type { DataScope } from "../services/dataScope";
import {
  canDeliverLiveEvent,
  type LiveAccessChecks,
} from "./authorizeLiveEvent";
import type { LiveEvent } from "./bus";

const allScope: DataScope = {
  kind: "all",
  employeeId: "emp-mgr",
  role: Role.manager,
  sectorIds: [],
};

const hkScope: DataScope = {
  kind: "assigned_tasks",
  employeeId: "emp-hk",
  role: Role.housekeeper,
  sectorIds: [],
};

function at(partial: Partial<LiveEvent> & Pick<LiveEvent, "type">): LiveEvent {
  return { at: "2026-01-01T00:00:00.000Z", ...partial };
}

function checks(overrides: Partial<LiveAccessChecks> = {}): LiveAccessChecks {
  const deny = async () => {
    throw new AppError(403, "forbidden", "Outside your permitted data scope");
  };
  return {
    assertCanAccessLocation: deny,
    assertCanAccessTask: deny,
    assertCanAccessTicket: deny,
    ...overrides,
  };
}

describe("canDeliverLiveEvent", () => {
  it("always delivers settings.changed and people.changed", async () => {
    assert.equal(
      await canDeliverLiveEvent(hkScope, at({ type: "settings.changed" })),
      true,
    );
    assert.equal(
      await canDeliverLiveEvent(hkScope, at({ type: "people.changed" })),
      true,
    );
  });

  it("delivers ops events to all-scope when ids are present", async () => {
    assert.equal(
      await canDeliverLiveEvent(
        allScope,
        at({ type: "location.changed", locationId: "loc-1" }),
      ),
      true,
    );
    assert.equal(
      await canDeliverLiveEvent(
        allScope,
        at({ type: "cleaning.changed", taskId: "task-1" }),
      ),
      true,
    );
    assert.equal(
      await canDeliverLiveEvent(
        allScope,
        at({ type: "ticket.changed", ticketId: "tkt-1" }),
      ),
      true,
    );
  });

  it("drops ops events that lack identifying ids", async () => {
    assert.equal(
      await canDeliverLiveEvent(allScope, at({ type: "location.changed" })),
      false,
    );
    assert.equal(
      await canDeliverLiveEvent(allScope, at({ type: "cleaning.changed" })),
      false,
    );
    assert.equal(
      await canDeliverLiveEvent(allScope, at({ type: "ticket.changed" })),
      false,
    );
    assert.equal(
      await canDeliverLiveEvent(hkScope, at({ type: "cleaning.changed" })),
      false,
    );
  });

  it("does not deliver out-of-scope cleaning.changed to housekeeper", async () => {
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({ type: "cleaning.changed", taskId: "other-task" }),
        checks(),
      ),
      false,
    );
  });

  it("delivers in-scope cleaning.changed to housekeeper", async () => {
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({ type: "cleaning.changed", taskId: "own-task" }),
        checks({
          assertCanAccessTask: async () => undefined,
        }),
      ),
      true,
    );
  });

  it("does not deliver out-of-scope ticket/location to housekeeper", async () => {
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({ type: "ticket.changed", ticketId: "other-tkt" }),
        checks(),
      ),
      false,
    );
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({ type: "location.changed", locationId: "other-loc" }),
        checks(),
      ),
      false,
    );
  });

  it("treats missing entity as not deliverable (404)", async () => {
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({ type: "cleaning.changed", taskId: "gone" }),
        checks({
          assertCanAccessTask: async () => {
            throw new AppError(404, "not_found", "Task not found");
          },
        }),
      ),
      false,
    );
  });

  it("delivers notification.changed only to matching recipient", async () => {
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({
          type: "notification.changed",
          recipientEmployeeId: "emp-hk",
        }),
      ),
      true,
    );
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({
          type: "notification.changed",
          recipientEmployeeId: "someone-else",
        }),
      ),
      false,
    );
    assert.equal(
      await canDeliverLiveEvent(
        hkScope,
        at({ type: "notification.changed" }),
      ),
      false,
    );
  });
});
