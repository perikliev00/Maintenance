/**
 * Framework-free PermissionsPage save orchestration (BUG-03/04/06).
 * Callers supply IO deps so node:test can exercise PUT/GET failure splits
 * and parallel in-flight role tracking without a React renderer.
 *
 * Save-vs-refresh uses executeMutationWithRefresh (same semantics as
 * useBusyMutation); per-role busy stays via begin/endPermissionsSave.
 */
import { executeMutationWithRefresh } from "../saveRefresh";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  addSavingRole,
  // Support the surrounding logic for this step.
  removeSavingRole,
  // Support the surrounding logic for this step.
  saveFeedbackForConflict,
  // Support the surrounding logic for this step.
  saveFeedbackForPutSuccess,
  // Support the surrounding logic for this step.
  saveFeedbackForRefreshFailure,
  // Declare type alias RoleGrantDraft.
  type RoleGrantDraft,
  // Declare type alias SaveFeedback.
  type SaveFeedback,
// Support the surrounding logic for this step.
} from "./permissionsPageState";

// Export type definition for consumers of this module.
export type PermissionsPutResult = RoleGrantDraft & {
  // Provide version field used by this structure.
  version: number;
  // Support the surrounding logic for this step.
  changes?: number;
};

// Export type definition for consumers of this module.
export type PermissionsSaveInput = {
  // Provide role field used by this structure.
  role: string;
  // Provide roleLabel field used by this structure.
  roleLabel: string;
  // Provide draft field used by this structure.
  draft: RoleGrantDraft | undefined;
  // Provide expectedVersion field used by this structure.
  expectedVersion: number | undefined;
  // Support the surrounding logic for this step.
  reason?: string;
  /** Roles currently mid-save (mutated via begin/end helpers). */
  savingRoles: ReadonlySet<string>;
};

// Export type definition for consumers of this module.
export type PermissionsSaveDeps = {
  // Provide put field used by this structure.
  put: (input: {
    // Provide role field used by this structure.
    role: string;
    // Provide panels field used by this structure.
    panels: string[];
    // Provide actions field used by this structure.
    actions: string[];
    // Provide expectedVersion field used by this structure.
    expectedVersion: number;
    // Support the surrounding logic for this step.
    reason?: string;
  // Support the surrounding logic for this step.
  }) => Promise<PermissionsPutResult>;
  /** Runs only after PUT succeeds (session /me and/or history reload). */
  refreshAfterSave: () => Promise<void>;
  /** Optional matrix reload after a 409 conflict. */
  reloadOnConflict?: () => Promise<void>;
  // Provide isConflictError field used by this structure.
  isConflictError: (err: unknown) => boolean;
};

// Export type definition for consumers of this module.
export type PermissionsSaveOutcome = {
  // Provide feedback field used by this structure.
  feedback: SaveFeedback;
  // Provide putSucceeded field used by this structure.
  putSucceeded: boolean;
  // Support the surrounding logic for this step.
  saved?: PermissionsPutResult;
  /** True when save was skipped (already in flight / missing draft or version). */
  skipped?: boolean;
};

/** Guard + mark role busy before starting a save. Returns null if blocked. */
export function beginPermissionsSave(
  // Provide savingRoles field used by this structure.
  savingRoles: ReadonlySet<string>,
  // Provide role field used by this structure.
  role: string,
// Support the surrounding logic for this step.
): Set<string> | null {
  // Conditional branch for the case described by this guard.
  if (savingRoles.has(role)) return null;
  // Return early result or rendered output from this path.
  return addSavingRole(savingRoles, role);
}

// Export function endPermissionsSave as part of this module's API.
export function endPermissionsSave(
  // Provide savingRoles field used by this structure.
  savingRoles: ReadonlySet<string>,
  // Provide role field used by this structure.
  role: string,
// Support the surrounding logic for this step.
): Set<string> {
  // Return early result or rendered output from this path.
  return removeSavingRole(savingRoles, role);
}

