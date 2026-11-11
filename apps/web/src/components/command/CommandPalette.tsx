import { useQuery } from "@tanstack/react-query";
import { api } from "@meridian/api-client";
import type { SearchHit } from "@meridian/contracts";
import {
  ArrowRight,
  Building2,
  CircleDollarSign,
  CornerDownLeft,
  FileText,
  MapPin,
  MessageSquare,
  Plus,
  Receipt,
  Search,
  Tags,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { queryKeys } from "../../lib/query";
import { cn, useDebouncedValue } from "../../lib/utils";
import { Skeleton } from "../ui/Skeleton";
import { COMMAND_EVENT } from "./events";

interface ActionSeed {
  label: string;
  sublabel: string;
  to: string;
  keywords: string;
}

const QUICK_ACTIONS: readonly ActionSeed[] = [
  {
    label: "New contact",
    sublabel: "Add a person to the workspace",
    to: "/app/contacts?new=1",
    keywords: "create add person people",
  },
  {
    label: "New customer",
    sublabel: "Add a customer and service location",
    to: "/app/companies?new=1",
    keywords: "create add customer account client",
  },
  {
    label: "New job",
    sublabel: "Schedule a visit or work order",
    to: "/app/schedule?new=1",
    keywords: "create add work order dispatch visit",
  },
  {
    label: "New estimate",
    sublabel: "Price a scope for a customer",
    to: "/app/estimates?new=1",
    keywords: "create add quote proposal",
  },
  {
    label: "New invoice",
    sublabel: "Bill a job or customer",
    to: "/app/invoices?new=1",
    keywords: "create add bill receivable",
  },
  {
    label: "New deal",
    sublabel: "Open an opportunity in the pipeline",
    to: "/app/deals?new=1",
    keywords: "create add opportunity pipeline",
  },
  {
    label: "New activity",
    sublabel: "Log a call, email, meeting or task",
    to: "/app/activities?new=1",
    keywords: "create add note task call meeting",
  },
];

const NAVIGATION: readonly ActionSeed[] = [
  { label: "Overview", sublabel: "Dispatch and pipeline", to: "/app", keywords: "dashboard home" },
  { label: "Schedule", sublabel: "Jobs and dispatch", to: "/app/schedule", keywords: "jobs work orders calendar route" },
  { label: "Customers", sublabel: "People, sites and accounts", to: "/app/companies", keywords: "clients accounts" },
  { label: "Estimates", sublabel: "Quotes", to: "/app/estimates", keywords: "proposals quotes" },
  { label: "Invoices", sublabel: "Receivables", to: "/app/invoices", keywords: "billing payments" },
  { label: "Services", sublabel: "Price book", to: "/app/services", keywords: "pricing catalog" },
  { label: "Contacts", sublabel: "People", to: "/app/contacts", keywords: "people" },
  { label: "Deals", sublabel: "Pipeline", to: "/app/deals", keywords: "opportunities revenue" },
  { label: "Activities", sublabel: "Calls, email, meetings, tasks", to: "/app/activities", keywords: "tasks notes" },
  { label: "Settings", sublabel: "Workspace and team", to: "/app/settings", keywords: "admin members" },
];

const HIT_GROUPS: Record<SearchHit["type"], string> = {
  contact: "Contacts",
  company: "Customers",
  deal: "Deals",
  location: "Locations",
  job: "Jobs",
  estimate: "Estimates",
  invoice: "Invoices",
  communication: "Communications",
};

const HIT_ICONS: Record<SearchHit["type"], LucideIcon> = {
  contact: Users,
  company: Building2,
  deal: CircleDollarSign,
  location: MapPin,
  job: Wrench,
  estimate: FileText,
  invoice: Receipt,
  communication: MessageSquare,
};

interface CommandItem {
  id: string;
  group: string;
  label: string;
  sublabel: string | null;
  icon: LucideIcon;
  onSelect: () => void;
}

interface CommandGroup {
  label: string;
  items: CommandItem[];
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const debouncedQuery = useDebouncedValue(query, 200);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();

  const trimmedQuery = query.trim();
  const searchEnabled = open && debouncedQuery.trim().length >= 2;

  const search = useQuery({
    queryKey: queryKeys.insights.search(debouncedQuery.trim()),
    queryFn: () => api.insights.search(debouncedQuery.trim()),
    enabled: searchEnabled,
    staleTime: 20_000,
  });

  const go = useCallback(
    (to: string) => {
      setOpen(false);
      navigate(to);
    },
    [navigate],
  );

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    function handleOpen() {
      setOpen(true);
    }

    window.addEventListener("keydown", handleShortcut);
    window.addEventListener(COMMAND_EVENT, handleOpen);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      window.removeEventListener(COMMAND_EVENT, handleOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setQuery("");
    setActiveIndex(0);

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open]);

  const groups = useMemo<CommandGroup[]>(() => {
    const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();

    const actions = QUICK_ACTIONS.filter(
      (seed) =>
        normalized.length === 0 ||
        `${seed.label} ${seed.keywords}`.toLowerCase().includes(normalized),
    ).map<CommandItem>((seed) => ({
      id: `action-${seed.to}`,
      group: "Actions",
      label: seed.label,
      sublabel: seed.sublabel,
      icon: Plus,
      onSelect: () => go(seed.to),
    }));

    const built: CommandGroup[] = [];
    if (actions.length > 0) built.push({ label: "Actions", items: actions });

    if (trimmedQuery.length === 0) {
      built.push({
        label: "Navigation",
        items: NAVIGATION.map((seed) => ({
          id: `nav-${seed.to}`,
          group: "Navigation",
          label: seed.label,
          sublabel: seed.sublabel,
          icon: ArrowRight,
          onSelect: () => go(seed.to),
        })),
      });
      return built;
    }

    if (trimmedQuery.length < 2) return built;

    const hits = search.data?.hits ?? [];
    const buckets = new Map<string, CommandItem[]>();
    for (const hit of hits) {
      const group = HIT_GROUPS[hit.type];
      const item: CommandItem = {
        id: `hit-${hit.type}-${hit.id}`,
        group,
        label: hit.label,
        sublabel: hit.sublabel,
        icon: HIT_ICONS[hit.type],
        onSelect: () => go(hit.href),
      };
      const bucket = buckets.get(group);
      if (bucket) bucket.push(item);
      else buckets.set(group, [item]);
    }

    for (const label of [
      "Customers",
      "Contacts",
      "Locations",
      "Jobs",
      "Estimates",
      "Invoices",
      "Deals",
    ] as const) {
      const items = buckets.get(label);
      if (items && items.length > 0) built.push({ label, items });
    }

    return built;
  }, [query, trimmedQuery, search.data, go]);

  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const safeIndex = items.length === 0 ? -1 : Math.min(activeIndex, items.length - 1);
  const activeItem = safeIndex >= 0 ? items[safeIndex] : undefined;

  const isSearching =
    trimmedQuery.length >= 2 &&
    (debouncedQuery.trim() !== trimmedQuery ||
      debouncedQuery.trim().length < 2 ||
      search.isFetching ||
      search.isPending);
  const hasNoResults =
    trimmedQuery.length >= 2 && !isSearching && !search.isError && items.length === 0;
  const searchFailed = search.isError && trimmedQuery.length >= 2;

  useEffect(() => {
    if (safeIndex >= 0) itemRefs.current[safeIndex]?.scrollIntoView({ block: "nearest" });
  }, [safeIndex]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, debouncedQuery]);

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (items.length > 0) setActiveIndex((safeIndex + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length > 0) setActiveIndex(safeIndex <= 0 ? items.length - 1 : safeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(items.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activeItem?.onSelect();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  function handlePanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    inputRef.current?.focus();
  }

  if (!open) return null;

  let runningIndex = 0;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[10vh] sm:pt-[14vh]">
      <div
        className="dialog-backdrop scrim absolute inset-0 backdrop-blur-sm"
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handlePanelKeyDown}
        className="dialog-panel relative z-10 flex max-h-[72vh] w-full max-w-xl flex-col overflow-hidden rounded-panel border border-border bg-surface shadow-panel"
      >
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-autocomplete="list"
            aria-activedescendant={activeItem?.id}
            aria-label="Search customers, jobs, documents or actions"
            placeholder="Search customers, jobs, invoices…"
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted/60"
          />
          <kbd className="hidden shrink-0 rounded border border-border bg-bg/60 px-1.5 py-0.5 text-[10px] text-muted sm:block">
            esc
          </kbd>
        </div>

        <div
          id="command-list"
          role="listbox"
          aria-label="Command results"
          className="min-h-0 flex-1 overflow-y-auto p-2"
        >
          {isSearching ? (
            <div className="space-y-2 p-2" aria-live="polite" aria-busy="true">
              <span className="sr-only">Searching…</span>
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="flex items-center gap-3 px-2 py-1.5">
                  <Skeleton className="size-7 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-2.5 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {searchFailed ? (
            <p className="px-3 py-8 text-center text-sm text-muted">
              Search is unavailable right now. Check your connection and try again.
            </p>
          ) : null}

          {hasNoResults && !searchFailed ? (
            <div className="px-3 py-10 text-center">
              <p className="text-sm font-medium text-fg">No matches</p>
              <p className="mt-1 text-xs text-muted">
                Try a customer, job, estimate, invoice, or contact name.
              </p>
            </div>
          ) : null}

          {!isSearching && !hasNoResults && !searchFailed
            ? groups.map((group) => (
                <div key={group.label} role="group" aria-label={group.label} className="mb-2 last:mb-0">
                  <p className="label-micro px-2 pb-1 pt-2">{group.label}</p>
                  {group.items.map((item) => {
                    const index = runningIndex;
                    runningIndex += 1;
                    const active = index === safeIndex;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        ref={(element) => {
                          itemRefs.current[index] = element;
                        }}
                        type="button"
                        id={item.id}
                        role="option"
                        aria-selected={active}
                        tabIndex={-1}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => item.onSelect()}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-input px-2.5 py-2 text-left transition-colors",
                          active ? "bg-white/[0.06] text-fg" : "text-muted hover:bg-white/[0.03]",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-input border border-border bg-surface-2",
                            active ? "text-accent" : "text-muted",
                          )}
                          aria-hidden="true"
                        >
                          <Icon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-fg">{item.label}</span>
                          {item.sublabel ? (
                            <span className="block truncate text-xs text-muted">{item.sublabel}</span>
                          ) : null}
                        </span>
                        {active ? (
                          <CornerDownLeft className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))
            : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2 text-[10px] text-muted">
          <span>
            <kbd className="rounded border border-border bg-bg/60 px-1 py-0.5">↑</kbd>
            <kbd className="ml-1 rounded border border-border bg-bg/60 px-1 py-0.5">↓</kbd>{" "}
            to navigate
          </span>
          <span>
            <kbd className="rounded border border-border bg-bg/60 px-1 py-0.5">↵</kbd> to open
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
