import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeSlash, ImageSquare, X } from "@phosphor-icons/react";
import { useModal } from "@/components/Sheet";
import { ErrorText } from "@/components/form";
import { textLink } from "@/components/buttons";
import { imageOf, useImagePaste } from "@/hooks/use-image-paste";
import { useReveal } from "@/hooks/use-reveal";
import { vaultApi } from "@/lib/vault-api";

const EXIT_MS = 180; // matches [data-closing] in index.css

// A photo (a device's label, an ID), large, in the app - never an outside viewer. It can open over the
// edit sheet, so it takes Escape in the capture phase: only the photo closes, the sheet underneath stays.
export function PhotoViewer({ photo, label, onClose }: { photo: string; label: string; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const modal = useModal();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const close = useCallback(() => {
    if (timer.current) return;
    setClosing(true);
    timer.current = setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  // React events bubble through the portal: a photo dropped here must not reach the form's drop target.
  const swallow = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim is a mouse shortcut for closing the photo; Escape and the Close photo button are the keyboard way out
    <div data-closing={closing || undefined} className="scrim fixed inset-0 z-[60] grid place-items-center bg-scrim px-4 pb-4 pt-[60px]" onMouseDown={close} onDragOver={swallow} onDrop={swallow}>
      <div {...modal} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className="sheet relative outline-none">
        <img src={photo} alt={label} draggable={false} className="max-h-[calc(100dvh-84px)] max-w-[calc(100vw-32px)] rounded-[16px] bg-paper object-contain shadow-sheet" />
        <button
          type="button"
          // biome-ignore lint/a11y/noAutofocus: a modal opens with the focus on its Close button
          autoFocus
          onClick={close}
          aria-label="Close photo"
          title="Close photo"
          className="press absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-full bg-raised text-ink-2 shadow-tile hover:text-ink focus-ring"
        >
          <X size={15} weight="bold" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

// The form's small photo: a placeholder while a saved photo is not loaded (null), else the photo, which
// a click shows large.
export function PhotoThumb({ photo, label, autoFocus }: { photo: string | null; label: string; autoFocus: boolean }) {
  const [viewing, setViewing] = useState(false);

  if (photo === null) {
    return (
      <span className="grid size-[60px] shrink-0 place-items-center rounded-[10px] border border-line bg-raised text-ink-3">
        <ImageSquare size={24} />
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        // biome-ignore lint/a11y/noAutofocus: the thumbnail takes the focus when the photo has just been revealed
        autoFocus={autoFocus}
        onClick={() => setViewing(true)}
        aria-label={`Show the ${label.toLowerCase()} larger`}
        className="press size-[60px] shrink-0 cursor-zoom-in overflow-hidden rounded-[10px] border border-line bg-paper focus-ring"
      >
        <img src={photo} alt={label} draggable={false} className="size-full object-cover" />
      </button>
      {viewing && <PhotoViewer photo={photo} label={label} onClose={() => setViewing(false)} />}
    </>
  );
}

interface PhotoFieldProps {
  label: string; // "Label photo", "ID photo": names the file input and the photo
  photo: string | null; // "" none yet, null saved but not loaded
  error: string;
  empty: { icon: ReactNode; title: string; hint: string }; // the dashed button before there is a photo
  heading?: string; // the card's first line (the label when not given), and a line under it
  line?: string;
  pickAgain: string; // "Replace", "Scan again"
  busy?: ReactNode; // in place of the card while a photo is being read
  pickNow?: boolean; // the file picker opens straight away
  onImage: (image: Blob) => void;
  onShow: () => void;
  onRemove: () => void;
}

// The item form's photo (a device's label, an ID): picked, dropped on it, or pasted anywhere in the
// form. A saved one stays hidden (not even loaded) until Show photo, then takes the focus.
export function PhotoField({ label, photo, error, empty, heading = label, line, pickAgain, busy, pickNow = false, onImage, onShow, onRemove }: PhotoFieldProps) {
  const picker = useRef<HTMLInputElement>(null);
  const [revealed, setRevealed] = useState(false);
  const pick = () => picker.current?.click();
  const dropTarget = {
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const image = imageOf(e.dataTransfer.files);
      if (image) onImage(image);
    },
  };
  useImagePaste(onImage);

  useEffect(() => {
    if (pickNow) pick();
  }, []);

  return (
    <div className="space-y-2">
      <input
        ref={picker}
        type="file"
        accept="image/*"
        hidden
        aria-label={label}
        onChange={(e) => {
          const image = e.target.files?.[0];
          e.target.value = ""; // the same photo can be picked again
          if (image) onImage(image);
        }}
      />
      {busy ??
        (photo === "" ? (
          <button
            type="button"
            onClick={pick}
            {...dropTarget}
            className="press flex w-full items-center gap-3.5 rounded-[14px] border border-dashed border-line-strong px-4 py-3.5 text-left transition-colors hover:border-accent hover:bg-accent-soft focus-ring"
          >
            {empty.icon}
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-ink">{empty.title}</span>
              <span className="block text-[12.5px] text-ink-3">{empty.hint}</span>
            </span>
          </button>
        ) : (
          <div aria-live="polite" {...dropTarget} className="flex items-center gap-3.5 rounded-[14px] bg-field p-2.5 pr-4">
            <PhotoThumb photo={photo} label={label} autoFocus={revealed} />
            <div className="min-w-0 flex-1">
              <p className="swap-in text-[14px] font-semibold text-ink">{heading}</p>
              {line && <p className="text-[12.5px] leading-snug text-ink-2">{line}</p>}
              <div className="mt-1 flex flex-wrap gap-x-3.5 gap-y-1">
                {photo === null && (
                  <button
                    type="button"
                    onClick={() => {
                      setRevealed(true);
                      onShow();
                    }}
                    className={`${textLink} text-accent`}
                  >
                    Show photo
                  </button>
                )}
                <button type="button" onClick={pick} className={`${textLink} text-accent`}>
                  {pickAgain}
                </button>
                <button type="button" onClick={onRemove} className={`${textLink} text-ink-3 hover:text-danger`}>
                  Remove photo
                </button>
              </div>
            </div>
          </div>
        ))}
      <ErrorText message={error} />
    </div>
  );
}

// A saved photo under the item's card. A label photo shows the sticker's passwords and an ID photo is
// identity data, so it stays in main until asked for; then a click shows it large.
export function SecretPhoto({ entry, label }: { entry: { id: string; hasPhoto: boolean }; label: string }) {
  const { value: photo, toggle } = useReveal(() => vaultApi.getSecret(entry.id, "photo"));
  const [viewing, setViewing] = useState(false);

  if (!entry.hasPhoto) return null;
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-[12.5px] font-semibold text-ink-3">{label}</h3>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={photo !== null}
          className="press flex h-7 items-center gap-1.5 rounded-full bg-field px-3 text-[12.5px] font-semibold text-ink transition-colors hover:bg-line focus-ring"
        >
          {photo === null ? <Eye size={14} /> : <EyeSlash size={14} />}
          {photo === null ? "Show photo" : "Hide photo"}
        </button>
      </div>
      {photo === null ? (
        <div className="grid h-40 w-60 max-w-full place-items-center rounded-2xl border border-line bg-field text-ink-3">
          <ImageSquare size={28} />
        </div>
      ) : (
        <button type="button" onClick={() => setViewing(true)} aria-label={`Show the ${label.toLowerCase()} larger`} className="press block cursor-zoom-in overflow-hidden rounded-2xl border border-line bg-paper shadow-card focus-ring">
          <img src={photo} alt={label} draggable={false} className="swap-in block max-h-48 max-w-full" />
        </button>
      )}
      {viewing && photo && <PhotoViewer photo={photo} label={label} onClose={() => setViewing(false)} />}
    </section>
  );
}
