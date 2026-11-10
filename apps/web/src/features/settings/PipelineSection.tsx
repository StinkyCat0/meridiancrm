import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Workflow,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  api,
  ApiError,
  type Pipeline,
  type Stage,
  type StageKind,
} from "@meridian/api-client";
import { atLeast, STAGE_KINDS } from "@meridian/contracts";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Field } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tooltip } from "../../components/ui/Tooltip";
import { useAuth } from "../../lib/auth";
import { queryKeys } from "../../lib/query";

const STAGE_TONE: Record<StageKind, BadgeTone> = {
  OPEN: "accent",
  WON: "success",
  LOST: "danger",
};

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function StagesSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading pipelines">
      {[0, 1].map((pipeline) => (
        <Card key={pipeline}>
          <div className="space-y-3 p-5">
            <Skeleton className="h-4 w-40" />
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-8 w-full" />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

interface StageModalProps {
  open: boolean;
  pipelineId: string;
  stage: Stage | null;
  onClose: () => void;
}

function StageFormModal({ open, pipelineId, stage, onClose }: StageModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [probability, setProbability] = useState("50");
  const [targetDays, setTargetDays] = useState("30");
  const [kind, setKind] = useState<StageKind>("OPEN");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(stage?.name ?? "");
    setProbability(String(stage?.probability ?? 50));
    setTargetDays(String(stage?.targetDays ?? 30));
    setKind(stage?.kind ?? "OPEN");
    setError(null);
    setPending(false);
  }, [open, stage?.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the stage a name.");
      return;
    }
    const nextProbability = Number(probability);
    if (!Number.isInteger(nextProbability) || nextProbability < 0 || nextProbability > 100) {
      setError("Probability must be a whole number between 0 and 100.");
      return;
    }
    const nextTargetDays = Number(targetDays);
    if (!Number.isInteger(nextTargetDays) || nextTargetDays < 1 || nextTargetDays > 365) {
      setError("Target days must be a whole number between 1 and 365.");
      return;
    }

    setPending(true);
    try {
      if (stage) {
        await api.pipelines.updateStage(stage.id, {
          name: trimmed,
          probability: nextProbability,
          kind,
          targetDays: nextTargetDays,
        });
      } else {
        await api.pipelines.createStage(pipelineId, {
          name: trimmed,
          probability: nextProbability,
          kind,
          targetDays: nextTargetDays,
        });
      }
      toast.success(stage ? "Stage updated" : "Stage added");
      await queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.all });
      await queryClient.invalidateQueries({ queryKey: ["insights"] });
      await queryClient.invalidateQueries({ queryKey: ["workspace", "audit"] });
      onClose();
    } catch (cause) {
      const message = messageFor(cause, "Could not save the stage.");
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={stage ? "Edit stage" : "Add stage"}
      description="Probability and target days feed momentum scoring."
      closeOnBackdrop={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="stage-form" variant="primary" loading={pending}>
            {stage ? "Save stage" : "Add stage"}
          </Button>
        </>
      }
    >
      <form id="stage-form" className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <Field label="Name" htmlFor="stage-name" required>
          <Input
            id="stage-name"
            value={name}
            maxLength={60}
            placeholder="Proposal"
            data-autofocus
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Probability %" htmlFor="stage-probability" required>
            <Input
              id="stage-probability"
              type="number"
              min={0}
              max={100}
              value={probability}
              onChange={(event) => setProbability(event.target.value)}
            />
          </Field>
          <Field label="Target days" htmlFor="stage-days" required>
            <Input
              id="stage-days"
              type="number"
              min={1}
              max={365}
              value={targetDays}
              onChange={(event) => setTargetDays(event.target.value)}
            />
          </Field>
          <Field label="Kind" htmlFor="stage-kind">
            <Select
              id="stage-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as StageKind)}
            >
              {STAGE_KINDS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error ? (
          <p role="alert" className="text-sm leading-relaxed text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

export function PipelineSection() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const canManage = role ? atLeast(role, "ADMIN") : false;
  const pipelinesQuery = useQuery({
    queryKey: queryKeys.pipelines.all,
    queryFn: api.pipelines.list,
  });
  const [stageModal, setStageModal] = useState<{ pipelineId: string; stage: Stage | null } | null>(
    null,
  );
  const [deletingStage, setDeletingStage] = useState<Stage | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pipelineModalOpen, setPipelineModalOpen] = useState(false);
  const [pipelineName, setPipelineName] = useState("");
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const reorderMutation = useMutation({
    mutationFn: ({ pipelineId, stageIds }: { pipelineId: string; stageIds: string[] }) =>
      api.pipelines.reorderStages(pipelineId, stageIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.all });
      await queryClient.invalidateQueries({ queryKey: ["insights"] });
      await queryClient.invalidateQueries({ queryKey: ["workspace", "audit"] });
    },
    onError: (error) => toast.error(messageFor(error, "Could not reorder stages.")),
  });

  const deleteStageMutation = useMutation({
    mutationFn: (id: string) => api.pipelines.deleteStage(id),
    onSuccess: async () => {
      toast.success("Stage deleted");
      setDeletingStage(null);
      setDeleteError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.all });
      await queryClient.invalidateQueries({ queryKey: ["insights"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace", "audit"] });
    },
    onError: (error) => {
      const message = messageFor(error, "Could not delete the stage.");
      setDeleteError(message);
      toast.error(message);
    },
  });

  const createPipelineMutation = useMutation({
    mutationFn: (name: string) => api.pipelines.create({ name }),
    onSuccess: async () => {
      toast.success("Pipeline created");
      setPipelineModalOpen(false);
      setPipelineName("");
      setPipelineError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.all });
      await queryClient.invalidateQueries({ queryKey: ["insights"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace", "audit"] });
    },
    onError: (error) => {
      const message = messageFor(error, "Could not create the pipeline.");
      setPipelineError(message);
      toast.error(message);
    },
  });

  function moveStage(pipeline: Pipeline, stage: Stage, direction: "up" | "down") {
    const index = pipeline.stages.findIndex((item) => item.id === stage.id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= pipeline.stages.length) return;
    const stageIds = pipeline.stages.map((item) => item.id);
    const current = stageIds[index];
    const neighbour = stageIds[target];
    if (!current || !neighbour) return;
    stageIds[index] = neighbour;
    stageIds[target] = current;
    reorderMutation.mutate({ pipelineId: pipeline.id, stageIds });
  }

  function handleCreatePipeline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPipelineError(null);
    const trimmed = pipelineName.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      setPipelineError("Pipeline name must be between 1 and 80 characters.");
      return;
    }
    createPipelineMutation.mutate(trimmed);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-light tracking-tight text-fg">Pipeline</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            Stages define probability, expected time in stage and won/lost outcomes.
          </p>
          {!canManage ? (
            <p className="mt-2 text-xs text-muted">Only admins can manage stages. This view is read-only.</p>
          ) : null}
        </div>
        {canManage ? (
          <Button
            variant="primary"
            onClick={() => {
              setPipelineError(null);
              setPipelineModalOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New pipeline
          </Button>
        ) : null}
      </div>

      {pipelinesQuery.isLoading ? <StagesSkeleton /> : null}

      {pipelinesQuery.isError ? (
        <Card>
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
            <p className="text-sm font-medium text-fg">Could not load pipelines</p>
            <p className="mt-1.5 text-sm text-muted">
              {messageFor(pipelinesQuery.error, "Check your connection and try again.")}
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => void pipelinesQuery.refetch()}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Try again
            </Button>
          </div>
        </Card>
      ) : null}

      {pipelinesQuery.isSuccess && pipelinesQuery.data.length === 0 ? (
        <EmptyState
          icon={<Workflow />}
          title="No pipelines configured"
          description={
            canManage
              ? "Create a pipeline to give the workspace a default set of stages."
              : "An admin needs to create the first pipeline."
          }
          action={
            canManage ? (
              <Button
                variant="primary"
                onClick={() => {
                  setPipelineError(null);
                  setPipelineModalOpen(true);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                New pipeline
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {(pipelinesQuery.data ?? []).map((pipeline) => (
        <Card key={pipeline.id}>
          <CardHeader>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{pipeline.name}</CardTitle>
                {pipeline.isDefault ? <Badge tone="success">Default</Badge> : null}
              </div>
              <CardDescription className="mt-1">
                {pipeline.stages.length} {pipeline.stages.length === 1 ? "stage" : "stages"}
              </CardDescription>
            </div>
            {canManage ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setStageModal({ pipelineId: pipeline.id, stage: null })}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Add stage
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[580px] text-left text-sm">
                <thead>
                  <tr className="border-y border-border text-[10px] uppercase tracking-[0.16em] text-muted">
                    <th scope="col" className="px-4 py-2.5 font-black">
                      Stage
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-black">
                      Probability
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-black">
                      Target
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-black">
                      Kind
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-black">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pipeline.stages.map((stage, index) => (
                    <tr key={stage.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="num w-4 text-xs text-muted">{index + 1}</span>
                          <span className="text-sm text-fg">{stage.name}</span>
                        </div>
                      </td>
                      <td className="num px-4 py-3 text-sm text-muted">{stage.probability}%</td>
                      <td className="num px-4 py-3 text-sm text-muted">{stage.targetDays}d</td>
                      <td className="px-4 py-3">
                        <Badge tone={STAGE_TONE[stage.kind]}>{stage.kind}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {canManage ? (
                          <div className="flex items-center justify-end gap-0.5">
                            <Tooltip label="Move up">
                              <IconButton
                                label={`Move ${stage.name} up`}
                                size="sm"
                                disabled={
                                  index === 0 || reorderMutation.isPending || !canManage
                                }
                                onClick={() => moveStage(pipeline, stage, "up")}
                              >
                                <ChevronUp aria-hidden="true" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip label="Move down">
                              <IconButton
                                label={`Move ${stage.name} down`}
                                size="sm"
                                disabled={
                                  index === pipeline.stages.length - 1 ||
                                  reorderMutation.isPending
                                }
                                onClick={() => moveStage(pipeline, stage, "down")}
                              >
                                <ChevronDown aria-hidden="true" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip label="Edit stage">
                              <IconButton
                                label={`Edit ${stage.name}`}
                                size="sm"
                                onClick={() =>
                                  setStageModal({ pipelineId: pipeline.id, stage })
                                }
                              >
                                <Pencil aria-hidden="true" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip label="Delete stage">
                              <IconButton
                                label={`Delete ${stage.name}`}
                                size="sm"
                                variant="danger"
                                onClick={() => {
                                  deleteStageMutation.reset();
                                  setDeleteError(null);
                                  setDeletingStage(stage);
                                }}
                              >
                                <Trash2 aria-hidden="true" />
                              </IconButton>
                            </Tooltip>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      <StageFormModal
        open={stageModal !== null}
        pipelineId={stageModal?.pipelineId ?? ""}
        stage={stageModal?.stage ?? null}
        onClose={() => setStageModal(null)}
      />

      <Modal
        open={deletingStage !== null}
        onClose={() => {
          if (!deleteStageMutation.isPending) setDeletingStage(null);
        }}
        title="Delete stage?"
        description={deletingStage ? `“${deletingStage.name}” will be removed.` : undefined}
        size="sm"
        closeOnBackdrop={!deleteStageMutation.isPending}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={deleteStageMutation.isPending}
              onClick={() => setDeletingStage(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteStageMutation.isPending}
              onClick={() => {
                if (deletingStage) deleteStageMutation.mutate(deletingStage.id);
              }}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete stage
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          Stages with deals cannot be deleted. Move those deals first.
        </p>
        {deleteError ? (
          <p role="alert" className="mt-3 text-sm leading-relaxed text-danger">
            {deleteError}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={pipelineModalOpen}
        onClose={() => {
          if (!createPipelineMutation.isPending) setPipelineModalOpen(false);
        }}
        title="New pipeline"
        description="Starts with the standard six-stage set."
        size="sm"
        closeOnBackdrop={!createPipelineMutation.isPending}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={createPipelineMutation.isPending}
              onClick={() => setPipelineModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="pipeline-form"
              variant="primary"
              loading={createPipelineMutation.isPending}
            >
              Create pipeline
            </Button>
          </>
        }
      >
        <form id="pipeline-form" onSubmit={handleCreatePipeline}>
          <Field label="Name" htmlFor="pipeline-name" required>
            <Input
              id="pipeline-name"
              value={pipelineName}
              maxLength={80}
              placeholder="Partnerships"
              data-autofocus
              onChange={(event) => setPipelineName(event.target.value)}
            />
          </Field>
          {pipelineError ? (
            <p role="alert" className="mt-3 text-sm leading-relaxed text-danger">
              {pipelineError}
            </p>
          ) : null}
        </form>
      </Modal>
    </div>
  );
}
