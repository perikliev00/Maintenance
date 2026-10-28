import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addBusyId, isBusy, removeBusyId } from "./busyIds";

describe("busyIds concurrent tracking", () => {
  it("tracks multiple rows independently", () => {
    let busy = new Set<string>();
    busy = addBusyId(busy, "A");
    busy = addBusyId(busy, "B");
    assert.equal(isBusy(busy, "A"), true);
    assert.equal(isBusy(busy, "B"), true);

    busy = removeBusyId(busy, "A");
    assert.equal(isBusy(busy, "A"), false);
    assert.equal(isBusy(busy, "B"), true);
  });

  it("does not clear sibling busy when one finishes first", async () => {
    let busy = new Set<string>();
    const order: string[] = [];

    async function run(id: string, delayMs: number) {
      if (isBusy(busy, id)) return;
      busy = addBusyId(busy, id);
      await new Promise((r) => setTimeout(r, delayMs));
      order.push(id);
      busy = removeBusyId(busy, id);
    }

    await Promise.all([run("A", 40), run("B", 10)]);
    assert.deepEqual(order, ["B", "A"]);
    assert.equal(busy.size, 0);
  });

  it("rejects a second begin for the same id while busy", () => {
    let busy = new Set<string>();
    busy = addBusyId(busy, "A");
    const before = busy.size;
    // Mimic beginBusy: skip add when already present.
    if (!isBusy(busy, "A")) {
      busy = addBusyId(busy, "A");
    }
    assert.equal(busy.size, before);
  });
});
