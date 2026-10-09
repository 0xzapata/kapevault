import { File, FileAudio, FileCode, FileCsv, FileHtml, FileImage, FileMd, FilePdf, FileText, FileVideo, FileZip } from "@phosphor-icons/react";
import { brandBySlug } from "@/features/brands/brands";
import { BrandLogo } from "@/features/brands/BrandLogo";
import type { FileKind } from "../lib/file-kinds";

const ICONS = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FilePdf,
  html: FileHtml,
  markdown: FileMd,
  csv: FileCsv,
  json: FileCode,
  code: FileCode,
  text: FileText,
  archive: FileZip,
  other: File,
} as const;

// Office files use their app logo from the brand set; everything else a Phosphor file glyph.
const OFFICE_LOGO: Partial<Record<FileKind, string>> = { word: "word", excel: "excel", powerpoint: "powerpoint" };

export function FileGlyph({ kind, size }: { kind: FileKind; size: number }) {
  const logoSlug = OFFICE_LOGO[kind];
  const logo = logoSlug ? brandBySlug(logoSlug) : null;
  if (logo) return <BrandLogo brand={logo} size={size} />;

  const Icon = ICONS[kind as keyof typeof ICONS] ?? File;
  const tone = kind === "pdf" ? "text-danger" : "text-accent";
  return <Icon size={size} weight="duotone" className={tone} />;
}
