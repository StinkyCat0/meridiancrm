import type { DealStatusFilter } from "@meridian/api-client";
import { atLeast, type Deal, type Stage } from "@meridian/contracts";
import { AlertTriangle, LayoutGrid, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../lib/auth";
import { useDebouncedValue } from "../../lib/utils";
import { DealBoard, DealBoardSkeleton } from "./components/DealBoard";
import { DealDetail } from "./components/DealDetail";
import { DealFormModal } from "./components/DealFormModal";
import {
  DealTable,
  DealTableSkeleton,
  type DealSortKey,
} from "./components/DealTable";
import { DealToolbar } from "./components/DealToolbar";
import {
  useDealsList,
  useDeleteDeal,
  useMoveDealStage,
  usePipelines,
  useWorkspaceMembers,
} from "./hooks";
import { errorMessage, stageKindLabel } from "./lib/deals";

type DealView = "board" | "table";

export default function DealsPage() {
  const { role, workspace } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const dealParam = searchParams.get("deal");

  const pipelinesQuery = usePipelines();
  const membersQuery = useWorkspaceMembers();
  const pipelines = pipelinesQuery.data ?? [];

  const [pipelineId, setPipelineId] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [status, setStatus] = useState<DealStatusFilter>(() => {
    const param = searchParams.get("status");
    return param === "open" ||
      param === "won" ||
      param === "lost" ||
      param === "all"
      ? param
      : "all";
  });
  const [ownerId, setOwnerId] = useState("");
  const [stageId, setStageId] = useState("");
  const [view, setView] = useState<DealView>("board");
  const [sort, setSort] = useState<DealSortKey | "updatedAt">("updatedAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  const newParam = searchParams.get("new") === "1";
  const [formOpen, setFormOpen] = useState(newParam);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Deal | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    deal: Deal;
    stage: Stage;
  } | null>(null);

  useEffect(() => {
    const fallback =
      pipelines.find((pipeline) => pipeline.isDefault) ?? pipelines[0];
    if (!fallback) return;
    setPipelineId((current) => {
      if (current && pipelines.some((pipeline) => pipeline.id === current))
        return current;
      return fallback.id;
    });
  }, [pipelines]);

  useEffect(() => {
    if (!newParam) return;
    setEditingDeal(null);
    setFormOpen(true);
  }, [newParam]);

  const activePipeline = useMemo(() => {
    return (
      pipelines.find((pipeline) => pipeline.id === pipelineId) ??
      pipelines.find((pipeline) => pipeline.isDefault) ??
      pipelines[0]
    );
  }, [pipelines, pipelineId]);

  const stages = useMemo(
    () => [...(activePipeline?.stages ?? [])].sort((a, b) => a.order - b.order),
    [activePipeline],
  );
  const editingStages = useMemo(() => {
    const pipeline = editingDeal
      ? pipelines.find((row) => row.id === editingDeal.pipelineId)
      : undefined;
    return [...(pipeline?.stages ?? stages)].sort((a, b) => a.order - b.order);
  }, [editingDeal, pipelines, stages]);

  const dealsQuery = useDealsList({
    pipelineId: activePipeline?.id,
    status,
    q: debouncedSearch.trim() || undefined,
    ownerId: ownerId || undefined,
    stageId: view === "table" && stageId ? stageId : undefined,
    sort,
    order,
  });
  const moveDeal = useMoveDealStage();
  const deleteDeal = useDeleteDeal();

  const deals = dealsQuery.data?.data ?? [];
  const isLoading = pipelinesQuery.isPending || dealsQuery.isPending;
  const loadError = pipelinesQuery.error ?? dealsQuery.error;
  const hasFilters = Boolean(
    search.trim() || status !== "all" || ownerId || stageId,
  );
  const canDelete = role ? atLeast(role, "ADMIN") : false;
  const currency = workspace?.currency ?? "USD";

  function openDeal(dealId: string) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("deal", dealId);
      return next;
    });
  }

  function closeDeal() {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("deal");
        return next;
      },
      { replace: true },
    );
  }

  function startCreate() {
    setEditingDeal(null);
    setFormOpen(true);
  }

  function startEdit(deal: Deal) {
    setEditingDeal(deal);
    setFormOpen(true);
  }

  function handleFormSaved(deal: Deal) {
    setFormOpen(false);
    setEditingDeal(null);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("new");
        next.set("deal", deal.id);
        return next;
      },
      { replace: true },
    );
  }

  function closeForm() {
    setFormOpen(false);
    setEditingDeal(null);
    if (!newParam) return;
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("new");
        return next;
      },
      { replace: true },
    );
  }

  function handleStatusChange(value: DealStatusFilter) {
    setStatus(value);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === "all") next.delete("status");
        else next.set("status", value);
        return next;
      },
      { replace: true },
    );
  }

  function clearFilters() {
    setSearch("");
    setOwnerId("");
    setStageId("");
    handleStatusChange("all");
  }

  function handleViewChange(value: string) {
    const nextView: DealView = value === "table" ? "table" : "board";
    setView(nextView);
    if (nextView === "board") setStageId("");
  }

  function handlePipelineChange(value: string) {
    setPipelineId(value);
    setStageId("");
  }

  function handleSort(field: DealSortKey) {
    if (sort === field) {
      setOrder((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSort(field);
    setOrder(field === "value" ? "desc" : "asc");
  }

  function requestMove(deal: Deal, stage: Stage) {
    if (deal.stageId === stage.id) return;
    if (deal.stage.kind !== "OPEN") {
      setPendingMove({ deal, stage });
      return;
    }
    moveDeal.mutate({ deal, stage });
  }

  function confirmMove() {
    if (!pendingMove) return;
    moveDeal.mutate(pendingMove);
    setPendingMove(null);
  }

  function requestDelete(deal: Deal) {
    deleteDeal.reset();
    setDeleteTarget(deal);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    deleteDeal.mutate(targetId, {
      onSuccess: () => {
        if (dealParam === targetId) closeDeal();
        setDeleteTarget(null);
      },
    });
  }

  function retryLoad() {
    void pipelinesQuery.refetch();
    void dealsQuery.refetch();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Pipeline"
        title="Deals"
        description={
          activePipeline
            ? `Drag deals through ${activePipeline.name}, track momentum, and keep every close date honest.`
            : "Track every deal from first conversation to closed outcome."
        }
        actions={
          <Button
            variant="primary"
            onClick={startCreate}
            disabled={!stages.length}
          >
            <Plus className="size-4" aria-hidden="true" />
            New deal
          </Button>
        }
      />

      <DealToolbar
        search={search}
        onSearchChange={setSearch}
        status={status}
        onStatusChange={handleStatusChange}
        ownerId={ownerId}
        onOwnerChange={setOwnerId}
        stageId={stageId}
        onStageChange={setStageId}
        showStageFilter={view === "table"}
        stages={stages}
        members={membersQuery.data ?? []}
        pipelines={pipelines}
        pipelineId={activePipeline?.id ?? ""}
        onPipelineChange={handlePipelineChange}
        view={view}
        onViewChange={handleViewChange}
        hasFilters={hasFilters}
        onClearFilters={clearFilters}
      />

      {isLoading ? (
        view === "board" ? (
          <DealBoardSkeleton />
        ) : (
          <DealTableSkeleton />
        )
      ) : loadError ? (
        <EmptyState
          icon={<AlertTriangle />}
          title="Couldn't load the pipeline"
          description={errorMessage(loadError)}
          action={
            <Button variant="secondary" onClick={retryLoad}>
              Try again
            </Button>
          }
        />
      ) : deals.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid />}
          title={hasFilters ? "No deals match those filters" : "No deals yet"}
          description={
            hasFilters
              ? "Adjust or clear the filters to see more of the pipeline."
              : "Create the first deal and start moving it through the stages."
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="primary"
                onClick={startCreate}
                disabled={!stages.length}
              >
                <Plus className="size-4" aria-hidden="true" />
                New deal
              </Button>
              {hasFilters ? (
                <Button variant="ghost" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          }
        />
      ) : view === "board" ? (
        <DealBoard
          stages={stages}
          deals={deals}
          currency={currency}
          onOpenDeal={(deal) => openDeal(deal.id)}
          onMoveDeal={requestMove}
        />
      ) : (
        <DealTable
          deals={deals}
          sort={sort}
          order={order}
          onSort={handleSort}
          onOpenDeal={(deal) => openDeal(deal.id)}
        />
      )}

      <DealDetail
        dealId={dealParam}
        open={Boolean(dealParam)}
        onClose={closeDeal}
        pipelines={pipelines}
        onEdit={startEdit}
        onDelete={requestDelete}
        onMoveStage={requestMove}
        canDelete={canDelete}
      />

      <DealFormModal
        open={formOpen}
        onClose={closeForm}
        deal={editingDeal}
        stages={editingStages}
        defaultCurrency={currency}
        onSaved={handleFormSaved}
      />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (deleteDeal.isPending) return;
          setDeleteTarget(null);
          deleteDeal.reset();
        }}
        title="Delete this deal?"
        description="This permanently removes the deal and its stage history."
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteDeal.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={confirmDelete}
              loading={deleteDeal.isPending}
            >
              Delete deal
            </Button>
          </>
        }
      >
        <p className="text-sm font-medium text-fg">{deleteTarget?.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          The deal, its activity links and stage history will be removed. This
          cannot be undone.
        </p>
        {deleteDeal.error ? (
          <p role="alert" className="mt-3 text-xs leading-relaxed text-danger">
            {errorMessage(deleteDeal.error)}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(pendingMove)}
        onClose={() => setPendingMove(null)}
        title={`Move out of ${pendingMove ? (stageKindLabel(pendingMove.deal.stage.kind) ?? pendingMove.deal.stage.name) : "closed"}?`}
        description="This deal is already in a closed stage."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingMove(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmMove}>
              Move deal
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          {pendingMove ? (
            <>
              <span className="font-medium text-fg">
                {pendingMove.deal.title}
              </span>{" "}
              is in {pendingMove.deal.stage.name}. Moving it to{" "}
              <span className="font-medium text-fg">
                {pendingMove.stage.name}
              </span>{" "}
              will change its outcome and update its momentum.
            </>
          ) : null}
        </p>
      </Modal>
    </div>
  );
}
