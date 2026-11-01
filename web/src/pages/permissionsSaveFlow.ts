/**
 * Framework-free PermissionsPage save orchestration (BUG-03/04/06).
 * Callers supply IO deps so node:test can exercise PUT/GET failure splits
 * and parallel in-flight role tracking without a React renderer.
 */
import {
  addSavingRole,
  removeSavingRole,
  saveFeedbackForConflict,
  saveFeedbackForPutSuccess,
  saveFeedbackForRefreshFailure,
  type RoleGrantDraft,
  type SaveFeedback,
} from "./permissionsPageState";

export type PermissionsPutResult = RoleGrantDraft & {
  version: number;
  changes?: number;
};

export type PermissionsSaveInput = {
  role: string;
  roleLabel: string;
  draft: RoleGrantDraft | undefined;
  expectedVersion: number | undefined;
  reason?: string;
  /** Roles currently mid-save (mutated via begin/end helpers). */
  savingRoles: ReadonlySet<string>;
};

export type PermissionsSaveDeps = {
  put: (input: {
    role: string;
    panels: string[];
    actions: string[];
    expectedVersion: number;
    reason?: string;
  }) => Promise<PermissionsPutResult>;
  /** Runs only after PUT succeeds (session /me and/or history reload). */
  refreshAfterSave: () => Promise<void>;
  /** Optional matrix reload after a 409 conflict. */
  reloadOnConflict?: () => Promise<void>;
  isConflictError: (err: unknown) => boolean;
};

export type PermissionsSaveOutcome = {
  feedback: SaveFeedback;
  putSucceeded: boolean;
  saved?: PermissionsPutResult;
  /** True when save was skipped (already in flight / missing draft or version). */
  skipped?: boolean;
};

/** Guard + mark role busy before starting a save. Returns null if blocked. */
export function beginPermissionsSave(
  savingRoles: ReadonlySet<string>,
  role: string,
): Set<string> | null {
  if (savingRoles.has(role)) return null;
  return addSavingRole(savingRoles, role);
}

export function endPermissionsSave(
  savingRoles: ReadonlySet<string>,
  role: string,
): Set<string> {
  return removeSavingRole(savingRoles, role);
}

/**
 * Execute one role save. PUT success is sticky even when follow-up refresh fails.
 * Does not mutate drafts — caller applies `saved` via applySavedRoleToDraft.
 */
export async function runPermissionsSave(
  input: PermissionsSaveInput,
  deps: PermissionsSaveDeps,
): Promise<PermissionsSaveOutcome> {
  if (!input.draft) {
    return {
      skipped: true,
      putSucceeded: false,
      feedback: { kind: "error", text: "Save failed" },
    };
  }
  if (input.savingRoles.has(input.role)) {
    return {
      skipped: true,
      putSucceeded: false,
      feedback: { kind: "error", text: "Save already in progress" },
    };
  }
  if (
    typeof input.expectedVersion !== "number" ||
    !Number.isInteger(input.expectedVersion)
  ) {
    return {
      putSucceeded: false,
      feedback: {
        kind: "error",
        text: "Липсва версия на матрицата. Презаредете страницата.",
      },
    };
  }

  let putSucceeded = false;
  try {
    const saved = await deps.put({
      role: input.role,
      panels: input.draft.panels,
      actions: input.draft.actions,
      expectedVersion: input.expectedVersion,
      reason: input.reason,
    });
    putSucceeded = true;

    try {
      await deps.refreshAfterSave();
      return {
        putSucceeded: true,
        saved,
        feedback: saveFeedbackForPutSuccess(input.roleLabel),
      };
    } catch {
      return {
        putSucceeded: true,
        saved,
        feedback: saveFeedbackForRefreshFailure(input.roleLabel),
      };
    }
  } catch (err) {
    if (!putSucceeded && deps.isConflictError(err)) {
      try {
        await deps.reloadOnConflict?.();
      } catch {
        /* keep conflict message */
      }
      return { putSucceeded: false, feedback: saveFeedbackForConflict() };
    }
    if (!putSucceeded) {
      return {
        putSucceeded: false,
        feedback: {
          kind: "error",
          text: err instanceof Error ? err.message : "Save failed",
        },
      };
    }
    return {
      putSucceeded: true,
      feedback: saveFeedbackForRefreshFailure(input.roleLabel),
    };
  }
}

/**
 * Simulate two overlapping saves finishing in either order; asserts the
 * busy-set never drops a still-in-flight sibling (BUG-04).
 */
export async function runOverlappingRoleSaves(input: {
  roleA: string;
  roleB: string;
  saveA: () => Promise<void>;
  saveB: () => Promise<void>;
  /** "a-first" | "b-first" completion preference via deferred release. */
  finishOrder: "a-then-b" | "b-then-a";
}): Promise<{ snapshots: string[][]; final: string[] }> {
  let saving = new Set<string>();
  const snapshots: string[][] = [];

  const snap = () => {
    snapshots.push([...saving].sort());
  };

  // Begin both saves before either finishes (deterministic, no race on Set).
  const beganA = beginPermissionsSave(saving, input.roleA);
  if (!beganA) throw new Error("A blocked");
  saving = beganA;
  snap();
  const beganB = beginPermissionsSave(saving, input.roleB);
  if (!beganB) throw new Error("B blocked");
  saving = beganB;
  snap();

  let releaseA!: () => void;
  let releaseB!: () => void;
  const gateA = new Promise<void>((r) => {
    releaseA = r;
  });
  const gateB = new Promise<void>((r) => {
    releaseB = r;
  });

  const startedA = (async () => {
    await gateA;
    await input.saveA();
    saving = endPermissionsSave(saving, input.roleA);
    snap();
  })();

  const startedB = (async () => {
    await gateB;
    await input.saveB();
    saving = endPermissionsSave(saving, input.roleB);
    snap();
  })();

  if (input.finishOrder === "a-then-b") {
    releaseA();
    await startedA;
    releaseB();
    await startedB;
  } else {
    releaseB();
    await startedB;
    releaseA();
    await startedA;
  }

  return { snapshots, final: [...saving].sort() };
}
