// Every copy KAPEVault makes goes through here. A copied secret clears after clearMs, on lock and on
// quit - but never something the user copied since.
function createClipboard({ clipboard, ClipboardItem, isMac, clearMs }) {
  let clipboardTimer = null;
  let lastCopied = null;
  let copySeq = 0; // bumped when a copy lands, so a clear that was reading the clipboard can tell

  async function clearCopiedPassword() {
    clearTimeout(clipboardTimer);
    const marker = lastCopied;
    const seq = copySeq;
    if (marker === null) return;
    const onClipboard = await clipboard.readText();
    // A copy landed while reading: its marker and timer are the new secret's, leave them.
    if (seq !== copySeq) return;
    if (onClipboard === marker) clipboard.clear();
    lastCopied = null;
  }

  // Every copy is kept out of Windows clipboard history (Win+V) and cloud clipboard sync: Windows
  // skips clipboard data carrying these formats set to a 0 DWORD (Microsoft's documented opt-out).
  // Pasting is unaffected. Proved: the formats land beside the text with value 0.
  // ExcludeClipboardContentFromMonitorProcessing and "Clipboard Viewer Ignore" (their presence is the
  // signal) keep clipboard managers such as Ditto from saving it.
  async function writeClipboard(text) {
    const items = { "text/plain": text };
    if (!isMac) {
      for (const format of ["CanIncludeInClipboardHistory", "CanUploadToCloudClipboard", "ExcludeClipboardContentFromMonitorProcessing", "Clipboard Viewer Ignore"]) {
        items[`electron application/osclipboard;format="${format}"`] = new Blob([new Uint8Array(4)]);
      }
    }
    await clipboard.write([new ClipboardItem(items)]);
  }

  async function copyWithAutoClear(text) {
    await writeClipboard(text);
    lastCopied = text;
    copySeq++;
    clearTimeout(clipboardTimer);
    clipboardTimer = setTimeout(clearCopiedPassword, clearMs);
  }

  return { writeClipboard, copyWithAutoClear, clearCopiedPassword };
}

module.exports = { createClipboard };
