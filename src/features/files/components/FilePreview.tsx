import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { marked } from "marked";
import { ArrowSquareOut, CaretLeft, CaretRight, FolderOpen, X } from "@phosphor-icons/react";
import { Sheet } from "@/components/Sheet";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { previewUrl, vaultApi, type FolderItem } from "@/lib/vault-api";
import { explorerName } from "@/lib/platform";
import { FileGlyph } from "./FileGlyph";
import { canPreview, isTextKind, kindOf, parseDelimited, extOf, withLocalImages, type FileKind } from "../lib/file-kinds";
import { formatSize } from "@/lib/format";
import { formatDay } from "@/lib/local-date";

interface FilePreviewProps {
  item: FolderItem;
  siblings: FolderItem[]; // files in the same folder, for left/right
  onNavigate: (item: FolderItem) => void;
  onClose: () => void;
}

const APP_NAMES: Partial<Record<FileKind, string>> = { word: "Word", excel: "Excel", powerpoint: "PowerPoint" };

// Markdown renders in a sandboxed frame (no scripts), styled like a document. A srcdoc frame cannot
// read the app's tokens, so MarkdownView copies the ones this style uses into it.
const MD_TOKENS = ["ink", "ink-2", "accent", "field", "line-strong"];
const MD_STYLE = `body{font:15px/1.65 "Segoe UI",system-ui,sans-serif;color:var(--color-ink);max-width:720px;margin:32px auto;padding:0 32px}
h1,h2,h3{letter-spacing:-.02em;line-height:1.2}h1{font-size:28px}h2{font-size:21px;margin-top:28px}
code{font:13px ui-monospace,monospace;background:var(--color-field);padding:2px 5px;border-radius:5px}
pre{background:var(--color-field);padding:14px;border-radius:10px;overflow:auto}pre code{background:none;padding:0}
a{color:var(--color-accent)}table{border-collapse:collapse}td,th{border:1px solid var(--color-line-strong);padding:6px 10px}
blockquote{margin:0;padding-left:14px;border-left:3px solid var(--color-line-strong);color:var(--color-ink-2)}img{max-width:100%}`;

// The page sits on paper, white in every theme, so a dark window lends it the Classic tokens; High
// contrast and Colorblind lend their own. The frame element is its own probe: data-theme scopes the
// tokens on it, and they are read before the first paint.
function MarkdownView({ title, html }: { title: string; html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [tokens, setTokens] = useState("");
  const theme = document.documentElement.dataset.theme;

  useLayoutEffect(() => {
    if (!frame.current) return;
    const style = getComputedStyle(frame.current);
    setTokens(MD_TOKENS.map((t) => `--color-${t}:${style.getPropertyValue(`--color-${t}`)}`).join(";"));
  }, [theme]);

  return (
    <iframe
      ref={frame}
      title={title}
      sandbox=""
      data-theme={theme === "dark" ? "classic" : theme}
      srcDoc={tokens ? `<!doctype html><meta charset="utf-8"><style>:root{${tokens}}${MD_STYLE}</style>${html}` : undefined}
      className="size-full border-0 bg-paper"
    />
  );
}

// Fits the pane first, like Quick Look; a click shows it at full size, scrolling to every edge.
// Centred by absolute inset + margin auto: in a grid the row grows to the image, so max-h-full
// never limited anything and a tall image was cut off with no way to scroll.
function ImageView({ url, name }: { url: string; name: string }) {
  const [actual, setActual] = useState(false);
  const checker = "bg-[repeating-conic-gradient(var(--color-checker)_0_25%,var(--color-raised)_0_50%)] bg-[length:16px_16px]";
  return actual ? (
    <div data-image-view="actual" className={`h-full overflow-auto p-6 ${checker}`}>
      <button type="button" aria-label="Fit to window" title="Click to fit" onClick={() => setActual(false)} className="mx-auto block cursor-zoom-out focus-ring">
        <img src={url} alt={name} className="block max-w-none shadow-card" />
      </button>
    </div>
  ) : (
    <div data-image-view="fit" className={`relative h-full overflow-hidden ${checker}`}>
      <button type="button" aria-label="Show actual size" title="Click for actual size" onClick={() => setActual(true)} className="absolute inset-0 cursor-zoom-in focus-ring focus-ring-inset">
        <img src={url} alt={name} className="absolute inset-0 m-auto max-h-[calc(100%-48px)] max-w-[calc(100%-48px)] object-contain shadow-card" />
      </button>
    </div>
  );
}

// An HTML file opens with its scripts off. A page that runs could draw a fake "enter your master
// password" screen inside the preview, so running them is the user's call, one file at a time.
function HtmlView({ title, url }: { title: string; url: string }) {
  const [scripts, setScripts] = useState(false);
  return (
    <div className="flex h-full flex-col">
      {!scripts && (
        <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-2">
          <p className="flex-1 text-[12.5px] text-ink-2">Scripts in this page are off. Run them only for files you trust - KAPEVault never asks for your master password inside a preview.</p>
          <button onClick={() => setScripts(true)} className="press h-7 shrink-0 rounded-full bg-field px-3 text-[12.5px] font-medium text-ink hover:bg-line">
            Run scripts
          </button>
        </div>
      )}
      <iframe key={String(scripts)} title={title} src={url} sandbox={scripts ? "allow-scripts" : ""} className="min-h-0 w-full flex-1 border-0 bg-paper" />
    </div>
  );
}

function useText(item: FolderItem, kind: FileKind) {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (!isTextKind(kind)) return;
    let live = true;
    setText(null);
    vaultApi
      .readText(item.path)
      .then((r) => {
        if (!live) return;
        setTruncated(r.truncated);
        setText(r.text);
      })
      .catch(() => live && setText(""));
    return () => {
      live = false;
    };
  }, [item, kind]);

  return { text, truncated };
}

