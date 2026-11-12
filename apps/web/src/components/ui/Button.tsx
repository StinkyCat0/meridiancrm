import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink shadow-glow hover:bg-accent/90 active:bg-accent/80",
  secondary:
    "border border-border bg-surface-2 text-fg hover:border-white/15 hover:bg-surface-2/70 active:bg-surface-2/50",
  ghost: "text-muted hover:bg-white/5 hover:text-fg active:bg-white/10",
  danger:
    "border border-danger/30 bg-danger/10 text-danger hover:border-danger/45 hover:bg-danger/15 active:bg-danger/20",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-10 gap-2 px-4 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      loading = false,
      fullWidth = false,
      className,
      children,
      disabled,
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-input font-medium transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          "disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          fullWidth && "w-full",
          className,
        )}
        {...props}
      >
        {loading ? (
          <Loader2
            className={cn(
              "animate-spin",
              size === "sm" ? "size-3.5" : "size-4",
            )}
            aria-hidden="true"
          />
        ) : null}
        {children}
      </button>
    );
  },
);
