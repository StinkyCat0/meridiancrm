import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { controlClassName } from "./control";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className, type = "text", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(controlClassName(invalid), "h-10 px-3", className)}
      {...props}
    />
  );
});
