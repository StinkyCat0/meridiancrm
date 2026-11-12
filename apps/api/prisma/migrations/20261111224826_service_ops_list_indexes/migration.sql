-- CreateIndex
CREATE INDEX "Estimate_workspaceId_status_createdAt_idx" ON "Estimate"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Estimate_workspaceId_jobId_idx" ON "Estimate"("workspaceId", "jobId");

-- CreateIndex
CREATE INDEX "Estimate_workspaceId_expiresAt_idx" ON "Estimate"("workspaceId", "expiresAt");

-- CreateIndex
CREATE INDEX "Invoice_workspaceId_status_dueAt_idx" ON "Invoice"("workspaceId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Invoice_workspaceId_jobId_idx" ON "Invoice"("workspaceId", "jobId");

-- CreateIndex
CREATE INDEX "Invoice_workspaceId_createdAt_idx" ON "Invoice"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_workspaceId_scheduledStart_assigneeId_idx" ON "Job"("workspaceId", "scheduledStart", "assigneeId");

-- CreateIndex
CREATE INDEX "Job_workspaceId_updatedAt_idx" ON "Job"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "Job_workspaceId_completedAt_idx" ON "Job"("workspaceId", "completedAt");

-- CreateIndex
CREATE INDEX "Location_workspaceId_customerId_isPrimary_idx" ON "Location"("workspaceId", "customerId", "isPrimary");

-- CreateIndex
CREATE INDEX "ServiceItem_workspaceId_category_idx" ON "ServiceItem"("workspaceId", "category");
