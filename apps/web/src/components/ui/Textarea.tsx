import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { controlClassName } from "./control";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(controlClassName(invalid), "min-h-24 resize-y px-3 py-2.5", className)}
      {...props}
    />
  );
});
