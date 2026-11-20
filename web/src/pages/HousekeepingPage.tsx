/**
 * Housekeeping admin: location catalog, sectors, and shifts/roster.
 * Tabs/actions gated by rooms.manage / sectors.manage / shifts.manage.
 * Sector create is hotel-wide only; supervisors may edit owned sectors.
 * Saves use a single atomic PATCH (metadata + membership + version).
 */
import { useCallback, useEffect, useState } from "react";
import {
  canPerformAction,
  fetchPeople,
  fetchSectors,
  fetchShifts,
  type AuthUser,
  type Person,
  type SectorRow,
  type ShiftRow,
} from "../api/client";
import { LoadingIndicator } from "../components/LoadingIndicator";
import { LocationCatalogPanel } from "../components/LocationCatalogPanel";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { SectorAdminTab } from "./housekeeping/SectorAdminTab";
import { ShiftAdminTab } from "./housekeeping/ShiftAdminTab";
import { useHousekeepingBusy } from "./housekeeping/useHousekeepingBusy";
import { useSectorEditor } from "./housekeeping/useSectorEditor";
import { useShiftEditor } from "./housekeeping/useShiftEditor";
import {
  canCreateSector,
  catalogChangedEvent,
  mergeIndependentLoadErrors,
} from "./housekeepingLogic";
import { labelFor } from "../i18n";
import { Workspace, WorkspaceIntro } from "../ui";

type Props = { user: AuthUser };

type Tab = "catalog" | "sectors" | "shifts";

const TABS: Array<{ id: Tab; bg: string; en: string }> = [
  { id: "catalog", bg: "Каталог", en: "Catalog" },
  { id: "sectors", bg: "Сектори", en: "Sectors" },
  { id: "shifts", bg: "Смени", en: "Shifts" },
];

