const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { savePdf, asPdf, savePdfWithDialog } = require("./pdf-export.cjs");

test("savePdf locks the window down, prints A4 with no margins, and always destroys it", async () => {
  const calls = { destroyed: 0 };
  class FakeWindow {
    constructor(opts) {
      calls.opts = opts;
      this.webContents = {
        printToPDF: async (o) => {
          calls.print = o;
          if (calls.fail) throw new Error("print failed");
          return Buffer.from("%PDF-mock");
        },
      };
    }
    async loadURL(url) {
      calls.url = url;
    }
    destroy() {
      calls.destroyed++;
    }
  }
  const out = path.join(os.tmpdir(), `kapevault-kit-test-${process.pid}.pdf`);
  await savePdf(FakeWindow, "<p>hi & bye</p>", out);
  assert.equal(fs.readFileSync(out, "utf8"), "%PDF-mock");
  fs.unlinkSync(out);
  assert.equal(calls.opts.show, false);
  assert.deepEqual(calls.opts.webPreferences, { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false });
  assert.equal(calls.url, "data:text/html;charset=utf-8," + encodeURIComponent("<p>hi & bye</p>"));
  assert.equal(calls.print.pageSize, "A4");
  assert.equal(calls.print.printBackground, true);
  assert.deepEqual(calls.print.margins, { top: 0, bottom: 0, left: 0, right: 0 });
  assert.equal(calls.destroyed, 1);

  calls.fail = true;
  await assert.rejects(savePdf(FakeWindow, "<p></p>", out), /print failed/);
  assert.equal(calls.destroyed, 2, "window destroyed even when printing fails");
  assert.ok(!fs.existsSync(out));
});

test("savePdf puts a given margin (inches) on every side", async () => {
  let margins;
  class FakeWindow {
    constructor() {
      this.webContents = { printToPDF: async (o) => ((margins = o.margins), Buffer.from("%PDF-mock")) };
    }
    async loadURL() {}
    destroy() {}
  }
  const out = path.join(os.tmpdir(), `kapevault-margin-test-${process.pid}.pdf`);
  await savePdf(FakeWindow, "<p></p>", out, 0.63);
  fs.unlinkSync(out);
  assert.deepEqual(margins, { top: 0.63, bottom: 0.63, left: 0.63, right: 0.63 });
});

test("a typed name always stays a .pdf, so opening it never runs a program", () => {
  assert.equal(asPdf("C:/Mock/kit.pdf"), "C:/Mock/kit.pdf");
  assert.equal(asPdf("C:/Mock/kit.PDF"), "C:/Mock/kit.PDF");
  assert.equal(asPdf("C:/Mock/kit.cmd"), "C:/Mock/kit.cmd.pdf");
  assert.equal(asPdf("C:/Mock/kit"), "C:/Mock/kit.pdf");
});

// A save dialog, the PDF and the PDF viewer, with Electron's parts faked.
// printFails: printToPDF throws.
function fakeElectron(picked, printFails = false) {
  const calls = { opened: [], printed: 0 };
  class FakeWindow {
    constructor() {
      this.webContents = {
        printToPDF: async (o) => {
          calls.margins = o.margins;
          calls.printed++;
          if (printFails) throw new Error("mock print failed");
          return Buffer.from("%PDF-mock");
        },
      };
    }
    async loadURL() {}
    destroy() {}
  }
  const dialog = {
    showSaveDialog: async (parent, options) => {
      calls.parent = parent;
      calls.dialog = options;
      return picked ? { canceled: false, filePath: picked } : { canceled: true };
    },
  };
  const shell = { openPath: async (file) => (calls.opened.push(file), "") };
  return { deps: { BrowserWindow: FakeWindow, dialog, shell, parent: "mock-window" }, calls };
}

test("savePdfWithDialog saves where the user picked, as a .pdf, then opens it", async () => {
  const picked = path.join(os.tmpdir(), `kapevault-dialog-test-${process.pid}.cmd`);
  const { deps, calls } = fakeElectron(picked);
  const result = await savePdfWithDialog(deps, { title: "Save the grab list", defaultPath: "Grab list.pdf", html: () => "<p>mock</p>", margin: 0.63 });
  assert.deepEqual(result, { name: `${path.basename(picked)}.pdf` }, "only the name, never the folder");
  assert.deepEqual(calls.opened, [`${picked}.pdf`]);
  assert.equal(fs.readFileSync(`${picked}.pdf`, "utf8"), "%PDF-mock");
  fs.unlinkSync(`${picked}.pdf`);
  assert.equal(calls.parent, "mock-window");
  assert.deepEqual(calls.dialog, { title: "Save the grab list", defaultPath: "Grab list.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }], properties: ["dontAddToRecent"] });
  assert.deepEqual(calls.margins, { top: 0.63, bottom: 0.63, left: 0.63, right: 0.63 });
});

test("a cancelled dialog builds no page, prints nothing and opens nothing", async () => {
  const { deps, calls } = fakeElectron(null);
  let built = false;
  const result = await savePdfWithDialog(deps, { title: "Mock", defaultPath: "Mock.pdf", html: () => ((built = true), "<p></p>") });
  assert.deepEqual(result, { canceled: true });
  assert.equal(built, false);
  assert.equal(calls.printed, 0);
  assert.deepEqual(calls.opened, []);
});

test("a failed print rejects, opens nothing and leaves no .pdf behind", async () => {
  const picked = path.join(os.tmpdir(), `kapevault-print-fail-test-${process.pid}.pdf`);
  const { deps, calls } = fakeElectron(picked, true);
  await assert.rejects(savePdfWithDialog(deps, { title: "Mock", defaultPath: "Mock.pdf", html: () => "<p></p>" }), /mock print failed/);
  assert.equal(calls.printed, 1);
  assert.deepEqual(calls.opened, []);
  assert.equal(fs.existsSync(picked), false);
});
