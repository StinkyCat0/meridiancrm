import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { IconButton } from "../../components/ui/IconButton";
import { Input, type InputProps } from "../../components/ui/Input";
import { cn } from "../../lib/utils";

export function PasswordInput({
  className,
  ...props
}: Omit<InputProps, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="relative block">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <IconButton
        label={visible ? "Hide password" : "Show password"}
        size="sm"
        onClick={() => setVisible((current) => !current)}
        className="absolute right-1 top-1/2 -translate-y-1/2"
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </IconButton>
    </span>
  );
}
