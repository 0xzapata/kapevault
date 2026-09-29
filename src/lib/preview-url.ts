// Previews load through the main process's checked protocol, never file://. Each path segment is
// encoded separately so an HTML file's relative assets (style.css, img/) resolve beside it.
export const previewUrl = (path: string) =>
  `kapevault-file://local/${path.split(/[\\/]/).map(encodeURIComponent).join("/")}`;
