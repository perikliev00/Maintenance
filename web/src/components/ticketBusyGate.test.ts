import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addBusyId, isBusy, removeBusyId } from "../pages/locations/busyIds";
import { runWithBusyGate } from "./ticketBusyGate";

// Function definition.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runWithBusyGate", () => {
  it("denies a second begin without running the action", async () => {
    let busy = new Set<string>();
    const gate = {
      begin: (id: string) => {
        if (isBusy(busy, id)) return false;
        busy = addBusyId(busy, id);
        return true;
      },
      end: (id: string) => {
        busy = removeBusyId(busy, id);
      },
    };
    let runs = 0;
    const first = deferred<string>();
    const p1 = runWithBusyGate(gate, "t1", async () => {
      runs += 1;
      return first.promise;
    });
    const denied = await runWithBusyGate(gate, "t1", async () => {
      runs += 1;
      return "nope";
    });
    assert.deepEqual(denied, { ran: false });
    assert.equal(runs, 1);
    first.resolve("ok");
    const done = await p1;
    assert.deepEqual(done, { ran: true, result: "ok" });
    assert.equal(busy.size, 0);
  });

  it("allows parallel operations on different ids", async () => {
    let busy = new Set<string>();
    const gate = {
      begin: (id: string) => {
        if (isBusy(busy, id)) return false;
        busy = addBusyId(busy, id);
        return true;
      },
      end: (id: string) => {
        busy = removeBusyId(busy, id);
      },
    };
    const a = deferred<string>();
    const b = deferred<string>();
    const pA = runWithBusyGate(gate, "A", () => a.promise);
    const pB = runWithBusyGate(gate, "B", () => b.promise);
    assert.equal(isBusy(busy, "A"), true);
    assert.equal(isBusy(busy, "B"), true);
    b.resolve("B");
    a.resolve("A");
    const [ra, rb] = await Promise.all([pA, pB]);
    assert.deepEqual(ra, { ran: true, result: "A" });
    assert.deepEqual(rb, { ran: true, result: "B" });
    assert.equal(busy.size, 0);
  });

  it("releases busy on error and does not clear a sibling lock", async () => {
    let busy = new Set<string>();
    const gate = {
      begin: (id: string) => {
        if (isBusy(busy, id)) return false;
        busy = addBusyId(busy, id);
        return true;
      },
      end: (id: string) => {
        busy = removeBusyId(busy, id);
      },
    };
    const hold = deferred<string>();
    const pHold = runWithBusyGate(gate, "keep", () => hold.promise);
    await assert.rejects(
      runWithBusyGate(gate, "boom", async () => {
        throw new Error("fail");
      }),
      // JSX element boundary.
      /fail/,
    );
    assert.equal(isBusy(busy, "boom"), false);
    assert.equal(isBusy(busy, "keep"), true);
    hold.resolve("ok");
    await pHold;
    assert.equal(busy.size, 0);
  });

  it("finish order B then A leaves neither busy", async () => {
    let busy = new Set<string>();
    const gate = {
      begin: (id: string) => {
        if (isBusy(busy, id)) return false;
        busy = addBusyId(busy, id);
        return true;
      },
      end: (id: string) => {
        busy = removeBusyId(busy, id);
      },
    };
    const a = deferred<void>();
    const b = deferred<void>();
    const order: string[] = [];
    const pA = runWithBusyGate(gate, "A", async () => {
      await a.promise;
      order.push("A");
    });
    const pB = runWithBusyGate(gate, "B", async () => {
      await b.promise;
      order.push("B");
    });
    b.resolve();
    await pB;
    assert.equal(isBusy(busy, "A"), true);
    assert.equal(isBusy(busy, "B"), false);
    a.resolve();
    await pA;
    assert.deepEqual(order, ["B", "A"]);
    assert.equal(busy.size, 0);
  });
});
