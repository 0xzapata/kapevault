import { useEffect } from "react";

// The first image among picked, dropped or pasted files.
export const imageOf = (files: FileList | null | undefined) => [...(files ?? [])].find((f) => f.type.startsWith("image/"));

// Ctrl+V anywhere while this is mounted, with a photo on the clipboard, hands the photo over; text
// pastes as usual.
export function useImagePaste(onImage: (image: File) => void) {
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const image = imageOf(e.clipboardData?.files);
      if (!image) return;
      e.preventDefault();
      onImage(image);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });
}
