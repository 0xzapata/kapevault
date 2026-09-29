import { Label, Select, TextInput } from "@/components/form";
import type { useLinkForm } from "../hooks/use-link-form";
import type { LinkType } from "../types";

const LINK_TYPES: { value: LinkType; label: string }[] = [
  { value: "web", label: "Web link" },
  { value: "drive", label: "Google Drive" },
  { value: "folder", label: "Local folder" },
  { value: "doc", label: "Document" },
];

// The file link part of the item form.
export function LinkFields({ link }: { link: ReturnType<typeof useLinkForm> }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[170px_1fr]">
      <Label text="Type">
        <Select value={link.linkType} onChange={(e) => link.setLinkType(e.target.value as LinkType)}>
          {LINK_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Label>
      <Label text="Link or folder path">
        <TextInput value={link.location} onChange={(e) => link.setLocation(e.target.value)} placeholder="https://drive.google.com/... or D:\Clients\..." />
      </Label>
    </div>
  );
}
