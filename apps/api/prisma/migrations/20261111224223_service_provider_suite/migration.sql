-- AlterTable
ALTER TABLE "Job" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "Job" ADD COLUMN "rating" INTEGER;
ALTER TABLE "Job" ADD COLUMN "ratingNote" TEXT;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN "latitude" REAL;
ALTER TABLE "Location" ADD COLUMN "longitude" REAL;

-- CreateTable
CREATE TABLE "DocumentCounter" (
    "workspaceId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("workspaceId", "prefix"),
    CONSTRAINT "DocumentCounter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CARD',
    "reference" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "vendor" TEXT,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "incurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,
    "userId" TEXT,
    "receiptUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Expense_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Expense_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Communication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "intent" TEXT NOT NULL DEFAULT 'GENERAL',
    "sentiment" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "subject" TEXT,
    "body" TEXT,
    "customerId" TEXT,
    "contactId" TEXT,
    "jobId" TEXT,
    "userId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'log',
    "externalId" TEXT,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiRationale" TEXT,
    "readAt" DATETIME,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Communication_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Communication_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Communication_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Communication_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Communication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL,
    "conditions" TEXT NOT NULL DEFAULT '{}',
    "actions" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutomationRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AutomationRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JobLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "serviceId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "unitPrice" INTEGER NOT NULL,
    "unitCost" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "JobLineItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobLineItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_JobLineItem" ("id", "jobId", "name", "position", "quantity", "serviceId", "total", "unitPrice") SELECT "id", "jobId", "name", "position", "quantity", "serviceId", "total", "unitPrice" FROM "JobLineItem";
DROP TABLE "JobLineItem";
ALTER TABLE "new_JobLineItem" RENAME TO "JobLineItem";
CREATE INDEX "JobLineItem_jobId_idx" ON "JobLineItem"("jobId");
CREATE INDEX "JobLineItem_serviceId_idx" ON "JobLineItem"("serviceId");
CREATE TABLE "new_ServiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'VISIT',
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "price" INTEGER NOT NULL DEFAULT 0,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServiceItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ServiceItem" ("archived", "category", "createdAt", "description", "durationMinutes", "id", "name", "price", "taxable", "unit", "updatedAt", "workspaceId") SELECT "archived", "category", "createdAt", "description", "durationMinutes", "id", "name", "price", "taxable", "unit", "updatedAt", "workspaceId" FROM "ServiceItem";
DROP TABLE "ServiceItem";
ALTER TABLE "new_ServiceItem" RENAME TO "ServiceItem";
CREATE INDEX "ServiceItem_workspaceId_archived_idx" ON "ServiceItem"("workspaceId", "archived");
CREATE INDEX "ServiceItem_workspaceId_name_idx" ON "ServiceItem"("workspaceId", "name");
CREATE TABLE "new_Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "businessType" TEXT NOT NULL DEFAULT 'GENERAL',
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "serviceArea" TEXT,
    "depotLatitude" REAL,
    "depotLongitude" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Workspace" ("createdAt", "currency", "id", "name", "slug", "updatedAt") SELECT "createdAt", "currency", "id", "name", "slug", "updatedAt" FROM "Workspace";
DROP TABLE "Workspace";
ALTER TABLE "new_Workspace" RENAME TO "Workspace";
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Payment_workspaceId_receivedAt_idx" ON "Payment"("workspaceId", "receivedAt");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_workspaceId_invoiceId_idx" ON "Payment"("workspaceId", "invoiceId");

-- CreateIndex
CREATE INDEX "Expense_workspaceId_incurredAt_idx" ON "Expense"("workspaceId", "incurredAt");

-- CreateIndex
CREATE INDEX "Expense_workspaceId_category_idx" ON "Expense"("workspaceId", "category");

-- CreateIndex
CREATE INDEX "Expense_jobId_idx" ON "Expense"("jobId");

-- CreateIndex
CREATE INDEX "Communication_workspaceId_occurredAt_idx" ON "Communication"("workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "Communication_workspaceId_customerId_occurredAt_idx" ON "Communication"("workspaceId", "customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "Communication_workspaceId_channel_idx" ON "Communication"("workspaceId", "channel");

-- CreateIndex
CREATE INDEX "Communication_workspaceId_readAt_idx" ON "Communication"("workspaceId", "readAt");

-- CreateIndex
CREATE INDEX "Communication_jobId_idx" ON "Communication"("jobId");

-- CreateIndex
CREATE INDEX "AutomationRule_workspaceId_enabled_idx" ON "AutomationRule"("workspaceId", "enabled");

-- CreateIndex
CREATE INDEX "AutomationRule_workspaceId_trigger_idx" ON "AutomationRule"("workspaceId", "trigger");

-- CreateIndex
CREATE INDEX "AutomationRun_workspaceId_createdAt_idx" ON "AutomationRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRun_ruleId_createdAt_idx" ON "AutomationRun"("ruleId", "createdAt");

-- One primary service location per customer. The API wraps writes in a
-- transaction; this index is the database-level backstop against races.
CREATE UNIQUE INDEX "Location_one_primary_per_customer"
  ON "Location"("customerId") WHERE "isPrimary" = 1;
