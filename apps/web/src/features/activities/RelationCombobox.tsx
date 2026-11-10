import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { useDebouncedValue } from "../../lib/utils";

export interface RelationOption {
  id: string;
  label: string;
  hint?: string;
}

interface RelationComboboxProps {
  id: string;
  label: string;
  source: "company" | "contact" | "deal";
  value: string | null;
  initialLabel?: string | null;
  onChange: (id: string | null) => void;
  load: (query: string) => Promise<RelationOption[]>;
  placeholder: string;
}

/**
 * Native datalist combobox: filters server results (capped at 100) while keeping
 * the selected id separate from the visible label.
 */
export function RelationCombobox({
  id,
  label,
  source,
  value,
  initialLabel,
  onChange,
  load,
  placeholder,
}: RelationComboboxProps) {
  const listId = useId();
  const [text, setText] = useState(initialLabel ?? "");
  const [selectedLabel, setSelectedLabel] = useState(initialLabel ?? "");

  useEffect(() => {
    setText(initialLabel ?? "");
    setSelectedLabel(initialLabel ?? "");
  }, [initialLabel]);

  const debounced = useDebouncedValue(text, 250);
  const term = text.trim() === selectedLabel ? "" : debounced.trim();
  const optionsQuery = useQuery({
    queryKey: ["relation-options", source, term],
    queryFn: () => load(term),
    staleTime: 30_000,
  });

  function handleChange(next: string) {
    setText(next);
    const match = optionsQuery.data?.find((option) => option.label === next);
    if (match) {
      setSelectedLabel(match.label);
      onChange(match.id);
    } else if (next.trim().length === 0) {
      setSelectedLabel("");
      onChange(null);
    }
  }

  return (
    <Field
      label={label}
      htmlFor={id}
      hint={optionsQuery.isFetching ? "Searching…" : "Search to link a record."}
    >
      <Input
        id={id}
        list={listId}
        value={text}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={() => setText(selectedLabel)}
        onFocus={() => {
          if (text === selectedLabel) setText("");
        }}
      />
      <datalist id={listId}>
        {(optionsQuery.data ?? []).map((option) => (
          <option key={option.id} value={option.label}>
            {option.hint}
          </option>
        ))}
      </datalist>
      {value && !text ? (
        <button
          type="button"
          className="text-left text-[11px] text-muted underline decoration-border underline-offset-2 hover:text-fg"
          onClick={() => {
            onChange(null);
            setSelectedLabel("");
            setText("");
          }}
        >
          Clear selection
        </button>
      ) : null}
    </Field>
  );
}
