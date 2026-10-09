import { useEffect, useState } from "react";
import { ImageSquare } from "@phosphor-icons/react";
import { Button } from "./form";
import { Sheet } from "./Sheet";

// A photo from the vault (a JPEG data URL) as a blob: URL: the page's CSP lets images come from the
// app's own files and blob: only. Revoked when the photo changes or the view goes.
export function useBlobUrl(dataUrl: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!dataUrl) return setUrl(null);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) => c.charCodeAt(0));
    } catch {
      return setUrl(null); // a photo that does not decode is not drawn; an error here would blank the app
    }
    const made = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [dataUrl]);
  return url;
}

// A saved photo's tile: a placeholder until it is shown, then the photo; a tap shows it large in a sheet
// (the PC's PhotoThumb and PhotoViewer). className sizes it.
export function PhotoTile({ photo, label, className }: { photo: string | null; label: string; className: string }) {
  const url = useBlobUrl(photo);
  const [viewing, setViewing] = useState(false);
  if (!url) {
    return (
      <span className={`${className} grid shrink-0 place-items-center border border-line bg-raised text-ink-3`}>
        <ImageSquare size={24} />
      </span>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setViewing(true)} aria-label={`Show the ${label.toLowerCase()} larger`} className={`${className} press shrink-0 overflow-hidden border border-line bg-paper focus-ring`}>
        <img src={url} alt={label} draggable={false} className="size-full object-cover" />
      </button>
      {viewing && (
        <Sheet
          title={label}
          onClose={() => setViewing(false)}
          footer={(close) => (
            <>
              <span className="flex-1" />
              <Button onClick={close}>Done</Button>
            </>
          )}
        >
          {() => <img src={url} alt={label} draggable={false} className="mt-4 w-full rounded-[12px] bg-paper" />}
        </Sheet>
      )}
    </>
  );
}
