import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { controlClassName } from "./control";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, className, children, ...props },
  ref,
) {
  return (
    <span className={cn("relative block", className)}>
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          controlClassName(invalid),
          "h-10 cursor-pointer appearance-none pl-3 pr-9",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
    </span>
  );
});