export function HousekeepingPage({ user }: Props) {
  const [tab, setTab] = useState<Tab>("sectors");
  const [locale] = useState<"bg" | "en">("bg");
  const label = labelFor(locale);

  const canManageSectors = canPerformAction(user, "sectors.manage");
  const canManageShifts = canPerformAction(user, "shifts.manage");
  const canManageLocations = canPerformAction(user, "rooms.manage");
  const isSupervisorScope = user.role === "supervisor";
  /** Supervisors with manage may edit, but must not create sectors. */
  const canCreateSectors = canCreateSector(user.role, canManageSectors);
  const lockedSupervisorId = isSupervisorScope ? user.employeeId : null;

  const { busy, busyRef, runMutationWithRefresh } = useHousekeepingBusy();

  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [supervisors, setSupervisors] = useState<Person[]>([]);
  const [housekeepers, setHousekeepers] = useState<Person[]>([]);
  const [sectorsLoading, setSectorsLoading] = useState(true);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [sectorsError, setSectorsError] = useState<string | null>(null);
  const [shiftsError, setShiftsError] = useState<string | null>(null);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshSectors = useCallback(async () => {
    if (!canManageSectors) {
      setSectors([]);
      return;
    }
    const sec = await fetchSectors(true);
    setSectors(sec);
  }, [canManageSectors]);

  const refreshShifts = useCallback(async () => {
    if (!canManageShifts) {
      setShifts([]);
      return;
    }
    const sh = await fetchShifts(true);
    setShifts(sh);
  }, [canManageShifts]);

  const refreshPeople = useCallback(async () => {
    const people = await fetchPeople({ includeInactive: false });
    setSupervisors(
      people.filter(
        (p) =>
          p.role === "supervisor" ||
          p.role === "manager" ||
          p.role === "admin" ||
          p.role === "owner",
      ),
    );
    setHousekeepers(people.filter((p) => p.role === "housekeeper"));
  }, []);

  const sectorEditor = useSectorEditor({
    canManageSectors,
    canCreateSectors,
    lockedSupervisorId,
    refreshSectors,
    setSectorsError,
    setMessage,
    label,
    busyRef,
    runMutationWithRefresh,
  });

  const shiftEditor = useShiftEditor({
    tab,
    canManageShifts,
    refreshShifts,
    setShiftsError,
    setMessage,
    label,
    busyRef,
    runMutationWithRefresh,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSectorsLoading(true);
      setSectorsError(null);
      try {
        await refreshSectors();
      } catch (err) {
        if (!cancelled) {
          setSectorsError(
            err instanceof Error ? err.message : "Failed to load sectors",
          );
        }
      } finally {
        if (!cancelled) setSectorsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSectors]);

  useEffect(() => {
    if (tab !== "shifts") return;
    let cancelled = false;
    (async () => {
      setShiftsLoading(true);
      setShiftsError(null);
      try {
        await refreshShifts();
      } catch (err) {
        if (!cancelled) {
          setShiftsError(
            err instanceof Error ? err.message : "Failed to load shifts",
          );
        }
      } finally {
        if (!cancelled) setShiftsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, refreshShifts]);

  useEffect(() => {
    if (tab !== "sectors" && tab !== "shifts") return;
    let cancelled = false;
    (async () => {
      setPeopleLoading(true);
      setPeopleError(null);
      try {
        await refreshPeople();
      } catch (err) {
        if (!cancelled) {
          setPeopleError(
            err instanceof Error ? err.message : "Failed to load people",
          );
        }
      } finally {
        if (!cancelled) setPeopleLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, refreshPeople]);

  const liveRefresh = useCallback(async () => {
    const tasks: Promise<void>[] = [];
    if (canManageSectors) {
      tasks.push(
        refreshSectors().catch((err) => {
          setSectorsError(
            err instanceof Error ? err.message : "Failed to load sectors",
          );
        }),
      );
    }
    if (canManageShifts && tab === "shifts") {
      tasks.push(
        refreshShifts().catch((err) => {
          setShiftsError(
            err instanceof Error ? err.message : "Failed to load shifts",
          );
        }),
      );
    }
    if (tab === "sectors" || tab === "shifts") {
      tasks.push(
        refreshPeople().catch((err) => {
          setPeopleError(
            err instanceof Error ? err.message : "Failed to load people",
          );
        }),
      );
    }
    await Promise.all(tasks);
  }, [
    canManageSectors,
    canManageShifts,
    tab,
    refreshSectors,
    refreshShifts,
    refreshPeople,
  ]);

  useLiveRefresh(liveRefresh, {
    enabled: !sectorsLoading && !shiftsLoading && !peopleLoading,
    busy,
    eventTypes: ["people.changed", "settings.changed", "location.changed"],
  });

  const pageError =
    tab === "sectors"
      ? mergeIndependentLoadErrors({
          sectors: sectorsError,
          people: peopleError,
        })
      : tab === "shifts"
        ? mergeIndependentLoadErrors({
            shifts: shiftsError,
            people: peopleError,
          })
        : null;

  return (
    <Workspace className="ui-housekeeping-workspace">
      <WorkspaceIntro eyebrow={label("РАЗПРЕДЕЛЕНИЕ НА РАБОТАТА", "WORKFORCE PLANNING")} title={label("Почистване", "Housekeeping")} description={label("Определете покритието по сектори и подгответе хората за всяка смяна.", "Define sector coverage and prepare the team for each shift.")} />
      <div className="ui-section-layout">
      <nav className="ui-section-nav" aria-label={label("Организация на почистването", "Housekeeping organisation")}>
        {TABS.filter((t) => t.id !== "catalog" || canManageLocations).map(
          (t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? "page" : undefined}
              className={tab === t.id ? "active" : ""}
              disabled={busy}
              onClick={() => {
                if (busyRef.current) return;
                setTab(t.id);
                setMessage(null);
              }}
            >
              {label(t.bg, t.en)}
            </button>
          ),
        )}
        <div className="ui-context-note"><strong>{label("Работен обхват", "Working scope")}</strong><p>{isSupervisorScope ? label("Управлявате секторите във вашия обхват.", "You manage sectors within your assigned scope.") : label("Управлявате организацията на имота.", "You manage the property's workforce organisation.")}</p></div>
      </nav>
      <div className="ui-section-content">
      <div className="ui-section-heading"><h2>{label(TABS.find((item) => item.id === tab)!.bg, TABS.find((item) => item.id === tab)!.en)}</h2><p className="muted">{tab === "sectors" ? label("Локации, отговорници и покритие", "Locations, ownership and coverage") : tab === "shifts" ? label("Работни смени и дневен график", "Shift definitions and daily roster") : label("Каталог на стаи и общи части", "Room and common-area inventory")}</p></div>

      {pageError && (
        <p className="error-banner">
          {pageError}{" "}
          <button
            type="button"
            className="ghost"
            onClick={() => {
              if (tab === "sectors") {
                setSectorsError(null);
                setPeopleError(null);
                void refreshSectors().catch((err) =>
                  setSectorsError(
                    err instanceof Error ? err.message : "Failed to load",
                  ),
                );
                void refreshPeople().catch((err) =>
                  setPeopleError(
                    err instanceof Error ? err.message : "Failed to load",
                  ),
                );
              }
              if (tab === "shifts") {
                setShiftsError(null);
                setPeopleError(null);
                void refreshShifts().catch((err) =>
                  setShiftsError(
                    err instanceof Error ? err.message : "Failed to load",
                  ),
                );
                void refreshPeople().catch((err) =>
                  setPeopleError(
                    err instanceof Error ? err.message : "Failed to load",
                  ),
                );
              }
            }}
          >
            {label("Презареди", "Reload")}
          </button>
        </p>
      )}
      {message && <p className="ok-banner">{message}</p>}
      {peopleLoading && tab === "sectors" && (
        <LoadingIndicator
          className="muted small"
          variant="inline"
          label={label("Зареждане на служители…", "Loading people…")}
        />
      )}

      {tab === "catalog" && canManageLocations && (
        <LocationCatalogPanel
          locale={locale}
          onCatalogChanged={() => {
            window.dispatchEvent(catalogChangedEvent());
          }}
        />
      )}

      {tab === "sectors" && (
        <SectorAdminTab
          label={label}
          locale={locale}
          sectorsLoading={sectorsLoading}
          sectors={sectors}
          supervisors={supervisors}
          canManageSectors={canManageSectors}
          canCreateSectors={canCreateSectors}
          isSupervisorScope={isSupervisorScope}
          busy={busy}
          editor={sectorEditor}
        />
      )}

      {tab === "shifts" && (
        <ShiftAdminTab
          label={label}
          locale={locale}
          shiftsLoading={shiftsLoading}
          shifts={shifts}
          housekeepers={housekeepers}
          canManageShifts={canManageShifts}
          busy={busy}
          editor={shiftEditor}
        />
      )}
      </div>
      </div>
    </Workspace>
  );
}
