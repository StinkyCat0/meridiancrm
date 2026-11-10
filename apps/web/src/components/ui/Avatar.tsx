import { useEffect, useState } from "react";
import { cn, initials } from "../../lib/utils";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

const sizeClasses: Record<AvatarSize, string> = {
  xs: "size-6 text-[9px]",
  sm: "size-8 text-[11px]",
  md: "size-10 text-xs",
  lg: "size-14 text-base",
};

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
}

export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImage = Boolean(src) && !failed;

  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-border",
        showImage
          ? "bg-surface-2"
          : "bg-gradient-to-br from-accent/20 to-accent-2/20 font-medium text-fg",
        sizeClasses[size],
        className,
      )}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{initials(name) || "?"}</span>
      )}
    </span>
  );
}
