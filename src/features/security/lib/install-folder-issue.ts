// The Security list's row for an install folder other accounts can change. null: nothing to say.
export function installFolderIssue(writers: string[]): { title: string; body: string } | null {
  if (writers.length === 0) return null;
  return {
    title: "Other accounts can change the KAPEVault folder",
    body: `Other accounts on this PC can change the KAPEVault folder (${writers.join(", ")}). Reinstall into a folder only you can write to.`,
  };
}
