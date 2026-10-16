/**
 * Issue report dialog host and blocking-issues cell for the Locations board.
 * Ticket lifecycle uses offline-aware queued actions; report submit always
 * posts with priority "high".
 */
import {
  reportIssue,
  type IssueOptionRow,
  type MaintenanceCategoryRow,
  type Room,
} from "../../api/client";
import { TicketLifecycleActions } from "../../components/TicketLifecycleActions";
import { LocationIssueDialog } from "../../components/LocationIssueDialog";

type IssueDialogHostProps = {
  issueLocationId: string;
  unitLabel: string;
  pickMode: "option" | "custom";
  optionId: string;
  categoryId: string;
  title: string;
  blocksRoom: boolean;
  options: IssueOptionRow[];
  categories: MaintenanceCategoryRow[];
  onPickModeChange: (mode: "option" | "custom") => void;
  onOptionIdChange: (id: string, opt?: IssueOptionRow) => void;
  onCategoryIdChange: (id: string) => void;
  onTitleChange: (title: string) => void;
  onBlocksRoomChange: (blocks: boolean) => void;
  onCancel: () => void;
  runAction: (locationId: string, action: () => Promise<void>) => Promise<void>;
  setMessage: (message: string | null) => void;
  setIssueLocationId: (id: string | null) => void;
  setIssueTitle: (title: string) => void;
};

/**
 * Host that wires LocationsPage issue-dialog state into LocationIssueDialog
 * and posts reports via `runAction` (always priority "high").
 */
export function IssueDialogHost({
  issueLocationId,
  unitLabel,
  pickMode,
  optionId,
  categoryId,
  title,
  blocksRoom,
  options,
  categories,
  onPickModeChange,
  onOptionIdChange,
  onCategoryIdChange,
  onTitleChange,
  onBlocksRoomChange,
  onCancel,
  runAction,
  setMessage,
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
      options={options}
      categories={categories}
      onPickModeChange={onPickModeChange}
      onOptionIdChange={onOptionIdChange}
      onCategoryIdChange={onCategoryIdChange}
      onTitleChange={onTitleChange}
      onBlocksRoomChange={onBlocksRoomChange}
      onCancel={onCancel}
      onSubmit={() => {
        const locationId = issueLocationId;
        // Wrap in runAction so the row shows busy + surfaces errors.
        runAction(locationId, async () => {
          // Catalog option path vs free-text + category path.
          if (pickMode === "option" && optionId) {
            await reportIssue({
              locationId,
              issueOptionId: optionId,
              title: title.trim() || undefined,
              blocksRoom,
              priority: "high",
            });
          } else {
            await reportIssue({
              locationId,
              title: title.trim(),
              categoryId,
              blocksRoom,
              priority: "high",
            });
          }
          setMessage("Issue reported");
          // Close dialog and clear title for the next report.
          setIssueLocationId(null);
          setIssueTitle("");
        });
      }}
    />
  );
}

type IssuesCellProps = {
  location: Room;
  busy: boolean;
  canResolve: boolean;
  setBusyId: (id: string | null) => void;
  setMessage: (message: string | null) => void;
  setError: (error: string | null) => void;
  refresh: () => Promise<void>;
};

/**
 * Table cell listing blocking issues with inline lifecycle actions.
 * Clicks stopPropagation so opening the row detail panel is not triggered.
 */
export function IssuesCell({
  location,
  busy,
  canResolve,
  setBusyId,
  setMessage,
  setError,
  refresh,
}: IssuesCellProps) {
  return (
    <td>
      {location.blockingIssues.length === 0 ? (
        <span className="muted">—</span>
      ) : (
        location.blockingIssues.map((issue) => (
          <div
            key={issue.id}
            className="issue-row"
            // Prevent row-click from opening the location detail panel.
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
                // Map ticket busy onto the location row busyId.
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
        ))
      )}
    </td>
  );
}

type ReportIssueButtonProps = {
  busy: boolean;
  locationId: string;
  setIssueLocationId: (id: string | null) => void;
  setIssueTitle: (title: string) => void;
  setIssueBlocks: (blocks: boolean) => void;
};

/**
 * Opens the issue dialog for a location, defaulting blocksRoom to true.
 */
export function ReportIssueButton({
  busy,
  locationId,
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
        // Seed dialog state: clear title, default to blocking.
        setIssueLocationId(locationId);
        setIssueTitle("");
        setIssueBlocks(true);
      }}
    >
      Report issue
    </button>
  );
}
