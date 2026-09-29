import type { IdEntry } from "@/features/vault/types";
import { ID_TYPES } from "../../../../core/index.js";

// The ID kind's picker: core's ID_TYPES; any other name is typed under Other and saved as typed.
export { ID_TYPES };
export const OTHER = "Other";

// A row's second line: the ID, or just "ID" when the title already names it.
export const idSubtitle = (entry: IdEntry) => (entry.title === entry.idType ? "ID" : entry.idType);
