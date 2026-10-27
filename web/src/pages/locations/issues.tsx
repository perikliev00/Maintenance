/**
 * Issue report dialog host and issues cell for the Locations board.
 * Uses catalog/default priority (never hardcoded high) and offline-capable report.
 */
import {
  type IssueOptionRow,
  type MaintenanceCategoryRow,
  type Room,
} from "../../api/client";
import { TicketLifecycleActions } from "../../components/TicketLifecycleActions";
import { LocationIssueDialog } from "../../components/LocationIssueDialog";
import { parseDuplicateReportError } from "../../api/duplicateReport";
import { reportTicketQueued } from "../../offline";

type Priority = "low" | "normal" | "high" | "urgent";

function asPriority(value: string | null | undefined): Priority {
  if (
    value === "low" ||
    value === "normal" ||
    value === "high" ||
    value === "urgent"
  ) {
    return value;
  }
  return "normal";
}

type IssueDialogHostProps = {
  issueLocationId: string;
  unitLabel: string;
  pickMode: "option" | "custom";
  optionId: string;
  categoryId: string;
  title: string;
  blocksRoom: boolean;
  priority: Priority;
  options: IssueOptionRow[];
  categories: MaintenanceCategoryRow[];
  onPickModeChange: (mode: "option" | "custom") => void;
  onOptionIdChange: (id: string, opt?: IssueOptionRow) => void;
  onCategoryIdChange: (id: string) => void;
  onTitleChange: (title: string) => void;
  onBlocksRoomChange: (blocks: boolean) => void;
  onPriorityChange: (priority: Priority) => void;
  onCancel: () => void;
  runAction: (locationId: string, action: () => Promise<void>) => Promise<void>;
  setMessage: (message: string | null) => void;
  setError: (error: string | null) => void;
  setIssueLocationId: (id: string | null) => void;
  setIssueTitle: (title: string) => void;
};

export function IssueDialogHost({
  issueLocationId,
  unitLabel,
  pickMode,
  optionId,
  categoryId,
  title,
  blocksRoom,
  priority,
  options,
  categories,
  onPickModeChange,
  onOptionIdChange,
  onCategoryIdChange,
  onTitleChange,
  onBlocksRoomChange,
  onPriorityChange,
  onCancel,
  runAction,
  setMessage,
  setError,
  setIssueLocationId,
  setIssueTitle,
}: IssueDialogHostProps) {
  return (
    <LocationIssueDialog
      unitLabel={unitLabel}
      pickMode={pickMode}
      optionId={optionId}
      categoryId={categoryId}
      title={title}
      blocksRoom={blocksRoom}
      priority={priority}
      options={options}
      categories={categories}
      onPickModeChange={onPickModeChange}
      onOptionIdChange={onOptionIdChange}
      onCategoryIdChange={onCategoryIdChange}
      onTitleChange={onTitleChange}
      onBlocksRoomChange={onBlocksRoomChange}
      onPriorityChange={onPriorityChange}
      onCancel={onCancel}
      onSubmit={() => {
        const locationId = issueLocationId;
        runAction(locationId, async () => {
          const payload =
            pickMode === "option" && optionId
              ? {
                  locationId,
                  issueOptionId: optionId,
                  title: title.trim() || undefined,
                  blocksRoom,
                  priority,
                }
              : {
                  locationId,
                  title: title.trim(),
                  categoryId,
                  blocksRoom,
                  priority,
                };

          try {
            await reportTicketQueued(payload);
          } catch (err) {
            const dup = parseDuplicateReportError(err);
            if (dup?.code === "duplicate_active" || dup?.code === "probable_duplicate") {
              const ok = window.confirm(
                dup.code === "duplicate_active"
                  ? "An active duplicate ticket exists. Report anyway as duplicate override?"
                  : "A similar ticket may already exist. Confirm and continue?",
              );
              if (!ok) throw err;
              await reportTicketQueued({
                ...payload,
                ...(dup.code === "duplicate_active"
                  ? {
                      allowDuplicate: true,
                      duplicateOverrideReason: "Confirmed from Rooms board",
                    }
                  : { confirmSimilar: true }),
              });
            } else {
              throw err;
            }
          }
          setMessage("Issue reported");
          setIssueLocationId(null);
          setIssueTitle("");
        }).catch((err) => {
          setError(err instanceof Error ? err.message : "Report failed");
        });
      }}
    />
  );
}

type IssuesCellProps = {
  location: Room;
  busy: boolean;
  canResolve: boolean;
  locale: "bg" | "en";
  setBusyId: (id: string | null) => void;
  setMessage: (message: string | null) => void;
  setError: (error: string | null) => void;
  refresh: () => Promise<void>;
  onOpenRepairs?: (locationId: string) => void;
};

export function IssuesCell({
  location,
  busy,
  canResolve,
  locale,
  setBusyId,
  setMessage,
  setError,
  refresh,
  onOpenRepairs,
}: IssuesCellProps) {
  const blocking =
    location.blockingIssueCount ?? location.blockingIssues.length;
  const nonBlocking = location.nonBlockingIssueCount ?? 0;

  return (
    <td>
      <div className="issue-summary">
        <span>
          {blocking}{" "}
          {locale === "en" ? "blocking" : "блокиращи"}
          {" · "}
          {nonBlocking}{" "}
          {locale === "en" ? "other" : "други"}
        </span>
        {onOpenRepairs && (blocking > 0 || nonBlocking > 0) && (
          <button
            type="button"
            className="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onOpenRepairs(location.id);
            }}
          >
            {locale === "en" ? "View all" : "Виж всички"}
          </button>
        )}
      </div>
      {location.blockingIssues.length === 0 ? (
        blocking === 0 && nonBlocking === 0 ? (
          <span className="muted">—</span>
        ) : null
      ) : (
        <>
          {location.blockingIssues.map((issue) => (
            <div
              key={issue.id}
              className="issue-row"
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                {issue.title} · {issue.status}
              </div>
              <TicketLifecycleActions
                ticket={issue}
                busy={busy}
                canResolve={canResolve}
                onBusy={(id) => {
                  if (id) setBusyId(location.id);
                  else setBusyId(null);
                }}
                onDone={(result) => {
                  setMessage(result.message);
                  void refresh();
                }}
                onError={(msg) => setError(msg)}
              />
            </div>
          ))}
          {blocking > location.blockingIssues.length && (
            <div className="muted">
              +{blocking - location.blockingIssues.length}{" "}
              {locale === "en" ? "more" : "още"}
            </div>
          )}
        </>
      )}
    </td>
  );
}

type ReportIssueButtonProps = {
  busy: boolean;
  locationId: string;
  label: string;
  setIssueLocationId: (id: string | null) => void;
  setIssueTitle: (title: string) => void;
  setIssueBlocks: (blocks: boolean) => void;
};

export function ReportIssueButton({
  busy,
  locationId,
  label,
  setIssueLocationId,
  setIssueTitle,
  setIssueBlocks,
}: ReportIssueButtonProps) {
  return (
    <button
      type="button"
      className="ghost"
      disabled={busy}
      onClick={() => {
        setIssueLocationId(locationId);
        setIssueTitle("");
        setIssueBlocks(false);
      }}
    >
      {label}
    </button>
  );
}

export { asPriority };
export type { Priority };
