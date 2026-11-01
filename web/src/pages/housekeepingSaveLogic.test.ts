/**
 * Unit coverage for shared housekeeping helpers (BUG-03/04/08/09/10).
 * Imports production modules — not local clones.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canCreateSector,
  catalogChangedEvent,
  classifySaveRefreshOutcome,
  HOUSEKEEPING_CATALOG_CHANGED,
  isCatalogChangedEvent,
  mergeIndependentLoadErrors,
  shouldApplySectorSaveResult,
} from "./housekeepingLogic";

describe("housekeepingLogic (production helpers)", () => {
  it("BUG-09: separates successful save from failed refresh", () => {
    assert.equal(
      classifySaveRefreshOutcome({ saveOk: true, refreshOk: false }),
      "saved_refresh_failed",
    );
    assert.equal(
      classifySaveRefreshOutcome({ saveOk: true, refreshOk: true }),
      "saved",
    );
    assert.equal(
      classifySaveRefreshOutcome({ saveOk: false, refreshOk: true }),
      "save_failed",
    );
  });

  it("BUG-03: supervisors with manage cannot create sectors", () => {
    assert.equal(canCreateSector("supervisor", true), false);
    assert.equal(canCreateSector("manager", true), true);
    assert.equal(canCreateSector("manager", false), false);
    assert.equal(canCreateSector("owner", true), true);
  });

  it("BUG-08: save result applies only to the in-flight edit identity", () => {
    assert.equal(
      shouldApplySectorSaveResult({
        savingId: "sec-1",
        targetId: "sec-1",
      }),
      true,
    );
    assert.equal(
      shouldApplySectorSaveResult({
        savingId: "sec-1",
        targetId: "sec-2",
      }),
      false,
    );
    assert.equal(
      shouldApplySectorSaveResult({
        savingId: "__create__",
        targetId: null,
      }),
      true,
    );
    assert.equal(
      shouldApplySectorSaveResult({
        savingId: null,
        targetId: "sec-1",
      }),
      false,
    );
  });

  it("BUG-04: independent load errors merge without blanking siblings", () => {
    assert.equal(
      mergeIndependentLoadErrors({
        sectors: null,
        shifts: "shifts failed",
        people: null,
      }),
      "shifts failed",
    );
    assert.equal(
      mergeIndependentLoadErrors({
        sectors: "sectors failed",
        shifts: "shifts failed",
      }),
      "sectors failed · shifts failed",
    );
    assert.equal(mergeIndependentLoadErrors({}), null);
  });

  it("BUG-10: catalog-changed event identity", () => {
    assert.equal(HOUSEKEEPING_CATALOG_CHANGED, "housekeeping:catalog-changed");
    assert.equal(isCatalogChangedEvent(catalogChangedEvent()), true);
    assert.equal(isCatalogChangedEvent(new Event(HOUSEKEEPING_CATALOG_CHANGED)), false);
    assert.equal(isCatalogChangedEvent(new Event("other")), false);
  });
});
