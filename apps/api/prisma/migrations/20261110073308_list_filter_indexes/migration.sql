-- CreateIndex
CREATE INDEX "Activity_workspaceId_contactId_idx" ON "Activity"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "Activity_workspaceId_companyId_idx" ON "Activity"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_companyId_idx" ON "Contact"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "Deal_workspaceId_companyId_idx" ON "Deal"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "Deal_workspaceId_contactId_idx" ON "Deal"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "Deal_workspaceId_ownerId_idx" ON "Deal"("workspaceId", "ownerId");
