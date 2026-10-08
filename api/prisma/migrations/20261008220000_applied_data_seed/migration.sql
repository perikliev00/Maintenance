-- Ledger for one-shot catalog / data seeds. Once a seed id is recorded,
-- applyCatalogGrantSeed must not re-insert its deltas.
CREATE TABLE "AppliedDataSeed" (
    "id" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppliedDataSeed_pkey" PRIMARY KEY ("id")
);

-- Backfill: sectors.transfer_cross was previously seeded on every boot via
-- unbounded seedCatalogGrantDeltas. Mark v1 applied without touching RoleGrant
-- so administratively revoked grants are not restored on the first boot after
-- this migration.
INSERT INTO "AppliedDataSeed" ("id", "appliedAt")
VALUES ('grants.sectors.transfer_cross.v1', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
