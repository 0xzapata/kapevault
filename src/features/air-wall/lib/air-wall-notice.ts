// When the app opens, should it say that Air Wall protects a different copy? Run with `npm test`
// (Node strips the types). Only state "other" does: the rule is keyed to an exe path, so after a
// reinstall to another folder it silently stops covering this copy, and the only other sign is a tile
// inside Settings > Security. "on" and "off" are the user's own choice, "unenforced" has its tile.
import type { AirWallStatus } from "../../../lib/vault-api.ts";

export const AIR_WALL_OTHER_COPY = "Keep KAPEVault offline protects another copy of the app. Turn it on again for this one.";

export function airWallNotice(status: AirWallStatus): string | null {
  return status.available && status.state === "other" ? AIR_WALL_OTHER_COPY : null;
}
