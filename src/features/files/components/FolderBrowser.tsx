import { useEffect, useState } from "react";
import { ArrowLeft, CaretRight } from "@phosphor-icons/react";
import { previewUrl, vaultApi, type FolderItem, type FolderListing } from "@/lib/vault-api";
import { FolderArt } from "./FolderArt";
import { FileGlyph } from "./FileGlyph";
import { FilePreview } from "./FilePreview";
import { kindOf } from "../lib/file-kinds";

interface FolderBrowserProps {
  root: string; // a folder saved as a file link
}

function Thumb({ item }: { item: FolderItem }) {
  if (item.kind === "dir") return <FolderArt size={64} />;
  const kind = kindOf(item.name);
  if (kind === "image") {
    return <img src={previewUrl(item.path)} alt="" loading="lazy" draggable={false} className="h-[52px] max-w-[72px] rounded-md object-contain shadow-card" />;
  }
  return <FileGlyph kind={kind} size={44} />;
}

export function FolderBrowser({ root }: FolderBrowserProps) {
  const [trail, setTrail] = useState<string[]>([]); // sub-folder names below root
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<FolderItem | null>(null);

  const rel = trail.join("/");
  const rootName = root.split(/[\\/]/).filter(Boolean).pop() ?? root;

  useEffect(() => {
    let live = true;
    setError("");
    setListing(null); // the old folder must not stay clickable while the next one loads
    vaultApi
      .listFolder(root, rel)
      .then((l) => live && setListing(l))
      .catch(() => live && setError("This folder can't be opened. Check the path still exists on this PC."));
    return () => {
      live = false;
    };
  }, [root, rel]);

  function open(item: FolderItem) {
    if (item.kind === "dir") setTrail([...trail, item.name]);
    else setPreview(item);
  }

  const files = listing?.items.filter((i) => i.kind === "file") ?? [];

  return (
    <section className="mt-8">
      <div className="flex items-center gap-1 px-1 text-[13px]">
        {trail.length > 0 && (
          <button
            aria-label="Back"
            onClick={() => setTrail(trail.slice(0, -1))}
            className="press mr-1 grid size-7 place-items-center rounded-full text-ink-2 hover:bg-accent-soft hover:text-accent"
          >
            <ArrowLeft size={15} />
          </button>
        )}
        {[rootName, ...trail].map((name, i) => {
          const last = i === trail.length;
          return (
            <span key={`${i}-${name}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <CaretRight size={11} className="shrink-0 text-ink-3" />}
              <button
                disabled={last}
                onClick={() => setTrail(trail.slice(0, i))}
                className={`truncate rounded px-1 ${last ? "font-semibold text-ink" : "text-ink-3 hover:text-accent"}`}
              >
                {name}
              </button>
            </span>
          );
        })}
        {listing && <span className="ml-auto shrink-0 text-[12px] text-ink-3 tabular-nums">{listing.total} items</span>}
      </div>

      {error && <p role="alert" className="mt-4 px-1 text-[13px] text-danger">{error}</p>}

      {listing && !error && (
        // key replays the stagger each time a folder opens
        <ul key={listing.dir} className="stagger mt-4 grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
          {listing.items.map((item) => (
            <li key={item.name}>
              <button
                onClick={() => open(item)}
                title={item.name}
                className="press row flex h-[124px] w-full flex-col items-center justify-center gap-2 rounded-[14px] px-2 hover:bg-hover"
              >
                <div className="grid h-[56px] place-items-center">
                  <Thumb item={item} />
                </div>
                <span className="line-clamp-2 w-full break-words text-center text-[12px] leading-tight text-ink">{item.name}</span>
              </button>
            </li>
          ))}
          {listing.items.length === 0 && <li className="col-span-full py-8 text-center text-[13px] text-ink-3">This folder is empty.</li>}
        </ul>
      )}
      {listing && listing.total > listing.items.length && (
        <p className="mt-3 px-1 text-[12px] text-ink-3">Showing the first {listing.items.length} of {listing.total}.</p>
      )}

      {preview && (
        <FilePreview
          item={preview}
          siblings={files}
          onNavigate={setPreview}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}
