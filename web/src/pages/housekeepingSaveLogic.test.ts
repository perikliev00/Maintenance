/**
 * Unit coverage for shared housekeeping helpers .
 * Imports production modules — not local clones.
 */
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  canCreateSector,
  // Support the surrounding logic for this step.
  catalogChangedEvent,
  // Support the surrounding logic for this step.
  classifySaveRefreshOutcome,
  // Support the surrounding logic for this step.
  HOUSEKEEPING_CATALOG_CHANGED,
  // Support the surrounding logic for this step.
  isCatalogChangedEvent,
  // Support the surrounding logic for this step.
  mergeIndependentLoadErrors,
  // Support the surrounding logic for this step.
  shouldApplySectorSaveResult,
// Support the surrounding logic for this step.
} from "./housekeepingLogic";

// Group related tests under a shared suite name.
describe("housekeepingLogic (production helpers)", () => {
  // Define a single test case and its expectation.
  it("separates successful save from failed refresh", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke classifySaveRefreshOutcome to perform this step.
      classifySaveRefreshOutcome({ saveOk: true, refreshOk: false }),
      // Support the surrounding logic for this step.
      "saved_refresh_failed",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke classifySaveRefreshOutcome to perform this step.
      classifySaveRefreshOutcome({ saveOk: true, refreshOk: true }),
      // Support the surrounding logic for this step.
      "saved",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke classifySaveRefreshOutcome to perform this step.
      classifySaveRefreshOutcome({ saveOk: false, refreshOk: true }),
      // Support the surrounding logic for this step.
      "save_failed",
    );
  });

  // Define a single test case and its expectation.
  it("supervisors with manage cannot create sectors", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(canCreateSector("supervisor", true), false);
    // Invoke assert.equal to perform this step.
    assert.equal(canCreateSector("manager", true), true);
    // Invoke assert.equal to perform this step.
    assert.equal(canCreateSector("manager", false), false);
    // Invoke assert.equal to perform this step.
    assert.equal(canCreateSector("owner", true), true);
  });

  // Define a single test case and its expectation.
  it("save result applies only to the in-flight edit identity", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldApplySectorSaveResult to perform this step.
      shouldApplySectorSaveResult({
        // Provide savingId field used by this structure.
        savingId: "sec-1",
        // Provide targetId field used by this structure.
        targetId: "sec-1",
      }),
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldApplySectorSaveResult to perform this step.
      shouldApplySectorSaveResult({
        // Provide savingId field used by this structure.
        savingId: "sec-1",
        // Provide targetId field used by this structure.
        targetId: "sec-2",
      }),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldApplySectorSaveResult to perform this step.
      shouldApplySectorSaveResult({
        // Provide savingId field used by this structure.
        savingId: "__create__",
        // Provide targetId field used by this structure.
        targetId: null,
      }),
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldApplySectorSaveResult to perform this step.
      shouldApplySectorSaveResult({
        // Provide savingId field used by this structure.
        savingId: null,
        // Provide targetId field used by this structure.
        targetId: "sec-1",
      }),
      // Support the surrounding logic for this step.
      false,
    );
  });

  // Define a single test case and its expectation.
  it("independent load errors merge without blanking siblings", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke mergeIndependentLoadErrors to perform this step.
      mergeIndependentLoadErrors({
        // Provide sectors field used by this structure.
        sectors: null,
        // Provide shifts field used by this structure.
        shifts: "shifts failed",
        // Provide people field used by this structure.
        people: null,
      }),
      // Support the surrounding logic for this step.
      "shifts failed",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke mergeIndependentLoadErrors to perform this step.
      mergeIndependentLoadErrors({
        // Provide sectors field used by this structure.
        sectors: "sectors failed",
        // Provide shifts field used by this structure.
        shifts: "shifts failed",
      }),
      // Support the surrounding logic for this step.
      "sectors failed · shifts failed",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(mergeIndependentLoadErrors({}), null);
  });

  // Define a single test case and its expectation.
  it("catalog-changed event identity", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(HOUSEKEEPING_CATALOG_CHANGED, "housekeeping:catalog-changed");
    // Invoke assert.equal to perform this step.
    assert.equal(isCatalogChangedEvent(catalogChangedEvent()), true);
    // Invoke assert.equal to perform this step.
    assert.equal(isCatalogChangedEvent(new Event(HOUSEKEEPING_CATALOG_CHANGED)), false);
    // Invoke assert.equal to perform this step.
    assert.equal(isCatalogChangedEvent(new Event("other")), false);
  });
});
