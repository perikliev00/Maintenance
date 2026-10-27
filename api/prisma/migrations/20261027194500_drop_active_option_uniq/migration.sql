-- allowDuplicate intentionally creates a second active option ticket after an
-- audited override. The partial unique index blocked that path at the DB layer
-- while app-level advisory locks + detectDuplicates remain the concurrency
-- control (see create.ts / duplicateDetection).

DROP INDEX IF EXISTS "MaintenanceTicket_active_option_uniq";
