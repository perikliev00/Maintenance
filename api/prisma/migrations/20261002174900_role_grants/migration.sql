-- CreateEnum
CREATE TYPE "GrantKind" AS ENUM ('panel', 'action');

-- CreateTable
CREATE TABLE "RoleGrant" (
    "role" "Role" NOT NULL,
    "kind" "GrantKind" NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleGrant_pkey" PRIMARY KEY ("role","kind","key")
);

-- CreateTable
CREATE TABLE "PermissionChange" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "kind" "GrantKind" NOT NULL,
    "key" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "actorEmployeeId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleGrant_role_kind_idx" ON "RoleGrant"("role", "kind");

-- CreateIndex
CREATE INDEX "PermissionChange_createdAt_idx" ON "PermissionChange"("createdAt");

-- CreateIndex
CREATE INDEX "PermissionChange_role_createdAt_idx" ON "PermissionChange"("role", "createdAt");

-- AddForeignKey
ALTER TABLE "PermissionChange" ADD CONSTRAINT "PermissionChange_actorEmployeeId_fkey" FOREIGN KEY ("actorEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
