// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency from ./busyIds.
import { addBusyId, isBusy, removeBusyId } from "./busyIds";

// Group related tests under a shared suite name.
describe("busyIds concurrent tracking", () => {
  // Define a single test case and its expectation.
  it("tracks multiple rows independently", () => {
    // Create a Set/Map for efficient membership or keyed lookup.
    let busy = new Set<string>();
    // Support the surrounding logic for this step.
    busy = addBusyId(busy, "A");
    // Support the surrounding logic for this step.
    busy = addBusyId(busy, "B");
    // Invoke assert.equal to perform this step.
    assert.equal(isBusy(busy, "A"), true);
    // Invoke assert.equal to perform this step.
    assert.equal(isBusy(busy, "B"), true);

    // Support the surrounding logic for this step.
    busy = removeBusyId(busy, "A");
    // Invoke assert.equal to perform this step.
    assert.equal(isBusy(busy, "A"), false);
    // Invoke assert.equal to perform this step.
    assert.equal(isBusy(busy, "B"), true);
  });

  // Define a single test case and its expectation.
  it("does not clear sibling busy when one finishes first", async () => {
    // Create a Set/Map for efficient membership or keyed lookup.
    let busy = new Set<string>();
    // Initialize an array used by subsequent logic.
    const order: string[] = [];

    // Define function run and its behavior.
    async function run(id: string, delayMs: number) {
      // Conditional branch for the case described by this guard.
      if (isBusy(busy, id)) return;
      // Support the surrounding logic for this step.
      busy = addBusyId(busy, id);
      // Wait for an async operation before continuing.
      await new Promise((r) => setTimeout(r, delayMs));
      // Invoke order.push to perform this step.
      order.push(id);
      // Support the surrounding logic for this step.
      busy = removeBusyId(busy, id);
    }

    // Wait for an async operation before continuing.
    await Promise.all([run("A", 40), run("B", 10)]);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(order, ["B", "A"]);
    // Invoke assert.equal to perform this step.
    assert.equal(busy.size, 0);
  });

  // Define a single test case and its expectation.
  it("rejects a second begin for the same id while busy", () => {
    // Create a Set/Map for efficient membership or keyed lookup.
    let busy = new Set<string>();
    // Support the surrounding logic for this step.
    busy = addBusyId(busy, "A");
    // Bind before for use in the following logic.
    const before = busy.size;
    // Mimic beginBusy: skip add when already present.
    if (!isBusy(busy, "A")) {
      // Support the surrounding logic for this step.
      busy = addBusyId(busy, "A");
    }
    // Invoke assert.equal to perform this step.
    assert.equal(busy.size, before);
  });
});