/**
 * Execute one role save. PUT success is sticky even when follow-up refresh fails.
 * Does not mutate drafts — caller applies `saved` via applySavedRoleToDraft.
 */
export async function runPermissionsSave(
  // Provide input field used by this structure.
  input: PermissionsSaveInput,
  // Provide deps field used by this structure.
  deps: PermissionsSaveDeps,
// Support the surrounding logic for this step.
): Promise<PermissionsSaveOutcome> {
  // Bind draft for use in the following logic.
  const draft = input.draft;
  // Conditional branch for the case described by this guard.
  if (!draft) {
    // Return early result or rendered output from this path.
    return {
      // Provide skipped field used by this structure.
      skipped: true,
      // Provide putSucceeded field used by this structure.
      putSucceeded: false,
      // Provide feedback field used by this structure.
      feedback: { kind: "error", text: "Save failed" },
    };
  }
  // Conditional branch for the case described by this guard.
  if (input.savingRoles.has(input.role)) {
    // Return early result or rendered output from this path.
    return {
      // Provide skipped field used by this structure.
      skipped: true,
      // Provide putSucceeded field used by this structure.
      putSucceeded: false,
      // Provide feedback field used by this structure.
      feedback: { kind: "error", text: "Save already in progress" },
    };
  }
  // Bind expectedVersion for use in the following logic.
  const expectedVersion = input.expectedVersion;
  // Conditional branch for the case described by this guard.
  if (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion)) {
    // Return early result or rendered output from this path.
    return {
      // Provide putSucceeded field used by this structure.
      putSucceeded: false,
      // Provide feedback field used by this structure.
      feedback: {
        // Provide kind field used by this structure.
        kind: "error",
        // Provide text field used by this structure.
        text: "Липсва версия на матрицата. Презаредете страницата.",
      },
    };
  }

  // Bind result for use in the following logic.
  const result = await executeMutationWithRefresh(
    // Support the surrounding logic for this step.
    () =>
      // Invoke deps.put to perform this step.
      deps.put({
        // Provide role field used by this structure.
        role: input.role,
        // Provide panels field used by this structure.
        panels: draft.panels,
        // Provide actions field used by this structure.
        actions: draft.actions,
        // Support the surrounding logic for this step.
        expectedVersion,
        // Provide reason field used by this structure.
        reason: input.reason,
      }),
    // Support the surrounding logic for this step.
    () => deps.refreshAfterSave(),
  );

  // Conditional branch for the case described by this guard.
  if (!result.ok) {
    // Conditional branch for the case described by this guard.
    if (deps.isConflictError(result.cause)) {
      // Begin guarded block to catch runtime failures.
      try {
        // Wait for an async operation before continuing.
        await deps.reloadOnConflict?.();
      // Support the surrounding logic for this step.
      } catch {
        /* keep conflict message */
      }
      // Return early result or rendered output from this path.
      return { putSucceeded: false, feedback: saveFeedbackForConflict() };
    }
    // Return early result or rendered output from this path.
    return {
      // Provide putSucceeded field used by this structure.
      putSucceeded: false,
      // Provide feedback field used by this structure.
      feedback: {
        // Provide kind field used by this structure.
        kind: "error",
        // Provide text field used by this structure.
        text: result.error,
      },
    };
  }

  // Conditional branch for the case described by this guard.
  if (result.outcome === "saved_refresh_failed") {
    // Return early result or rendered output from this path.
    return {
      // Provide putSucceeded field used by this structure.
      putSucceeded: true,
      // Provide saved field used by this structure.
      saved: result.value,
      // Provide feedback field used by this structure.
      feedback: saveFeedbackForRefreshFailure(input.roleLabel),
    };
  }

  // Return early result or rendered output from this path.
  return {
    // Provide putSucceeded field used by this structure.
    putSucceeded: true,
    // Provide saved field used by this structure.
    saved: result.value,
    // Provide feedback field used by this structure.
    feedback: saveFeedbackForPutSuccess(input.roleLabel),
  };
}

