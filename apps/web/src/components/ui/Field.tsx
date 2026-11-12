import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";

export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

interface WiredChildProps {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

function mergeDescribedBy(existing: string | undefined, ids: string): string {
  if (!existing) return ids;
  const merged = new Set(existing.split(/\s+/).filter(Boolean));
  for (const id of ids.split(/\s+/).filter(Boolean)) merged.add(id);
  return [...merged].join(" ");
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  const generatedId = useId();
  const hintId = `${generatedId}-hint`;
  const errorId = `${generatedId}-error`;
  const showHint = Boolean(hint) && !error;
  const describedBy = [showHint ? hintId : null, error ? errorId : null]
    .filter((id): id is string => id !== null)
    .join(" ");

  // Only a single element child can safely receive the control attributes.
  const childList = Children.toArray(children);
  const onlyChild = childList.length === 1 ? childList[0] : null;
  let content = children;
  if (onlyChild && isValidElement(onlyChild)) {
    // Fragments and other special elements use symbol element types and
    // reject props, so they keep their own wiring.
    const elementType: unknown = onlyChild.type;
    if (typeof elementType !== "symbol") {
      const element = onlyChild as ReactElement<WiredChildProps>;
      const props: WiredChildProps = {};
      if (!element.props.id) props.id = htmlFor ?? generatedId;
      if (describedBy) {
        props["aria-describedby"] = mergeDescribedBy(
          element.props["aria-describedby"],
          describedBy,
        );
      }
      if (error) props["aria-invalid"] = true;
      if (Object.keys(props).length > 0) content = cloneElement(element, props);
    }
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="flex items-center gap-1 text-xs font-medium text-muted"
        >
          {label}
          {required ? (
            <span className="text-accent" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {content}
      {showHint ? (
        <p id={hintId} className="text-xs leading-relaxed text-muted/80">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-xs leading-relaxed text-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
