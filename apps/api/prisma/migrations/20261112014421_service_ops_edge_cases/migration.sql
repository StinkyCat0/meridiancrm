-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Estimate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "contactId" TEXT,
    "ownerId" TEXT,
    "jobId" TEXT,
    "issuedAt" DATETIME,
    "expiresAt" DATETIME,
    "taxRate" INTEGER NOT NULL DEFAULT 0,
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Estimate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Estimate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Estimate_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Estimate_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Estimate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Estimate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Estimate" ("contactId", "createdAt", "customerId", "expiresAt", "id", "issuedAt", "jobId", "locationId", "notes", "number", "ownerId", "status", "subtotal", "tax", "taxRate", "title", "total", "updatedAt", "workspaceId") SELECT "contactId", "createdAt", "customerId", "expiresAt", "id", "issuedAt", "jobId", "locationId", "notes", "number", "ownerId", "status", "subtotal", "tax", "taxRate", "title", "total", "updatedAt", "workspaceId" FROM "Estimate";
DROP TABLE "Estimate";
ALTER TABLE "new_Estimate" RENAME TO "Estimate";
CREATE INDEX "Estimate_workspaceId_status_idx" ON "Estimate"("workspaceId", "status");
CREATE INDEX "Estimate_workspaceId_status_createdAt_idx" ON "Estimate"("workspaceId", "status", "createdAt");
CREATE INDEX "Estimate_workspaceId_customerId_idx" ON "Estimate"("workspaceId", "customerId");
CREATE INDEX "Estimate_workspaceId_jobId_idx" ON "Estimate"("workspaceId", "jobId");
CREATE INDEX "Estimate_workspaceId_createdAt_idx" ON "Estimate"("workspaceId", "createdAt");
CREATE INDEX "Estimate_workspaceId_updatedAt_idx" ON "Estimate"("workspaceId", "updatedAt");
CREATE INDEX "Estimate_workspaceId_expiresAt_idx" ON "Estimate"("workspaceId", "expiresAt");
CREATE UNIQUE INDEX "Estimate_workspaceId_number_key" ON "Estimate"("workspaceId", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Job_workspaceId_locationId_idx" ON "Job"("workspaceId", "locationId");

-- CreateIndex
CREATE INDEX "Location_workspaceId_updatedAt_idx" ON "Location"("workspaceId", "updatedAt");
