import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";

export interface TooltipProps {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}

export function Tooltip({
  label,
  children,
  side = "top",
  className,
}: TooltipProps) {
  const id = useId();

  const trigger = isValidElement(children)
    ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, {
        "aria-describedby": id,
      })
    : children;

  return (
    <span className={cn("group relative inline-flex", className)}>
      {trigger}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-md",
          "border border-border bg-surface-2 px-2 py-1 text-[11px] font-medium text-fg shadow-panel",
          "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
        )}
      >
        {label}
      </span>
    </span>
  );
}
