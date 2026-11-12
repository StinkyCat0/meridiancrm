-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EstimateLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "estimateId" TEXT NOT NULL,
    "serviceId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "unitPrice" INTEGER NOT NULL,
    "unitCost" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "EstimateLineItem_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EstimateLineItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_EstimateLineItem" ("estimateId", "id", "name", "position", "quantity", "serviceId", "total", "unitPrice") SELECT "estimateId", "id", "name", "position", "quantity", "serviceId", "total", "unitPrice" FROM "EstimateLineItem";
DROP TABLE "EstimateLineItem";
ALTER TABLE "new_EstimateLineItem" RENAME TO "EstimateLineItem";
CREATE INDEX "EstimateLineItem_estimateId_idx" ON "EstimateLineItem"("estimateId");
CREATE INDEX "EstimateLineItem_serviceId_idx" ON "EstimateLineItem"("serviceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
