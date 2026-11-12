/**
 * Repairs report form: room/issue-option catalog, catalog defaults, and the
 * submit lifecycle (double-submit guard, offline queue, draft preservation).
 * The ticket list stays with the paged `listSession`; `submit` only reports
 * what the page should do to it via `RepairReportResult`.
 */
import { FormEvent, useCallback, useRef, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  fetchIssueOptions,
  // Support the surrounding logic for this step.
  fetchMaintenanceCategories,
  // Support the surrounding logic for this step.
  fetchRooms,
  // Declare type alias AuthUser.
  type AuthUser,
  // Declare type alias IssueOptionRow.
  type IssueOptionRow,
  // Declare type alias MaintenanceCategoryRow.
  type MaintenanceCategoryRow,
  // Declare type alias MaintenanceTicket.
  type MaintenanceTicket,
  // Declare type alias Room.
  type Room,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ../../offline/mutations.
import { reportTicketQueued } from "../../offline/mutations";
// Import module dependency from ./helpers.
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

// Declare type alias Options.
type Options = {
  // Provide user field used by this structure.
  user: Pick<AuthUser, "employeeId" | "fullName">;
  // Provide locale field used by this structure.
  locale: "bg" | "en";
  // Provide setError field used by this structure.
  setError: (value: string | null) => void;
  // Provide setMessage field used by this structure.
  setMessage: (value: string | null) => void;
};

/** Optimistic list row for a report that was queued offline. */
function buildQueuedTicket(args: {
  // Provide user field used by this structure.
  user: Options["user"];
  // Provide room field used by this structure.
  room: Room | undefined;
  // Provide locationId field used by this structure.
  locationId: string;
  // Provide title field used by this structure.
  title: string;
  // Provide description field used by this structure.
  description: string;
  // Provide priority field used by this structure.
  priority: string;
  // Provide blocksRoom field used by this structure.
  blocksRoom: boolean;
// Support the surrounding logic for this step.
}): MaintenanceTicket {
  // Bind a local value for the following logic.
  const { user, room, locationId, title, description, priority, blocksRoom } = args;
  // Return early result or rendered output from this path.
  return {
    // Provide id field used by this structure.
    id: `local-${crypto.randomUUID()}`,
    // Provide title field used by this structure.
    title: title.trim() || "Queued report",
    // Provide description field used by this structure.
    description: description.trim() || null,
    // Provide category field used by this structure.
    category: "queued",
    // Support the surrounding logic for this step.
    priority,
    // Support the surrounding logic for this step.
    blocksRoom,
    // Provide status field used by this structure.
    status: "new",
    // Provide openedAt field used by this structure.
    openedAt: new Date().toISOString(),
    // Provide resolvedAt field used by this structure.
    resolvedAt: null,
    // Provide resolutionNotes field used by this structure.
    resolutionNotes: null,
    // Provide location field used by this structure.
    location: {
      // Provide id field used by this structure.
      id: locationId,
      // Provide number field used by this structure.
      number: room?.number ?? "?",
      // Provide floor field used by this structure.
      floor: {
        // Provide number field used by this structure.
        number: room?.floor ?? 0,
        // Provide building field used by this structure.
        building: {
          // Provide code field used by this structure.
          code: room?.buildingCode ?? "?",
          // Provide name field used by this structure.
          name: room?.building ?? room?.buildingCode ?? "?",
        },
      },
    },
    // Provide reportedBy field used by this structure.
    reportedBy: {
      // Provide id field used by this structure.
      id: user.employeeId,
      // Provide fullName field used by this structure.
      fullName: user.fullName,
      // Provide employeeNumber field used by this structure.
      employeeNumber: "",
    },
    // Provide assignee field used by this structure.
    assignee: null,
    // Provide resolvedBy field used by this structure.
    resolvedBy: null,
    // Provide slaBreached field used by this structure.
    slaBreached: false,
  };
}

/**
 * Owns report-form state, catalog seeding, and submission for RepairsPage.
 */
export function useRepairReportForm({
  // Support the surrounding logic for this step.
  user,
  // Support the surrounding logic for this step.
  locale,
  // Support the surrounding logic for this step.
  setError,
  // Support the surrounding logic for this step.
  setMessage,
// Support the surrounding logic for this step.
}: Options) {
  // React state slot for local UI/data that can change over time.
  const [rooms, setRooms] = useState<Room[]>([]);
  // React state slot for local UI/data that can change over time.
  const [categories, setCategories] = useState<MaintenanceCategoryRow[]>([]);
  // React state slot for local UI/data that can change over time.
  const [options, setOptions] = useState<IssueOptionRow[]>([]);
  // React state slot for local UI/data that can change over time.
  const [locationId, setLocationId] = useState("");
  // React state slot for local UI/data that can change over time.
  const [issueOptionId, setIssueOptionId] = useState("");
  // React state slot for local UI/data that can change over time.
  const [title, setTitle] = useState("");
  // React state slot for local UI/data that can change over time.
  const [description, setDescription] = useState("");
  // React state slot for local UI/data that can change over time.
  const [priority, setPriority] = useState("normal");
  // React state slot for local UI/data that can change over time.
  const [blocksRoom, setBlocksRoom] = useState(false);
  // React state slot for local UI/data that can change over time.
  const [submitting, setSubmitting] = useState(false);
  // Hold a mutable ref that persists across renders without re-render.
  const reportInFlight = useRef(false);
  // Refs let a late catalog response see selections made while it was loading.
  const locationRef = useRef(locationId);
  // Hold a mutable ref that persists across renders without re-render.
  const optionRef = useRef(issueOptionId);
  // Support the surrounding logic for this step.
  locationRef.current = locationId;
  // Support the surrounding logic for this step.
  optionRef.current = issueOptionId;

  /** Seed report-form catalogs and defaults (never overwrites a selection). */
  const loadCatalog = useCallback(async () => {
    // Bind a local value for the following logic.
    const [roomData, catData, optData] = await Promise.all([
      // Invoke fetchRooms to perform this step.
      fetchRooms(),
      // Invoke fetchMaintenanceCategories to perform this step.
      fetchMaintenanceCategories(),
      // Invoke fetchIssueOptions to perform this step.
      fetchIssueOptions(),
    // Support the surrounding logic for this step.
    ]);
    // Update React state so the UI reflects the new value.
    setRooms(roomData);
    // Update React state so the UI reflects the new value.
    setCategories(catData);
    // Update React state so the UI reflects the new value.
    setOptions(optData);
    // Conditional branch for the case described by this guard.
    if (!locationRef.current && roomData[0]) {
      // Support the surrounding logic for this step.
      locationRef.current = roomData[0].id;
      // Update React state so the UI reflects the new value.
      setLocationId(roomData[0].id);
    }
    // Conditional branch for the case described by this guard.
    if (!optionRef.current && optData[0]) {
      // Support the surrounding logic for this step.
      optionRef.current = optData[0].id;
      // Update React state so the UI reflects the new value.
      setIssueOptionId(optData[0].id);
      // Update React state so the UI reflects the new value.
      setTitle(locale === "en" ? optData[0].nameEn : optData[0].nameBg);
      // Conditional branch for the case described by this guard.
      if (optData[0].defaultPriority) setPriority(optData[0].defaultPriority);
      // Conditional branch for the case described by this guard.
      if (optData[0].defaultBlocksRoom != null) {
        // Update React state so the UI reflects the new value.
        setBlocksRoom(optData[0].defaultBlocksRoom);
      }
    }
  // Support the surrounding logic for this step.
  }, [locale]);

  /** Apply catalog title and defaults for the chosen issue option. */
  function selectIssueOption(optionId: string) {
    // Find the first matching item for this lookup.
    const opt = options.find((o) => o.id === optionId);
    // Update React state so the UI reflects the new value.
    setIssueOptionId(optionId);
    // Conditional branch for the case described by this guard.
    if (opt) {
      // Update React state so the UI reflects the new value.
      setTitle(locale === "en" ? opt.nameEn : opt.nameBg);
      // Conditional branch for the case described by this guard.
      if (opt.defaultPriority) setPriority(opt.defaultPriority);
      // Catalog default wins; otherwise leave room unblocked.
      setBlocksRoom(opt.defaultBlocksRoom ?? false);
    }
  }

  /** Submit once at a time; only a successful send clears the description. */
  async function submit(e: FormEvent): Promise<RepairReportResult> {
    // Invoke e.preventDefault to perform this step.
    e.preventDefault();
    // Conditional branch for the case described by this guard.
    if (!locationId || !issueOptionId || reportInFlight.current) {
      // Return early result or rendered output from this path.
      return { status: "skipped" };
    }
    // Support the surrounding logic for this step.
    reportInFlight.current = true;
    // Update React state so the UI reflects the new value.
    setSubmitting(true);
    // Update React state so the UI reflects the new value.
    setError(null);
    // Update React state so the UI reflects the new value.
    setMessage(null);
    // Begin guarded block to catch runtime failures.
    try {
      // Find the first matching item for this lookup.
      const room = rooms.find((r) => r.id === locationId);
      // Bind result for use in the following logic.
      const result = await reportTicketQueued({
        // Support the surrounding logic for this step.
        locationId,
        // Support the surrounding logic for this step.
        issueOptionId,
        // Keep catalog title from option; clarification goes in description.
        description: description.trim() || undefined,
        // Support the surrounding logic for this step.
        priority,
        // Support the surrounding logic for this step.
        blocksRoom,
      });
      // Update React state so the UI reflects the new value.
      setDescription("");
      // Conditional branch for the case described by this guard.
      if (result.queued) {
        // Update React state so the UI reflects the new value.
        setMessage(
          // Invoke t to perform this step.
          t(locale, "Докладът е в опашката", "Report queued for sync"),
        );
        // Return early result or rendered output from this path.
        return {
          // Provide status field used by this structure.
          status: "queued",
          // Provide ticket field used by this structure.
          ticket: buildQueuedTicket({
            // Support the surrounding logic for this step.
            user,
            // Support the surrounding logic for this step.
            room,
            // Support the surrounding logic for this step.
            locationId,
            // Support the surrounding logic for this step.
            title,
            // Support the surrounding logic for this step.
            description,
            // Support the surrounding logic for this step.
            priority,
            // Support the surrounding logic for this step.
            blocksRoom,
          }),
        };
      }
      // Update React state so the UI reflects the new value.
      setMessage(t(locale, "Тикетът е докладван", "Ticket reported"));
      // Return early result or rendered output from this path.
      return { status: "submitted" };
    // Support the surrounding logic for this step.
    } catch (err) {
      // Update React state so the UI reflects the new value.
      setError(err instanceof Error ? err.message : "Report failed");
      // Return early result or rendered output from this path.
      return { status: "failed" };
    // Support the surrounding logic for this step.
    } finally {
      // Update React state so the UI reflects the new value.
      setSubmitting(false);
      // Support the surrounding logic for this step.
      reportInFlight.current = false;
    }
  }

  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    rooms,
    // Support the surrounding logic for this step.
    categories,
    // Support the surrounding logic for this step.
    options,
    // Support the surrounding logic for this step.
    locationId,
    // Support the surrounding logic for this step.
    setLocationId,
    // Support the surrounding logic for this step.
    issueOptionId,
    // Support the surrounding logic for this step.
    title,
    // Support the surrounding logic for this step.
    description,
    // Support the surrounding logic for this step.
    setDescription,
    // Support the surrounding logic for this step.
    priority,
    // Support the surrounding logic for this step.
    setPriority,
    // Support the surrounding logic for this step.
    blocksRoom,
    // Support the surrounding logic for this step.
    setBlocksRoom,
    // Support the surrounding logic for this step.
    submitting,
    // Support the surrounding logic for this step.
    loadCatalog,
    // Support the surrounding logic for this step.
    selectIssueOption,
    // Support the surrounding logic for this step.
    submit,
  };
}
