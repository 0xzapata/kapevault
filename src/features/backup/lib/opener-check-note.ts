import type { OpenerCheckResult } from "@/lib/vault-api";

// What "Check my Opener" tells the user, in plain words. ok = a calm line, otherwise a warning.
export function openerCheckNote(result: OpenerCheckResult, version: string): { text: string; ok: boolean } {
  switch (result) {
    case "genuine":
      return { text: `This Opener is genuine (KAPEVault ${version}).`, ok: true };
    case "replaced":
      return { text: "The file there was not the real Opener - KAPEVault put the real one back (any other file is kept, renamed with .txt).", ok: false };
    case "missing":
      return { text: "Opener not found in your backup folder. It is added with the next copy.", ok: false };
    case "foreign":
      return { text: "A folder with the Opener's name is there. Rename it, then check again.", ok: false };
    case "no-folder":
      return { text: "No backup folder is set. Choose one under Keep a copy in a folder.", ok: false };
    default:
      return { text: "Could not read the Opener. Try again.", ok: false };
  }
}
