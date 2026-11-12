import type { DealStatusFilter } from "@meridian/api-client";
import type { Member, Pipeline, Stage } from "@meridian/contracts";
import { Search, X } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import { Tabs } from "../../../components/ui/Tabs";

const VIEW_ITEMS = [
  { value: "board", label: "Board" },
  { value: "table", label: "Table" },
] as const;

interface DealToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  status: DealStatusFilter;
  onStatusChange: (value: DealStatusFilter) => void;
  ownerId: string;
  onOwnerChange: (value: string) => void;
  stageId: string;
  onStageChange: (value: string) => void;
  showStageFilter: boolean;
  stages: Stage[];
  members: Member[];
  pipelines: Pipeline[];
  pipelineId: string;
  onPipelineChange: (value: string) => void;
  view: string;
  onViewChange: (value: string) => void;
  hasFilters: boolean;
  onClearFilters: () => void;
}

export function DealToolbar({
  search,
  onSearchChange,
  status,
  onStatusChange,
  ownerId,
  onOwnerChange,
  stageId,
  onStageChange,
  showStageFilter,
  stages,
  members,
  pipelines,
  pipelineId,
  onPipelineChange,
  view,
  onViewChange,
  hasFilters,
  onClearFilters,
}: DealToolbarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <div className="relative w-full xl:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search deals…"
            aria-label="Search deals"
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pipelines.length > 1 ? (
            <Select
              value={pipelineId}
              onChange={(event) => onPipelineChange(event.target.value)}
              aria-label="Filter by pipeline"
              className="min-w-[calc(50%_-_0.25rem)] flex-1 sm:w-[160px] sm:flex-none"
            >
              {pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </Select>
          ) : null}

          <Select
            value={status}
            onChange={(event) =>
              onStatusChange(event.target.value as DealStatusFilter)
            }
            aria-label="Filter by status"
            className="min-w-[calc(50%_-_0.25rem)] flex-1 sm:w-[140px] sm:flex-none"
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </Select>

          <Select
            value={ownerId}
            onChange={(event) => onOwnerChange(event.target.value)}
            aria-label="Filter by owner"
            className="min-w-[calc(50%_-_0.25rem)] flex-1 sm:w-[160px] sm:flex-none"
          >
            <option value="">All owners</option>
            {members.map((member) => (
              <option key={member.id} value={member.user.id}>
                {member.user.name}
              </option>
            ))}
          </Select>

          {showStageFilter ? (
            <Select
              value={stageId}
              onChange={(event) => onStageChange(event.target.value)}
              aria-label="Filter by stage"
              className="min-w-[calc(50%_-_0.25rem)] flex-1 sm:w-[150px] sm:flex-none"
            >
              <option value="">All stages</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
          ) : null}

          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={onClearFilters}>
              <X className="size-3.5" aria-hidden="true" />
              Clear
            </Button>
          ) : null}
        </div>

        <div className="xl:ml-auto">
          <Tabs
            items={VIEW_ITEMS}
            value={view}
            onChange={onViewChange}
            ariaLabel="Deal view"
            className="border-b-0"
          />
        </div>
      </div>
    </div>
  );
}
