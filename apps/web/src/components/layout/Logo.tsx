import { useId } from "react";
import { cn } from "../../lib/utils";

export function LogoMark({ className }: { className?: string }) {
  const gradientId = `meridian-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      role="img"
      aria-label="Meridian"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="9"
          y1="32"
          x2="31"
          y2="8"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--color-accent)" />
          <stop offset="1" stopColor="var(--color-accent-2)" />
        </linearGradient>
      </defs>
      <path
        d="M10 30V15.5C10 12.462 12.462 10 15.5 10H31"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M10 25.5C10 22.462 12.462 20 15.5 20H26"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.55"
      />
      <circle cx="31" cy="30" r="2" fill="var(--color-accent)" />
    </svg>
  );
}

export function LogoLockup({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className="flex size-8 items-center justify-center rounded-input border border-border bg-surface">
        <LogoMark className="size-5" />
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-medium leading-none tracking-tight text-fg">
          Meridian
        </span>
        <span className="label-micro mt-1 leading-none">CRM</span>
      </span>
    </span>
  );
}
