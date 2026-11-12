/**
 * Thin Repairs-board adapter over the shared ticket paged-list session.
 * Same contracts as LocationRepairsPanel (page size 50, clear-on-reload).
 * LiveBoard attention pagination stays separate (see FE-12).
 */
export {
  EMPTY_REPAIRS_LIST_STATE as EMPTY_REPAIRS_BOARD_LIST_STATE,
  REPAIRS_PAGE_SIZE,
  createRepairsListSession as createRepairsBoardListSession,
  runFullReload as runRepairsBoardFullReload,
  runLoadMore as runRepairsBoardLoadMore,
  type FetchTicketsPage,
  type RepairsListSession as RepairsBoardListSession,
  type RepairsListViewState as RepairsBoardListViewState,
  type TicketListPage,
} from "../locations/repairsPanelState";
