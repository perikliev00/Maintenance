/**
 * Repairs report form: room/issue-option catalog, catalog defaults, and the
 * submit lifecycle (double-submit guard, offline queue, draft preservation).
 * The ticket list stays with the paged `listSession`; `submit` only reports
 * what the page should do to it via `RepairReportResult`.
 */
import { FormEvent, useCallback, useRef, useState } from "react";
import {
  fetchIssueOptions,
  fetchMaintenanceCategories,
  fetchRooms,
  type AuthUser,
  type IssueOptionRow,
  type MaintenanceCategoryRow,
  type MaintenanceTicket,
  type Room,
} from "../../api/client";
import { reportTicketQueued } from "../../offline/mutations";
import { t } from "./helpers";

/** Outcome of one submit attempt; the page applies list effects from it. */
export type RepairReportResult =
  /** Missing selection or another submit is already running. */
  | { status: "skipped" }
  /** Saved locally for sync; prepend `ticket` to the visible list. */
  | { status: "queued"; ticket: MaintenanceTicket }
  /** Sent online; the page should refresh the list in the background. */
  | { status: "submitted" }
  /** Failed; the error banner is already set and the draft is preserved. */
  | { status: "failed" };

type Options = {
  user: Pick<AuthUser, "employeeId" | "fullName">;
  locale: "bg" | "en";
  setError: (value: string | null) => void;
  setMessage: (value: string | null) => void;
};

/** Optimistic list row for a report that was queued offline. */
function buildQueuedTicket(args: {
  user: Options["user"];
  room: Room | undefined;
  locationId: string;
  title: string;
  description: string;
  priority: string;
  blocksRoom: boolean;
}): MaintenanceTicket {
  const { user, room, locationId, title, description, priority, blocksRoom } = args;
  return {
    id: `local-${crypto.randomUUID()}`,
    title: title.trim() || "Queued report",
    description: description.trim() || null,
    category: "queued",
    priority,
    blocksRoom,
    status: "new",
    openedAt: new Date().toISOString(),
    resolvedAt: null,
    resolutionNotes: null,
    location: {
      id: locationId,
      number: room?.number ?? "?",
      floor: {
        number: room?.floor ?? 0,
        building: {
          code: room?.buildingCode ?? "?",
          name: room?.building ?? room?.buildingCode ?? "?",
        },
      },
    },
    reportedBy: {
      id: user.employeeId,
      fullName: user.fullName,
      employeeNumber: "",
    },
    assignee: null,
    resolvedBy: null,
    slaBreached: false,
  };
}

/**
 * Owns report-form state, catalog seeding, and submission for RepairsPage.
 */
export function useRepairReportForm({
  user,
  locale,
  setError,
  setMessage,
}: Options) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [categories, setCategories] = useState<MaintenanceCategoryRow[]>([]);
  const [options, setOptions] = useState<IssueOptionRow[]>([]);
  const [locationId, setLocationId] = useState("");
  const [issueOptionId, setIssueOptionId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [blocksRoom, setBlocksRoom] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const reportInFlight = useRef(false);
  // Refs let a late catalog response see selections made while it was loading.
  const locationRef = useRef(locationId);
  const optionRef = useRef(issueOptionId);
  locationRef.current = locationId;
  optionRef.current = issueOptionId;

  /** Seed report-form catalogs and defaults (never overwrites a selection). */
  const loadCatalog = useCallback(async () => {
    const [roomData, catData, optData] = await Promise.all([
      fetchRooms(),
      fetchMaintenanceCategories(),
      fetchIssueOptions(),
    ]);
    setRooms(roomData);
    setCategories(catData);
    setOptions(optData);
    if (!locationRef.current && roomData[0]) {
      locationRef.current = roomData[0].id;
      setLocationId(roomData[0].id);
    }
    if (!optionRef.current && optData[0]) {
      optionRef.current = optData[0].id;
      setIssueOptionId(optData[0].id);
      setTitle(locale === "en" ? optData[0].nameEn : optData[0].nameBg);
      if (optData[0].defaultPriority) setPriority(optData[0].defaultPriority);
      if (optData[0].defaultBlocksRoom != null) {
        setBlocksRoom(optData[0].defaultBlocksRoom);
      }
    }
  }, [locale]);

  /** Apply catalog title and defaults for the chosen issue option. */
  function selectIssueOption(optionId: string) {
    const opt = options.find((o) => o.id === optionId);
    setIssueOptionId(optionId);
    if (opt) {
      setTitle(locale === "en" ? opt.nameEn : opt.nameBg);
      if (opt.defaultPriority) setPriority(opt.defaultPriority);
      // Catalog default wins; otherwise leave room unblocked.
      setBlocksRoom(opt.defaultBlocksRoom ?? false);
    }
  }

  /** Submit once at a time; only a successful send clears the description. */
  async function submit(e: FormEvent): Promise<RepairReportResult> {
    e.preventDefault();
    if (!locationId || !issueOptionId || reportInFlight.current) {
      return { status: "skipped" };
    }
    reportInFlight.current = true;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const room = rooms.find((r) => r.id === locationId);
      const result = await reportTicketQueued({
        locationId,
        issueOptionId,
        // Keep catalog title from option; clarification goes in description.
        description: description.trim() || undefined,
        priority,
        blocksRoom,
      });
      setDescription("");
      if (result.queued) {
        setMessage(
          t(locale, "Докладът е в опашката", "Report queued for sync"),
        );
        return {
          status: "queued",
          ticket: buildQueuedTicket({
            user,
            room,
            locationId,
            title,
            description,
            priority,
            blocksRoom,
          }),
        };
      }
      setMessage(t(locale, "Тикетът е докладван", "Ticket reported"));
      return { status: "submitted" };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report failed");
      return { status: "failed" };
    } finally {
      setSubmitting(false);
      reportInFlight.current = false;
    }
  }

  return {
    rooms,
    categories,
    options,
    locationId,
    setLocationId,
    issueOptionId,
    title,
    description,
    setDescription,
    priority,
    setPriority,
    blocksRoom,
    setBlocksRoom,
    submitting,
    loadCatalog,
    selectIssueOption,
    submit,
  };
}
