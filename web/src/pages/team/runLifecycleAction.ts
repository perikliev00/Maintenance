// Import type-only dependency for typing without runtime cost.
import type { Dispatch, SetStateAction } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  ApiRequestError,
  // Support the surrounding logic for this step.
  archivePerson,
  // Support the surrounding logic for this step.
  blockPerson,
  // Support the surrounding logic for this step.
  restorePerson,
  // Support the surrounding logic for this step.
  unblockPerson,
  // Declare type alias Person.
  type Person,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ./labels.
import { t } from "./labels";
// Import module dependency from ./personActions.
import { normalizePersonStatus } from "./personActions";

// Export type definition for consumers of this module.
export type LifecycleAction = "block" | "unblock" | "archive" | "restore";

// Export type definition for consumers of this module.
export type RunLifecycleActionDeps = {
  // Provide locale field used by this structure.
  locale: "bg" | "en";
  // Provide lifecycleBusyId field used by this structure.
  lifecycleBusyId: string | null;
  // Provide setLifecycleBusyId field used by this structure.
  setLifecycleBusyId: (id: string | null) => void;
  // Provide setBannerError field used by this structure.
  setBannerError: (message: string | null) => void;
  // Provide setDetailPerson field used by this structure.
  setDetailPerson: Dispatch<SetStateAction<Person | null>>;
  // Provide getCommittedDirectoryQuery field used by this structure.
  getCommittedDirectoryQuery: () => string;
  // Provide reloadDirectoryWithQuery field used by this structure.
  reloadDirectoryWithQuery: (query: string) => Promise<void>;
};

// Export function runLifecycleAction as part of this module's API.
export async function runLifecycleAction(
  // Provide person field used by this structure.
  person: Person,
  // Provide action field used by this structure.
  action: LifecycleAction,
  // Provide deps field used by this structure.
  deps: RunLifecycleActionDeps,
// Support the surrounding logic for this step.
): Promise<void> {
  // Bind a local value for the following logic.
  const {
    // Support the surrounding logic for this step.
    locale,
    // Support the surrounding logic for this step.
    lifecycleBusyId,
    // Support the surrounding logic for this step.
    setLifecycleBusyId,
    // Support the surrounding logic for this step.
    setBannerError,
    // Support the surrounding logic for this step.
    setDetailPerson,
    // Support the surrounding logic for this step.
    getCommittedDirectoryQuery,
    // Support the surrounding logic for this step.
    reloadDirectoryWithQuery,
  // Support the surrounding logic for this step.
  } = deps;

  // Conditional branch for the case described by this guard.
  if (lifecycleBusyId) return;
  // Bind status for use in the following logic.
  const status = normalizePersonStatus(person);
  // Initialize an object holding related fields.
  const confirmations: Record<LifecycleAction, string> = {
    // Provide block field used by this structure.
    block: t(
      // Support the surrounding logic for this step.
      locale,
      // Support the surrounding logic for this step.
      `Блокиране на ${person.fullName}? Ще се прекратят сесиите и поканите; историята се запазва.`,
      // Support the surrounding logic for this step.
      `Block ${person.fullName}? Sessions and invites will end; history is kept.`,
    ),
    // Provide unblock field used by this structure.
    unblock: t(
      // Support the surrounding logic for this step.
      locale,
      // Support the surrounding logic for this step.
      `Отблокиране на ${person.fullName}? Стари сесии, покани и устройства не се възстановяват — нужен е нов вход или нова покана.`,
      // Support the surrounding logic for this step.
      `Unblock ${person.fullName}? Old sessions, invites, and devices are not restored — a new login or invite is required.`,
    ),
    // Provide archive field used by this structure.
    archive: t(
      // Support the surrounding logic for this step.
      locale,
      // Support the surrounding logic for this step.
      `Премахване на ${person.fullName} от екипа? Служителят се архивира и губи достъп; историята се запазва. Незавършената работа трябва да е приключена или прехвърлена предварително.`,
      // Support the surrounding logic for this step.
      `Remove ${person.fullName} from the team? The employee is archived and loses access; history is kept. Finish or reassign open work first.`,
    ),
    // Provide restore field used by this structure.
    restore: t(
      // Support the surrounding logic for this step.
      locale,
      // Support the surrounding logic for this step.
      `Възстановяване на ${person.fullName} в екипа? Достъпът остава спрян — нужни са отблокиране и/или ново активиране.`,
      // Support the surrounding logic for this step.
      `Restore ${person.fullName} to the team? Access stays stopped — unblock and/or a new activation are still required.`,
    ),
  };
  // Conditional branch for the case described by this guard.
  if (!window.confirm(confirmations[action])) return;

  // Update React state so the UI reflects the new value.
  setLifecycleBusyId(person.employeeId);
  // Update React state so the UI reflects the new value.
  setBannerError(null);
  // Begin guarded block to catch runtime failures.
  try {
    // Bind fn for use in the following logic.
    const fn =
      // Support the surrounding logic for this step.
      action === "block"
        // Support the surrounding logic for this step.
        ? blockPerson
        // Support the surrounding logic for this step.
        : action === "unblock"
          // Support the surrounding logic for this step.
          ? unblockPerson
          // Support the surrounding logic for this step.
          : action === "archive"
            // Support the surrounding logic for this step.
            ? archivePerson
            // Support the surrounding logic for this step.
            : restorePerson;
    // Bind updated for use in the following logic.
    const updated = await fn(
      // Support the surrounding logic for this step.
      person.employeeId,
      // Support the surrounding logic for this step.
      status,
      // Support the surrounding logic for this step.
      person.accessVersion ?? 0,
    );
    // Update React state so the UI reflects the new value.
    setDetailPerson((prev) =>
      // Support the surrounding logic for this step.
      prev?.employeeId === updated.employeeId ? updated : prev,
    );
    // Wait for an async operation before continuing.
    await reloadDirectoryWithQuery(getCommittedDirectoryQuery());
  // Support the surrounding logic for this step.
  } catch (err) {
    // Bind stale for use in the following logic.
    const stale =
      // Support the surrounding logic for this step.
      err instanceof ApiRequestError && err.code === "stale_state";
    // Update React state so the UI reflects the new value.
    setBannerError(
      // Support the surrounding logic for this step.
      stale
        // Support the surrounding logic for this step.
        ? t(
            // Support the surrounding logic for this step.
            locale,
            // Support the surrounding logic for this step.
            "Състоянието е променено от друг потребител. Списъкът е обновен — прегледайте и опитайте отново.",
            // Support the surrounding logic for this step.
            "Status was changed by someone else. The list was refreshed — review and try again.",
          )
        // Support the surrounding logic for this step.
        : err instanceof Error
          // Support the surrounding logic for this step.
          ? err.message
          // Support the surrounding logic for this step.
          : t(locale, "Неуспешна операция", "Operation failed"),
    );
    // Wait for an async operation before continuing.
    await reloadDirectoryWithQuery(getCommittedDirectoryQuery());
  // Support the surrounding logic for this step.
  } finally {
    // Update React state so the UI reflects the new value.
    setLifecycleBusyId(null);
  }
}
