// A Finder-style folder: back panel with a tab, lighter front panel. Colours come from tokens.
export function FolderArt({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 80 64" aria-hidden="true">
      <path d="M4 10a6 6 0 0 1 6-6h18.5a6 6 0 0 1 4.6 2.2L37 11h33a6 6 0 0 1 6 6v37a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z" fill="var(--color-folder-back)" />
      <path d="M4 22a6 6 0 0 1 6-6h60a6 6 0 0 1 6 6v32a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z" fill="var(--color-folder-front)" />
      <path d="M4 22a6 6 0 0 1 6-6h60a6 6 0 0 1 6 6v1.5H4z" fill="var(--color-folder-lip)" />
    </svg>
  );
}
