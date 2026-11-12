import type { Dispatch, SetStateAction } from "react";
import {
  ApiRequestError,
  archivePerson,
  blockPerson,
  restorePerson,
  unblockPerson,
  type Person,
} from "../../api/client";
import { t } from "./labels";
import { normalizePersonStatus } from "./personActions";

export type LifecycleAction = "block" | "unblock" | "archive" | "restore";

export type RunLifecycleActionDeps = {
  locale: "bg" | "en";
  lifecycleBusyId: string | null;
  setLifecycleBusyId: (id: string | null) => void;
  setBannerError: (message: string | null) => void;
  setDetailPerson: Dispatch<SetStateAction<Person | null>>;
  getCommittedDirectoryQuery: () => string;
  reloadDirectoryWithQuery: (query: string) => Promise<void>;
};

// Export function runLifecycleAction as part of this module's API.
export async function runLifecycleAction(
  person: Person,
  action: LifecycleAction,
  deps: RunLifecycleActionDeps,
): Promise<void> {
  const {
    locale,
    lifecycleBusyId,
    setLifecycleBusyId,
    setBannerError,
    setDetailPerson,
    getCommittedDirectoryQuery,
    reloadDirectoryWithQuery,
  } = deps;

  if (lifecycleBusyId) return;
  const status = normalizePersonStatus(person);
  const confirmations: Record<LifecycleAction, string> = {
    block: t(
      locale,
      `Блокиране на ${person.fullName}? Ще се прекратят сесиите и поканите; историята се запазва.`,
      `Block ${person.fullName}? Sessions and invites will end; history is kept.`,
    ),
    unblock: t(
      locale,
      `Отблокиране на ${person.fullName}? Стари сесии, покани и устройства не се възстановяват — нужен е нов вход или нова покана.`,
      `Unblock ${person.fullName}? Old sessions, invites, and devices are not restored — a new login or invite is required.`,
    ),
    archive: t(
      locale,
      `Премахване на ${person.fullName} от екипа? Служителят се архивира и губи достъп; историята се запазва. Незавършената работа трябва да е приключена или прехвърлена предварително.`,
      `Remove ${person.fullName} from the team? The employee is archived and loses access; history is kept. Finish or reassign open work first.`,
    ),
    restore: t(
      locale,
      `Възстановяване на ${person.fullName} в екипа? Достъпът остава спрян — нужни са отблокиране и/или ново активиране.`,
      `Restore ${person.fullName} to the team? Access stays stopped — unblock and/or a new activation are still required.`,
    ),
  };
  if (!window.confirm(confirmations[action])) return;

  setLifecycleBusyId(person.employeeId);
  setBannerError(null);
  try {
    const fn =
      action === "block"
        ? blockPerson
        : action === "unblock"
          ? unblockPerson
          : action === "archive"
            ? archivePerson
            : restorePerson;
    const updated = await fn(
      person.employeeId,
      status,
      person.accessVersion ?? 0,
    );
    setDetailPerson((prev) =>
      prev?.employeeId === updated.employeeId ? updated : prev,
    );
    await reloadDirectoryWithQuery(getCommittedDirectoryQuery());
  } catch (err) {
    const stale =
      err instanceof ApiRequestError && err.code === "stale_state";
    setBannerError(
      stale
        ? t(
            locale,
            "Състоянието е променено от друг потребител. Списъкът е обновен — прегледайте и опитайте отново.",
            "Status was changed by someone else. The list was refreshed — review and try again.",
          )
        : err instanceof Error
          ? err.message
          : t(locale, "Неуспешна операция", "Operation failed"),
    );
    await reloadDirectoryWithQuery(getCommittedDirectoryQuery());
  } finally {
    setLifecycleBusyId(null);
  }
}
