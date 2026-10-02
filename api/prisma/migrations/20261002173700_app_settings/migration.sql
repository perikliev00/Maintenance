-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByEmployeeId" TEXT,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SettingChange" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "actorEmployeeId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettingChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettingChange_createdAt_idx" ON "SettingChange"("createdAt");

-- CreateIndex
CREATE INDEX "SettingChange_key_createdAt_idx" ON "SettingChange"("key", "createdAt");

-- AddForeignKey
ALTER TABLE "SettingChange" ADD CONSTRAINT "SettingChange_actorEmployeeId_fkey" FOREIGN KEY ("actorEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
