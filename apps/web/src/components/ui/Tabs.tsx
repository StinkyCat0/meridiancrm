import { useRef, type KeyboardEvent } from "react";
import { cn } from "../../lib/utils";

export interface TabItem {
  value: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
}

export function Tabs({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: TabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const last = items.length - 1;
    let next = index;

    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;

    event.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange(item.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex gap-1 overflow-x-auto border-b border-border",
        className,
      )}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm transition-colors duration-150",
              "after:absolute after:inset-x-2 after:-bottom-px after:h-px after:transition-colors",
              selected
                ? "text-fg after:bg-accent"
                : "text-muted hover:text-fg after:bg-transparent",
            )}
          >
            {item.label}
            {typeof item.count === "number" ? (
              <span
                className={cn(
                  "num rounded-full px-1.5 py-px text-[10px]",
                  selected
                    ? "bg-accent/10 text-accent"
                    : "bg-white/5 text-muted",
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