function CodeView({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).slice(0, 5000);
  return (
    <div data-own-keys tabIndex={0} className="selectable h-full overflow-auto bg-surface py-4 font-mono outline-none text-[12.5px] leading-[1.6]">
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span className="w-14 shrink-0 select-none pr-4 text-right text-ink-3 tabular-nums">{i + 1}</span>
          <span className="whitespace-pre pr-6">{line || " "}</span>
        </div>
      ))}
    </div>
  );
}

function TableView({ text, delimiter }: { text: string; delimiter: string }) {
  const [head, ...rows] = parseDelimited(text, delimiter);
  return (
    <div data-own-keys tabIndex={0} className="selectable h-full overflow-auto outline-none">
      <table className="min-w-full border-collapse text-[13px]">
        <thead className="sticky top-0 bg-surface">
          <tr>{head?.map((h, i) => <th key={i} className="border-b border-line px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="even:bg-surface">
              {r.map((c, j) => <td key={j} className="border-b border-line px-3 py-1.5 whitespace-nowrap">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Body({ item, kind }: { item: FolderItem; kind: FileKind }) {
  const url = previewUrl(item.path);
  const { text, truncated } = useText(item, kind);

  if (isTextKind(kind) && text === null) return <div className="h-full animate-pulse bg-surface" />;

  const note = truncated && <p className="border-t border-line bg-surface px-5 py-2 text-[12px] text-ink-3">Showing the first 1 MB.</p>;
  const withNote = (view: ReactNode) => (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">{view}</div>
      {note}
    </div>
  );

  switch (kind) {
    case "image":
      return <ImageView url={url} name={item.name} />;
    case "video":
      return (
        <div className="relative h-full bg-stage">
          <video src={url} controls className="absolute inset-0 m-auto max-h-[calc(100%-32px)] max-w-[calc(100%-32px)]" />
        </div>
      );
    case "audio":
      return (
        <div className="grid h-full place-items-center bg-surface">
          <div className="flex flex-col items-center gap-6">
            <FileGlyph kind="audio" size={96} />
            <audio src={url} controls className="w-[min(420px,80vw)]" />
          </div>
        </div>
      );
    case "pdf":
      return <iframe title={item.name} src={url} className="size-full border-0" />;
    case "html":
      // Runs its own scripts like an artifact, but sandboxed: no access to KAPEVault or the vault.
      return <HtmlView title={item.name} url={url} />;
    case "markdown":
      return withNote(<MarkdownView title={item.name} html={withLocalImages(marked.parse(text ?? "", { async: false }), item.path)} />);
    case "csv":
      return withNote(<TableView text={text ?? ""} delimiter={extOf(item.name) === "tsv" ? "\t" : ","} />);
    case "json": {
      let pretty = text ?? "";
      try {
        pretty = JSON.stringify(JSON.parse(pretty), null, 2);
      } catch {
        // not valid JSON (or truncated) - show as-is
      }
      return withNote(<CodeView text={pretty} />);
    }
    case "code":
    case "text":
      return withNote(<CodeView text={text ?? ""} />);
    default:
      return null;
  }
}

export function FilePreview({ item, siblings, onNavigate, onClose }: FilePreviewProps) {
  const kind = kindOf(item.name);
  const index = siblings.findIndex((s) => s.path === item.path);
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
  const [notice, setNotice] = useState("");

  useEffect(() => setNotice(""), [item]);

  // Arrow keys step through the folder. Keyboard actions never animate.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // arrows seek a playing video and scroll wide tables/code, so those keep them
      if (e.target instanceof HTMLMediaElement || (e.target instanceof Element && e.target.closest("[data-own-keys]"))) return;
      if (e.key === "ArrowLeft" && prev) onNavigate(prev);
      if (e.key === "ArrowRight" && next) onNavigate(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onNavigate]);

  async function openInApp() {
    try {
      const result = await vaultApi.openFile(item.path);
      setNotice(result === "revealed" ? `This file could run code, so it is shown in ${explorerName} instead.` : "");
    } catch {
      setNotice("Windows has no app set up to open this file type.");
    }
  }

  const appName = APP_NAMES[kind];
  const iconBtn = "press grid size-8 place-items-center rounded-full text-ink-2 hover:bg-accent-soft hover:text-accent disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <Sheet title={item.name} onClose={onClose} width="w-[1240px]" bare>
      {(close) => (
        <div className="flex h-[min(820px,calc(100dvh-24px))] flex-col">
          <header className="flex items-center gap-3 border-b border-line px-5 py-3">
            <FileGlyph kind={kind} size={28} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{item.name}</h2>
              <p className="text-[12px] text-ink-3">
                {formatSize(item.size)} · {formatDay(new Date(item.modified))}
                {siblings.length > 1 && index >= 0 && ` · ${index + 1} of ${siblings.length}`}
              </p>
            </div>
            {notice && <span className="hidden max-w-[320px] text-right sm:inline text-[12px] text-danger">{notice}</span>}
            <button aria-label="Previous file" disabled={!prev} onClick={() => prev && onNavigate(prev)} className={iconBtn}>
              <CaretLeft size={16} />
            </button>
            <button aria-label="Next file" disabled={!next} onClick={() => next && onNavigate(next)} className={iconBtn}>
              <CaretRight size={16} />
            </button>
            <button onClick={openInApp} className="press flex h-8 items-center gap-1.5 rounded-full bg-field px-3.5 text-[13px] font-medium hover:bg-line">
              <ArrowSquareOut size={14} />
              {appName ? `Open in ${appName}` : "Open in app"}
            </button>
            <button aria-label="Show in folder" title="Show in folder" onClick={() => vaultApi.revealPath(item.path)} className={iconBtn}>
              <FolderOpen size={16} />
            </button>
            <button aria-label="Close preview" onClick={close} className={iconBtn}>
              <X size={16} />
            </button>
          </header>

          <div className="min-h-0 flex-1">
            {canPreview(kind) ? (
              <ErrorBoundary key={item.path} fallback={<p className="grid h-full place-items-center text-[14px] text-ink-2">KAPEVault could not show this file.</p>}>
                <Body item={item} kind={kind} />
              </ErrorBoundary>
            ) : (
              <div className="grid h-full place-items-center bg-surface">
                <div className="flex flex-col items-center gap-4 text-center">
                  <FileGlyph kind={kind} size={88} />
                  <p className="text-[14px] text-ink-2">KAPEVault can't show this file type here.</p>
                  <button onClick={openInApp} className="press flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-medium text-on-accent hover:brightness-110">
                    <ArrowSquareOut size={16} />
                    {appName ? `Open in ${appName}` : "Open in default app"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