/**
 * Simulate two overlapping saves finishing in either order; asserts the
 * busy-set never drops a still-in-flight sibling (BUG-04).
 */
export async function runOverlappingRoleSaves(input: {
  // Provide roleA field used by this structure.
  roleA: string;
  // Provide roleB field used by this structure.
  roleB: string;
  // Provide saveA field used by this structure.
  saveA: () => Promise<void>;
  // Provide saveB field used by this structure.
  saveB: () => Promise<void>;
  /** "a-first" | "b-first" completion preference via deferred release. */
  finishOrder: "a-then-b" | "b-then-a";
// Support the surrounding logic for this step.
}): Promise<{ snapshots: string[][]; final: string[] }> {
  // Create a Set/Map for efficient membership or keyed lookup.
  let saving = new Set<string>();
  // Initialize an array used by subsequent logic.
  const snapshots: string[][] = [];

  // Bind snap for use in the following logic.
  const snap = () => {
    // Invoke snapshots.push to perform this step.
    snapshots.push([...saving].sort());
  };

  // Begin both saves before either finishes (deterministic, no race on Set).
  const beganA = beginPermissionsSave(saving, input.roleA);
  // Conditional branch for the case described by this guard.
  if (!beganA) throw new Error("A blocked");
  // Support the surrounding logic for this step.
  saving = beganA;
  // Invoke snap to perform this step.
  snap();
  // Bind beganB for use in the following logic.
  const beganB = beginPermissionsSave(saving, input.roleB);
  // Conditional branch for the case described by this guard.
  if (!beganB) throw new Error("B blocked");
  // Support the surrounding logic for this step.
  saving = beganB;
  // Invoke snap to perform this step.
  snap();

  // Bind releaseA for use in the following logic.
  let releaseA!: () => void;
  // Bind releaseB for use in the following logic.
  let releaseB!: () => void;
  // Bind gateA for use in the following logic.
  const gateA = new Promise<void>((r) => {
    // Support the surrounding logic for this step.
    releaseA = r;
  });
  // Bind gateB for use in the following logic.
  const gateB = new Promise<void>((r) => {
    // Support the surrounding logic for this step.
    releaseB = r;
  });

  // Bind startedA for use in the following logic.
  const startedA = (async () => {
    // Wait for an async operation before continuing.
    await gateA;
    // Wait for an async operation before continuing.
    await input.saveA();
    // Support the surrounding logic for this step.
    saving = endPermissionsSave(saving, input.roleA);
    // Invoke snap to perform this step.
    snap();
  // Support the surrounding logic for this step.
  })();

  // Bind startedB for use in the following logic.
  const startedB = (async () => {
    // Wait for an async operation before continuing.
    await gateB;
    // Wait for an async operation before continuing.
    await input.saveB();
    // Support the surrounding logic for this step.
    saving = endPermissionsSave(saving, input.roleB);
    // Invoke snap to perform this step.
    snap();
  // Support the surrounding logic for this step.
  })();

  // Conditional branch for the case described by this guard.
  if (input.finishOrder === "a-then-b") {
    // Invoke releaseA to perform this step.
    releaseA();
    // Wait for an async operation before continuing.
    await startedA;
    // Invoke releaseB to perform this step.
    releaseB();
    // Wait for an async operation before continuing.
    await startedB;
  // Support the surrounding logic for this step.
  } else {
    // Invoke releaseB to perform this step.
    releaseB();
    // Wait for an async operation before continuing.
    await startedB;
    // Invoke releaseA to perform this step.
    releaseA();
    // Wait for an async operation before continuing.
    await startedA;
  }

  // Return early result or rendered output from this path.
  return { snapshots, final: [...saving].sort() };
}
