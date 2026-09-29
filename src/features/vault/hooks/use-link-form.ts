import { useState } from "react";
import type { EntryInput, LinkEntry, LinkType } from "../types";

// The file link part of the item form: what kind of place, and where it is.
export function useLinkForm(entry: LinkEntry | null) {
  const [linkType, setLinkType] = useState<LinkType>(entry?.linkType ?? "web");
  const [location, setLocation] = useState(entry?.location ?? "");

  const input = (): Partial<EntryInput> => ({ linkType, location });

  return { linkType, setLinkType, location, setLocation, input };
}
