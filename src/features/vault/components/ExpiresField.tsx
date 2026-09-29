import { useId } from "react";
import { Button, TextInput } from "@/components/form";

// An optional expiry date (YYYY-MM-DD, "" = none): an API key's, or an ID kept as a thing.
export function ExpiresField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-medium text-ink-2">
        Expires (optional)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full max-w-[200px]">
          <TextInput id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
        </div>
        {value && (
          <Button type="button" onClick={() => onChange("")}>
            No expiry
          </Button>
        )}
      </div>
    </div>
  );
}
