import { Label, TextInput } from "@/components/form";

// Replacing the vault here with no copy kept while it is locked (needsMaster) also takes ITS own
// master password, so nobody at the keyboard can wipe it with a backup of their own. The parent
// remounts it by key after a wrong try: it comes back empty and takes the focus (as ConfirmDelete).
export function CurrentMasterField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="settle space-y-1.5">
      <Label text="Master password of the vault here now">
        <TextInput type="password" autoFocus value={value} onChange={(e) => onChange(e.target.value)} />
      </Label>
      <p className="text-[12.5px] text-ink-3">It is locked, so replacing it with no copy needs its own password.</p>
    </div>
  );
}
