-- Per-role optimistic concurrency for permission matrix replaces.
CREATE TABLE "RoleGrantRevision" (
    "role" "Role" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleGrantRevision_pkey" PRIMARY KEY ("role")
);

-- Seed a revision row for every non-owner matrix role (and any stray roles that already have grants).
INSERT INTO "RoleGrantRevision" ("role", "version", "updatedAt")
SELECT r.role, 1, CURRENT_TIMESTAMP
FROM (
  SELECT unnest(ARRAY[
    'housekeeper'::"Role",
    'technician'::"Role",
    'reception'::"Role",
    'supervisor'::"Role",
    'manager'::"Role",
    'admin'::"Role"
  ]) AS role
  UNION
  SELECT DISTINCT "role" FROM "RoleGrant" WHERE "role" <> 'owner'::"Role"
) AS r
ON CONFLICT ("role") DO NOTHING;
