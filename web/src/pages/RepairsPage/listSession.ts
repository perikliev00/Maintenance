/**
 * Thin Repairs-board adapter over the shared ticket paged-list session.
 * Same contracts as LocationRepairsPanel (page size 50, clear-on-reload).
 * LiveBoard attention pagination stays separate (see FE-12).
 */
export {
  // Support the surrounding logic for this step.
  EMPTY_REPAIRS_LIST_STATE as EMPTY_REPAIRS_BOARD_LIST_STATE,
  // Support the surrounding logic for this step.
  REPAIRS_PAGE_SIZE,
  // Support the surrounding logic for this step.
  createRepairsListSession as createRepairsBoardListSession,
  // Support the surrounding logic for this step.
  runFullReload as runRepairsBoardFullReload,
  // Support the surrounding logic for this step.
  runLoadMore as runRepairsBoardLoadMore,
  // Declare type alias FetchTicketsPage.
  type FetchTicketsPage,
  // Declare type alias RepairsListSession.
  type RepairsListSession as RepairsBoardListSession,
  // Declare type alias RepairsListViewState.
  type RepairsListViewState as RepairsBoardListViewState,
  // Declare type alias TicketListPage.
  type TicketListPage,
// Support the surrounding logic for this step.
} from "../locations/repairsPanelState";
