import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  markReachable,
  markUnreachable,
  resolveConn,
  setDraining,
} from "./connState";

const originalNavigator = globalThis.navigator;

function stubNavigatorOnline(online: boolean): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: online },
  });
}

describe("resolveConn", () => {
  before(() => {
    stubNavigatorOnline(true);
  });

  after(() => {
    if (originalNavigator === undefined) {
      // @ts-expect-error restore Node without navigator
      delete globalThis.navigator;
    } else {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator,
      });
    }
    setDraining(false);
    markReachable();
  });

  beforeEach(() => {
    stubNavigatorOnline(true);
    setDraining(false);
    markReachable();
  });

  it("returns explicit conn override", () => {
    stubNavigatorOnline(false);
    markUnreachable();
    setDraining(true);
    assert.equal(resolveConn("offline"), "offline");
    assert.equal(resolveConn("syncing"), "syncing");
    assert.equal(resolveConn("online"), "online");
  });

  it("returns offline when navigator is offline", () => {
    stubNavigatorOnline(false);
    assert.equal(resolveConn(), "offline");
  });

  it("returns unreachable when API is marked unreachable", () => {
    stubNavigatorOnline(true);
    markUnreachable();
    assert.equal(resolveConn(), "unreachable");
  });

  it("returns syncing when draining", () => {
    setDraining(true);
    assert.equal(resolveConn(), "syncing");
  });

  it("returns syncing when pending or sending > 0", () => {
    assert.equal(
      resolveConn(undefined, { pending: 1, sending: 0, conflict: 0, failed: 0 }),
      "syncing",
    );
    assert.equal(
      resolveConn(undefined, { pending: 0, sending: 1, conflict: 0, failed: 0 }),
      "syncing",
    );
  });

  it("returns online when idle", () => {
    assert.equal(resolveConn(), "online");
    assert.equal(
      resolveConn(undefined, { pending: 0, sending: 0, conflict: 2, failed: 1 }),
      "online",
    );
  });

  it("prefers offline navigator over unreachable", () => {
    stubNavigatorOnline(false);
    markUnreachable();
    assert.equal(resolveConn(), "offline");
  });
});
