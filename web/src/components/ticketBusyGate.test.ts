// Import dependency used by this module.
import assert from "node:assert/strict";
// Import dependency used by this module.
import { describe, it } from "node:test";
// Import dependency used by this module.
import { addBusyId, isBusy, removeBusyId } from "../pages/locations/busyIds";
// Import dependency used by this module.
import { runWithBusyGate } from "./ticketBusyGate";

// Function definition.
function deferred<T>() {
  // Mutable local binding.
  let resolve!: (value: T) => void;
  // Mutable local binding.
  let reject!: (err: unknown) => void;
  // Local constant binding.
  const promise = new Promise<T>((res, rej) => {
    // Assign value for subsequent use.
    resolve = res;
    // Assign value for subsequent use.
    reject = rej;
  });
  // Return computed result to caller.
  return { promise, resolve, reject };
}

// Group related unit tests.
describe("runWithBusyGate", () => {
  // Unit test case.
  it("denies a second begin without running the action", async () => {
    // Mutable local binding.
    let busy = new Set<string>();
    // Local constant binding.
    const gate = {
      // Arrow function / callback body.
      begin: (id: string) => {
        // Conditional branch for this case.
        if (isBusy(busy, id)) return false;
        // Assign value for subsequent use.
        busy = addBusyId(busy, id);
        // Return computed result to caller.
        return true;
      },
      // Arrow function / callback body.
      end: (id: string) => {
        // Assign value for subsequent use.
        busy = removeBusyId(busy, id);
      },
    };
    // Mutable local binding.
    let runs = 0;
    // Local constant binding.
    const first = deferred<string>();
    // Local constant binding.
    const p1 = runWithBusyGate(gate, "t1", async () => {
      // Assign value for subsequent use.
      runs += 1;
      // Return computed result to caller.
      return first.promise;
    });
    // Local constant binding.
    const denied = await runWithBusyGate(gate, "t1", async () => {
      // Assign value for subsequent use.
      runs += 1;
      // Return computed result to caller.
      return "nope";
    });
    // Assert expected test outcome.
    assert.deepEqual(denied, { ran: false });
    // Assert expected test outcome.
    assert.equal(runs, 1);
    // Invoke helper or pass arguments.
    first.resolve("ok");
    // Local constant binding.
    const done = await p1;
    // Assert expected test outcome.
    assert.deepEqual(done, { ran: true, result: "ok" });
    // Assert expected test outcome.
    assert.equal(busy.size, 0);
  });

  // Unit test case.
  it("allows parallel operations on different ids", async () => {
    // Mutable local binding.
    let busy = new Set<string>();
    // Local constant binding.
    const gate = {
      // Arrow function / callback body.
      begin: (id: string) => {
        // Conditional branch for this case.
        if (isBusy(busy, id)) return false;
        // Assign value for subsequent use.
        busy = addBusyId(busy, id);
        // Return computed result to caller.
        return true;
      },
      // Arrow function / callback body.
      end: (id: string) => {
        // Assign value for subsequent use.
        busy = removeBusyId(busy, id);
      },
    };
    // Local constant binding.
    const a = deferred<string>();
    // Local constant binding.
    const b = deferred<string>();
    // Local constant binding.
    const pA = runWithBusyGate(gate, "A", () => a.promise);
    // Local constant binding.
    const pB = runWithBusyGate(gate, "B", () => b.promise);
    // Assert expected test outcome.
    assert.equal(isBusy(busy, "A"), true);
    // Assert expected test outcome.
    assert.equal(isBusy(busy, "B"), true);
    // Invoke helper or pass arguments.
    b.resolve("B");
    // Invoke helper or pass arguments.
    a.resolve("A");
    // Assign value for subsequent use.
    const [ra, rb] = await Promise.all([pA, pB]);
    // Assert expected test outcome.
    assert.deepEqual(ra, { ran: true, result: "A" });
    // Assert expected test outcome.
    assert.deepEqual(rb, { ran: true, result: "B" });
    // Assert expected test outcome.
    assert.equal(busy.size, 0);
  });

  // Unit test case.
  it("releases busy on error and does not clear a sibling lock", async () => {
    // Mutable local binding.
    let busy = new Set<string>();
    // Local constant binding.
    const gate = {
      // Arrow function / callback body.
      begin: (id: string) => {
        // Conditional branch for this case.
        if (isBusy(busy, id)) return false;
        // Assign value for subsequent use.
        busy = addBusyId(busy, id);
        // Return computed result to caller.
        return true;
      },
      // Arrow function / callback body.
      end: (id: string) => {
        // Assign value for subsequent use.
        busy = removeBusyId(busy, id);
      },
    };
    // Local constant binding.
    const hold = deferred<string>();
    // Local constant binding.
    const pHold = runWithBusyGate(gate, "keep", () => hold.promise);
    // Await async work before continuing.
    await assert.rejects(
      // Arrow function / callback body.
      runWithBusyGate(gate, "boom", async () => {
        // Abort with an error for the caller.
        throw new Error("fail");
      }),
      // JSX element boundary.
      /fail/,
    );
    // Assert expected test outcome.
    assert.equal(isBusy(busy, "boom"), false);
    // Assert expected test outcome.
    assert.equal(isBusy(busy, "keep"), true);
    // Invoke helper or pass arguments.
    hold.resolve("ok");
    // Await async work before continuing.
    await pHold;
    // Assert expected test outcome.
    assert.equal(busy.size, 0);
  });

  // Unit test case.
  it("finish order B then A leaves neither busy", async () => {
    // Mutable local binding.
    let busy = new Set<string>();
    // Local constant binding.
    const gate = {
      // Arrow function / callback body.
      begin: (id: string) => {
        // Conditional branch for this case.
        if (isBusy(busy, id)) return false;
        // Assign value for subsequent use.
        busy = addBusyId(busy, id);
        // Return computed result to caller.
        return true;
      },
      // Arrow function / callback body.
      end: (id: string) => {
        // Assign value for subsequent use.
        busy = removeBusyId(busy, id);
      },
    };
    // Local constant binding.
    const a = deferred<void>();
    // Local constant binding.
    const b = deferred<void>();
    // Local constant binding.
    const order: string[] = [];
    // Local constant binding.
    const pA = runWithBusyGate(gate, "A", async () => {
      // Await async work before continuing.
      await a.promise;
      // Invoke helper or pass arguments.
      order.push("A");
    });
    // Local constant binding.
    const pB = runWithBusyGate(gate, "B", async () => {
      // Await async work before continuing.
      await b.promise;
      // Invoke helper or pass arguments.
      order.push("B");
    });
    // Invoke helper or pass arguments.
    b.resolve();
    // Await async work before continuing.
    await pB;
    // Assert expected test outcome.
    assert.equal(isBusy(busy, "A"), true);
    // Assert expected test outcome.
    assert.equal(isBusy(busy, "B"), false);
    // Invoke helper or pass arguments.
    a.resolve();
    // Await async work before continuing.
    await pA;
    // Assert expected test outcome.
    assert.deepEqual(order, ["B", "A"]);
    // Assert expected test outcome.
    assert.equal(busy.size, 0);
  });
});
