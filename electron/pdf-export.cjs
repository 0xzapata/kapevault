// Every printout KAPEVault saves (the Emergency Kit, Hand back, the grab list): an HTML page rendered
// in a hidden, locked-down window and written as an A4 PDF, then opened in the PDF viewer to print.
const fs = require("node:fs");
const path = require("node:path");

// Renders a page in a hidden, locked-down window and writes it as an A4 PDF. margin (inches, every
// page) is 0 for the kit, which draws its own; a page that flows onto more sheets needs a real one.
async function savePdf(BrowserWindow, html, filePath, margin = 0) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  try {
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    // Electron 44 takes margins in inches (electron.d.ts PrintToPDFMargins).
    const pdf = await win.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      margins: { top: margin, bottom: margin, left: margin, right: margin },
    });
    await fs.promises.writeFile(filePath, pdf);
  } finally {
    win.destroy();
  }
}

// A PDF is opened right after saving, so whatever name was typed must stay a .pdf: "kit.cmd" would
// otherwise be run by openPath.
const asPdf = (file) => (/\.pdf$/i.test(file) ? file : `${file}.pdf`);

// The save dialog (kept out of Recent files), the PDF, then the PDF viewer. html() is called only once
// a place is picked. Returns { canceled: true } or { name } - the saved file's name, never its folder.
// stillOpen(): asked once the dialog returns - the dialog can sit open past the auto-lock, and a PDF
// built from items read before the lock must not be written after it. False refuses: nothing is rendered or written.
async function savePdfWithDialog({ BrowserWindow, dialog, shell, parent }, { title, defaultPath, html, margin = 0, stillOpen = () => true }) {
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title,
    defaultPath,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    properties: ["dontAddToRecent"],
  });
  if (canceled || !filePath) return { canceled: true };
  if (!stillOpen()) throw new Error("The vault locked while the save window was open, so nothing was saved. Unlock it and try again.");
  const file = asPdf(filePath);
  await savePdf(BrowserWindow, html(), file, margin);
  await shell.openPath(file); // straight to the PDF viewer, ready to print
  return { name: path.basename(file) };
}

module.exports = { savePdf, asPdf, savePdfWithDialog };
