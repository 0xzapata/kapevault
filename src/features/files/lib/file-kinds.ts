import { previewUrl } from "../../../lib/preview-url.ts";

export type FileKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "html"
  | "markdown"
  | "csv"
  | "json"
  | "code"
  | "text"
  | "word"
  | "excel"
  | "powerpoint"
  | "archive"
  | "other";

const BY_EXT: Record<string, FileKind> = {};
const add = (kind: FileKind, exts: string) => exts.split(" ").forEach((e) => (BY_EXT[e] = kind));

add("image", "png jpg jpeg gif webp svg bmp ico avif");
add("video", "mp4 webm mov m4v ogv");
add("audio", "mp3 wav ogg m4a flac aac opus");
add("pdf", "pdf");
add("html", "html htm");
add("markdown", "md markdown mdx");
add("csv", "csv tsv");
add("json", "json");
add("code", "js mjs cjs ts tsx jsx css scss py rb go rs java c h cpp cs php sh bash ps1 bat yml yaml xml sql toml ini env gitignore");
add("text", "txt log rtf");
add("word", "doc docx odt");
add("excel", "xls xlsx ods");
add("powerpoint", "ppt pptx odp");
add("archive", "zip rar 7z tar gz");

export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function kindOf(name: string): FileKind {
  return BY_EXT[extOf(name)] ?? "other";
}

// Kinds KAPEVault can show inside the preview sheet; the rest open in their default app.
const PREVIEWABLE = new Set<FileKind>(["image", "video", "audio", "pdf", "html", "markdown", "csv", "json", "code", "text"]);
export const canPreview = (kind: FileKind) => PREVIEWABLE.has(kind);

export const isTextKind = (kind: FileKind) => ["markdown", "csv", "json", "code", "text"].includes(kind);

// A srcdoc frame's base is about:srcdoc, so relative <img src="shots/a.png"> would never load.
// Point them at the file protocol beside the markdown file instead. Only relative paths change:
// a src with a scheme (data:, https:) or a //host is left exactly as it was.
export function withLocalImages(html: string, filePath: string): string {
  const dir = filePath.slice(0, Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/")) + 1);
  return html.replace(/(<img[^>]*\ssrc=")([^"]+)"/g, (whole, head: string, src: string) => {
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src)) return whole;
    try {
      return `${head}${previewUrl(dir + decodeURI(src))}"`;
    } catch {
      return whole; // a malformed escape ("%") just leaves the image broken
    }
  });
}

// Minimal CSV/TSV reader: handles quoted cells, doubled quotes, and newlines inside quotes.
export function parseDelimited(text: string, delimiter: string, maxRows = 500): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}
