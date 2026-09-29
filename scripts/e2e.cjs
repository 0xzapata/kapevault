// End-to-end check of every button in the real Electron window, against a throwaway vault.
// Run: npm run e2e  (the launcher and helpers live in e2e-harness.cjs)
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { createHarness, shows, gone, clip, opened, waitFor } = require("./e2e-harness.cjs");

const SHOTS = os.tmpdir();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-e2e-"));
const { results, check, launch: launchWith } = createHarness();

// A fake R2 bucket "kapevault-e2e" on localhost that only accepts access key "e2e-key-id".
// (The SigV4 signature itself is checked against AWS's examples in r2-client.test.cjs.)
const r2 = { objects: new Map(), modified: new Map(), agents: new Set() };
const r2Server = http.createServer((req, res) => {
  r2.agents.add(req.headers["user-agent"] ?? "");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const u = new URL(req.url, "http://local");
    const [, bucket, ...rest] = u.pathname.split("/");
    const key = rest.join("/");
    const reply = (status, body = "") => {
      res.writeHead(status, { "content-type": "application/xml" });
      res.end(body);
    };
    if (!/Credential=e2e-key-id\//.test(req.headers.authorization || "")) return reply(403, "<Error><Code>InvalidAccessKeyId</Code></Error>");
    if (bucket !== "kapevault-e2e") return reply(404, "<Error><Code>NoSuchBucket</Code></Error>");
    if (req.method === "PUT") return r2.objects.set(key, Buffer.concat(chunks)), r2.modified.set(key, new Date()), reply(200);
    if (req.method === "DELETE") return r2.objects.delete(key), reply(204);
    if (req.method === "GET" && !key) {
      const prefix = u.searchParams.get("prefix") || "";
      const items = [...r2.objects].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `<Contents><Key>${k}</Key><LastModified>${(r2.modified.get(k) ?? new Date()).toISOString()}</LastModified><Size>${v.length}</Size></Contents>`);
      return reply(200, `<ListBucketResult>${items.join("")}</ListBucketResult>`);
    }
    if (req.method === "GET" && r2.objects.has(key)) return reply(200, r2.objects.get(key));
    reply(404, "<Error><Code>NoSuchKey</Code></Error>");
  });
});
const r2Ready = new Promise((resolve) => r2Server.listen(0, "127.0.0.1", resolve));
const snapshotCount = () => [...r2.objects.keys()].filter((k) => k.startsWith("kapevault/snapshots/")).length;
const launch = () =>
  launchWith({ KAPEVAULT_DATA_DIR: dataDir, KAPEVAULT_R2_ENDPOINT: `http://127.0.0.1:${r2Server.address().port}`, KAPEVAULT_BACKUP_DELAY_MS: "400" });

(async () => {
  await r2Ready;
  let { app, page, errors } = await launch();
  const size = await page.evaluate(() => [innerWidth, innerHeight]);
  const work = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workAreaSize);
  const expected = [Math.min(1440, Math.round(work.width * 0.92)), Math.min(900, Math.round(work.height * 0.92))];
  check("window opens at 1440x900 (clamped to the screen)", Math.abs(size[0] - expected[0]) <= 16 && Math.abs(size[1] - expected[1]) <= 60, `${size.join("x")} vs ${expected.join("x")}`);

  // Create vault
  await page.getByPlaceholder("Master password", { exact: true }).fill("test kettle harbor pass");
  await page.getByPlaceholder("Confirm master password").fill("different");
  await page.getByRole("button", { name: "Continue" }).click();
  check("mismatched confirm shows error", await shows(page.getByText("The two passwords do not match.")));
  await page.getByPlaceholder("Master password", { exact: true }).fill("short");
  await page.getByPlaceholder("Confirm master password").fill("short");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Use at least 12 characters.").waitFor();
  check("short master rejected", true);
  await page.getByPlaceholder("Master password", { exact: true }).fill("test kettle harbor pass");
  await page.getByPlaceholder("Confirm master password").fill("test kettle harbor pass");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Nothing here yet").waitFor({ timeout: 15000 });
  check("create vault opens empty vault", true);
  await page.screenshot({ path: path.join(SHOTS, "e2e-1-empty.png") });

  // Add client
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByPlaceholder("Client name, then Enter").fill("Northwind Studio");
  await page.keyboard.press("Enter");
  await page.locator("aside").getByText("Northwind Studio").waitFor();
  check("add client appears in sidebar", true);
  check("new client is the active space", await shows(page.locator("h2", { hasText: "Northwind Studio" })));

  // New login
  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("GitHub").fill("GHL agency login");
  check("space defaults to current client", (await dialog.locator("select").first().inputValue()) !== "");
  await dialog.getByText("Username or email").locator("..").locator("input").fill("agency@example.com");
  await dialog.getByText("Password", { exact: true }).locator("..").locator("input").fill("Pw-123456!");
  await dialog.getByRole("button", { name: "Show password" }).click();
  check("form show-password toggles to text", (await dialog.getByText("Password", { exact: true }).locator("..").locator("input").getAttribute("type")) === "text");
  await dialog.getByPlaceholder("https://", { exact: true }).fill("https://app.gohighlevel.com");
  check("tags wait under More options", !(await dialog.getByPlaceholder("work, family").isVisible()));
  await dialog.getByRole("button", { name: "More options" }).click();
  await dialog.getByPlaceholder("work, family").fill("ghl, a2p");
  await dialog.locator("textarea").fill("White-label domain for Custom JS.");
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.locator("h1", { hasText: "GHL agency login" }).waitFor();
  check("save login shows it in detail", true);
  check("password masked by default", await gone(page.getByText("Pw-123456!")));

  // Reveal / hide
  await page.getByRole("button", { name: "Reveal" }).click();
  check("reveal shows password", await shows(page.getByText("Pw-123456!")));
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  check("hide masks password", await gone(page.getByText("Pw-123456!")));

  // Copy buttons
  await page.getByRole("button", { name: "Copy password (clears in 30s)" }).click();
  await page.waitForTimeout(200);
  check("copy password puts it on clipboard", (await clip(app)) === "Pw-123456!");
  await page.getByRole("button", { name: "Copy", exact: true }).first().click();
  await page.waitForTimeout(200);
  check("copy username", (await clip(app)) === "agency@example.com");

  // Quick-action pill copies the password too
  await page.getByRole("button", { name: "Copy password", exact: true }).click();
  await page.waitForTimeout(200);
  check("copy password pill", (await clip(app)) === "Pw-123456!");
  check("a copied password is kept out of Windows clipboard history", await app.evaluate(({ clipboard }) => clipboard.has('electron application/osclipboard;format="CanIncludeInClipboardHistory"')));

  // Open website
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.waitForTimeout(200);
  let o = await opened(app);
  check("open website -> browser", o.some(([k, v]) => k === "external" && new URL(v).href === new URL("https://app.gohighlevel.com").href));

  // Favorite
  await page.getByRole("button", { name: "Add to favorites" }).click();
  await page.getByRole("button", { name: "Remove from favorites" }).waitFor();
  await page.locator("aside").getByText("Favorites").click();
  check("favorite shows in Favorites view", await shows(page.locator("section li", { hasText: "GHL agency login" })));
  await page.getByRole("button", { name: "Remove from favorites" }).click();
  check("unfavorite empties Favorites", await shows(page.getByText("Nothing here yet")));
  await page.locator("aside").getByText("All items").click();

  // Edit keeps password
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("dialog").getByPlaceholder("GitHub").fill("GHL agency (edited)");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.locator("h1", { hasText: "GHL agency (edited)" }).waitFor();
  await gone(page.getByRole("dialog"));
  // The save remounted the pane, so the Edit that opened the form is gone: focus finds the new one.
  check("after Edit then Save, focus is back on Edit, not the page", await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Edit"));
  await page.getByRole("button", { name: "Reveal" }).click();
  check("edit keeps stored password", await shows(page.getByText("Pw-123456!")));

  // New file link: real folder + missing folder
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "File link" }).click();
  await page.getByRole("dialog").getByPlaceholder("GitHub").fill("Client folder");
  await page.getByRole("dialog").locator("select").nth(1).selectOption("folder");
  await page.getByRole("dialog").getByPlaceholder(/drive.google.com/).fill(dataDir);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.locator("h1", { hasText: "Client folder" }).waitFor();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.waitForTimeout(200);
  o = await opened(app);
  check("open local folder -> Explorer at its first item", o.some(([k, v]) => k === "reveal" && path.dirname(v) === dataDir));
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("dialog").getByPlaceholder(/drive.google.com/).fill("Z:\\does\\not\\exist");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  check("missing path shows a clear message", await shows(page.getByText(/Could not open/)));

  // Sidebar views + search
  await page.locator("aside").getByText("Logins").click();
  check("Logins view filters", (await page.locator("section li").count()) === 1);
  await page.locator("aside").getByText("File links").click();
  check("File links view filters", (await page.locator("section li").count()) === 1);
  await page.locator("aside").getByText("Personal").click();
  check("Personal space holds the new link (default space)", await shows(page.locator("section li", { hasText: "Client folder" })));
  await page.locator("aside").getByText("All items").click();
  await page.keyboard.press("Control+k");
  check("Ctrl+K focuses search", await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Search logins, links, clients"));
  await page.keyboard.type("northwind a2p");
  check("search by client + tag", (await page.locator("section li").count()) === 1);
  await page.keyboard.press("Escape");
  check("Escape clears search", (await page.locator("section li").count()) === 2);

  // Sheet dismissal
  await page.getByRole("button", { name: "New" }).click();
  await page.keyboard.press("Escape");
  check("Escape closes sheet (after its exit animation)", await gone(page.getByRole("dialog")));
  await page.getByRole("button", { name: "New" }).click();
  await page.mouse.click(30, 450);
  check("scrim click closes sheet", await gone(page.getByRole("dialog")));

  // Settings
  await page.getByRole("button", { name: "Settings" }).click();
  await page.screenshot({ path: path.join(SHOTS, "e2e-2-settings.png") });
  check("settings shows vault path", await shows(page.getByText("vault.kapevault")));
  await page.getByRole("button", { name: "Show file" }).click();
  await page.waitForTimeout(200);
  o = await opened(app);
  check("Show file reveals vault in Explorer", o.some(([k, v]) => k === "reveal" && v.endsWith("vault.kapevault")));
  await page.getByRole("dialog").getByRole("tab", { name: "Security" }).click();
  const pw = page.getByRole("dialog").locator("form", { hasText: "Change master password" }).locator('input[type="password"]');
  await pw.nth(0).fill("wrong current");
  await pw.nth(1).fill("new kettle harbor pass");
  await pw.nth(2).fill("new kettle harbor pass");
  await page.getByRole("button", { name: "Change password" }).click();
  await page.getByRole("alert").filter({ hasText: "Current password is wrong." }).waitFor({ timeout: 15000 }); // announced, not only shown
  check("wrong current master rejected", true);
  await pw.nth(0).fill("test kettle harbor pass");
  await pw.nth(1).fill("new kettle harbor pass");
  await pw.nth(2).fill("new kettle harbor pass");
  await page.getByRole("button", { name: "Change password" }).click();
  await page.getByText("Master password changed.").waitFor({ timeout: 15000 });
  check("change master password", true);
  await page.getByRole("button", { name: "Done" }).click();

  // Delete
  await page.locator("section li", { hasText: "Client folder" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  check("delete asks to confirm", await shows(page.getByRole("button", { name: "Confirm delete" })));
  await page.getByRole("button", { name: "Confirm delete" }).click();
  check("delete removes item", await gone(page.locator("section li", { hasText: "Client folder" })));

  // Lock + unlock (a copied password must not survive the lock)
  await page.getByRole("button", { name: "Copy password (clears in 30s)" }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Lock vault" }).click();
  await page.waitForTimeout(300);
  check("lock clears a copied password from the clipboard", (await clip(app)) === "");
  await page.getByRole("button", { name: "Continue" }).waitFor();
  check("lock returns to unlock screen", true);
  await page.getByPlaceholder("Master password").fill("test kettle harbor pass");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("alert").filter({ hasText: "Wrong master password." }).waitFor({ timeout: 15000 }); // announced, not only shown
  check("old master no longer unlocks", true);
  await page.getByPlaceholder("Master password").fill("new kettle harbor pass");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("h1", { hasText: "GHL agency (edited)" }).waitFor({ timeout: 15000 });
  check("new master unlocks", true);
  await page.screenshot({ path: path.join(SHOTS, "e2e-3-unlocked.png") });

  // Auto-lock event from main
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("vault:locked"));
  check("main-process lock event shows unlock screen", await shows(page.getByRole("button", { name: "Continue" })));
  check("no page errors (session 1)", errors.length === 0, errors.join(" | "));
  await app.close();

  // Restart: data persisted, disk is ciphertext
  const raw = fs.readFileSync(path.join(dataDir, "vault.kapevault"), "utf8");
  check("vault file has no plaintext", !/Pw-123456|GHL agency|Northwind Studio|agency@example/.test(raw));
  ({ app, page, errors } = await launch());
  await page.getByPlaceholder("Master password").fill("new kettle harbor pass");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("h1", { hasText: "GHL agency (edited)" }).waitFor({ timeout: 15000 });
  check("data survives restart", true);

  // Logos: auto-detected from the URL, and picked by hand
  const listIcon = page.locator("section li", { hasText: "GHL agency (edited)" }).locator("img");
  check("GHL logo auto-detected from the URL", (await listIcon.getAttribute("data-brand")) === "gohighlevel");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Auto: GoHighLevel/ }).click();
  await page.getByPlaceholder("Search logos").fill("slack");
  await page.getByRole("dialog").getByRole("button", { name: "Slack", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await gone(page.getByRole("dialog"));
  check("picked logo replaces the detected one", (await listIcon.getAttribute("data-brand")) === "slack");
  check("sheet animates out and unmounts", (await page.getByRole("dialog").count()) === 0);

  // Sign in with Google: no password, linked to the saved Google account
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("dialog").getByPlaceholder("GitHub").fill("Gmail");
  await page.getByRole("dialog").getByText("Username or email").locator("..").locator("input").fill("sam.reyes.mock@gmail.com");
  await page.getByRole("dialog").getByText("Password", { exact: true }).locator("..").locator("input").fill("gmail-pass-1");
  await page.getByRole("dialog").getByPlaceholder("https://", { exact: true }).fill("https://mail.google.com");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await gone(page.getByRole("dialog"));
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("dialog").getByPlaceholder("GitHub").fill("Facebook");
  await page.getByRole("dialog").getByText("Username or email").locator("..").locator("input").fill("me@example.com");
  await page.getByRole("dialog").getByPlaceholder("https://", { exact: true }).fill("https://www.facebook.com");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await gone(page.getByRole("dialog"));
  await page.getByRole("button", { name: "New" }).click();
  const oauth = page.getByRole("dialog");
  await oauth.getByPlaceholder("GitHub").fill("Canva");
  await oauth.getByRole("radio", { name: "Google", exact: true }).click();
  check("oauth hides the password field", await gone(oauth.locator("label > span", { hasText: /^Password$/ })));
  const googleAccounts = await oauth.locator("select").nth(1).locator("option").allTextContents();
  check("Google account list leaves out the Facebook login", googleAccounts.some((t) => t.startsWith("Gmail")) && !googleAccounts.some((t) => t.startsWith("Facebook")), googleAccounts.join(" | "));
  await oauth.locator("select").nth(1).selectOption({ label: "Gmail - sam.reyes.mock@gmail.com" });
  check("picking the account fills the email", (await oauth.getByText("Email or username on Google").locator("..").locator("input").inputValue()) === "sam.reyes.mock@gmail.com");
  await oauth.getByPlaceholder("https://", { exact: true }).fill("https://www.canva.com");
  await oauth.getByRole("button", { name: "Save" }).click();
  await page.locator("h1", { hasText: "Canva" }).waitFor();
  check("detail shows Sign in with Google", await shows(page.getByText("Google sign-in")));
  check("no password row for an oauth login", await gone(page.getByRole("button", { name: "Reveal" })));
  await page.getByRole("button", { name: "Go to account" }).click();
  check("Go to account jumps to the Gmail item", await shows(page.locator("h1", { hasText: "Gmail" })));
  await page.getByLabel("Search logins, links, clients").fill("google sign");
  check("search finds logins by sign-in method", await shows(page.locator("section li", { hasText: "Canva" })));
  await page.getByLabel("Search logins, links, clients").fill("");

  // Folder browser + previews on a sample folder
  const sample = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-files-"));
  fs.mkdirSync(path.join(sample, "Contracts"));
  fs.writeFileSync(path.join(sample, "Contracts", "nda.txt"), "Signed 2026");
  fs.writeFileSync(path.join(sample, "a-logo.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwnwEIGBgY/jMwAAAgBQH+FdVhjQAAAABJRU5ErkJggg==", "base64"));
  fs.writeFileSync(path.join(sample, "b-notes.md"), "# Launch plan\n\n- ship it\n\n![logo](a-logo.png)\n");
  fs.writeFileSync(path.join(sample, "c-leads.csv"), 'name,email\n"Doe, Jan",jan@example.com\nSam,sam@example.com\n');
  fs.writeFileSync(
    path.join(sample, "d-page.html"),
    "<h1 id=t>Artifact page</h1><p id=n>net pending</p><script>document.getElementById('t').textContent='Script ran';" +
      "fetch('https://example.com').then(()=>{document.getElementById('n').textContent='net leaked'},()=>{document.getElementById('n').textContent='net blocked'})</script>" +
      // WebRTC ignores CSP: a public (srflx/relay) ICE candidate would mean the page can reach out.
      "<p id=w>rtc pending</p><script>try{const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});pc.createDataChannel('x');" +
      "let out=false;pc.onicecandidate=(e)=>{if(e.candidate&&/ (srflx|relay) /.test(e.candidate.candidate))out=true};pc.createOffer().then((o)=>pc.setLocalDescription(o));" +
      "setTimeout(()=>{document.getElementById('w').textContent=out?'rtc leaked':'rtc blocked'},4000)}catch(e){document.getElementById('w').textContent='rtc blocked'}</script>",
  );
  // A real PDF: print the app's own window.
  const pdfBytes = await app.evaluate(async ({ BrowserWindow }) => Array.from(await BrowserWindow.getAllWindows()[0].webContents.printToPDF({})));
  fs.writeFileSync(path.join(sample, "e-report.pdf"), Buffer.from(pdfBytes));
  fs.writeFileSync(path.join(sample, "f-proposal.docx"), "not really a docx");
  fs.writeFileSync(path.join(sample, "g-setup.exe"), "MZ");
  // Taller than any window: it was cut off with no way to scroll.
  const poster = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 2400;
    const x = c.getContext("2d");
    x.fillStyle = "#dddddd";
    x.fillRect(0, 0, 800, 2400);
    return c.toDataURL("image/png").split(",")[1];
  });
  fs.writeFileSync(path.join(sample, "h-poster.png"), Buffer.from(poster, "base64"));
  // 0.1s of 8 kHz 8-bit silence: a real audio file, so the preview draws its controls.
  const wav = Buffer.alloc(844, 0x80);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(836, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(800, 40);
  fs.writeFileSync(path.join(sample, "i-chime.wav"), wav);

  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "File link" }).click();
  await page.getByRole("dialog").getByPlaceholder("GitHub").fill("Sample files");
  await page.getByRole("dialog").locator("select").nth(1).selectOption("folder");
  await page.getByRole("dialog").getByPlaceholder(/drive.google.com/).fill(sample);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.locator("h1", { hasText: "Sample files" }).waitFor();
  const grid = page.locator("main li");
  await grid.first().waitFor();
  check("folder grid lists folders first, then files", (await grid.first().innerText()).includes("Contracts") && (await grid.count()) === 10);
  const thumb = grid.filter({ hasText: "a-logo.png" }).locator("img");
  // The grid shows before its thumbnails load: wait for this one to finish either way.
  const thumbLoaded = await thumb.evaluate((i) => (i.complete ? i.naturalWidth > 0 : new Promise((done) => {
    i.addEventListener("load", () => done(i.naturalWidth > 0), { once: true });
    i.addEventListener("error", () => done(false), { once: true });
  })));
  check("image thumbnail loads through kapevault-file", thumbLoaded);

  await grid.filter({ hasText: "Contracts" }).click();
  await grid.filter({ hasText: "nda.txt" }).waitFor();
  check("click a folder opens it", (await grid.count()) === 1);
  await page.getByRole("button", { name: "Back" }).click();
  await grid.filter({ hasText: "a-logo.png" }).waitFor();
  check("back returns to the parent", (await grid.count()) === 10);

  const preview = page.getByRole("dialog");
  await grid.filter({ hasText: "a-logo.png" }).click();
  check("image preview renders", await preview.locator("img").evaluate((i) => new Promise((ok) => (i.complete ? ok(i.naturalWidth > 0) : i.addEventListener("load", () => ok(i.naturalWidth > 0))))));
  await page.keyboard.press("ArrowRight");
  const md = preview.frameLocator("iframe");
  check("arrow key steps to markdown, rendered as a document", await shows(md.locator("h1", { hasText: "Launch plan" })));
  check("markdown takes its colours from the tokens (paper stays light: Classic ink)", (await md.locator("body").evaluate((b) => getComputedStyle(b).color)) === "rgb(29, 29, 31)");
  check("markdown's relative image loads from beside the file", await md.locator("img").evaluate((i) => new Promise((ok) => (i.complete ? ok(i.naturalWidth > 0) : (i.onload = () => ok(i.naturalWidth > 0), i.onerror = () => ok(false))))));
  await page.keyboard.press("ArrowRight");
  check("csv renders as a table with quoted cells", await shows(preview.locator("td", { hasText: "Doe, Jan" })));
  await page.keyboard.press("ArrowRight");
  check("html opens with its scripts off", await shows(preview.frameLocator("iframe").locator("h1", { hasText: "Artifact page" })));
  await preview.getByRole("button", { name: "Run scripts" }).click();
  check("Run scripts runs it like an artifact (sandboxed)", await shows(preview.frameLocator("iframe").locator("h1", { hasText: "Script ran" })));
  check("html preview cannot reach the network", await shows(preview.frameLocator("iframe").locator("#n", { hasText: "net blocked" })));
  check("nor through WebRTC", await shows(preview.frameLocator("iframe").locator("#w", { hasText: "rtc blocked" }), 8000));
  check("the page's own traffic goes to a proxy that does not exist", (await app.evaluate(({ session }) => session.defaultSession.resolveProxy("https://example.com"))).includes("127.0.0.1:9"));
  await page.keyboard.press("ArrowRight");
  // The built-in PDF viewer loads async as its own frame - wait for it, don't just check the iframe exists.
  const pdfViewer = await page.waitForEvent("framenavigated", { predicate: (f) => f.url().startsWith("chrome-extension://"), timeout: 8000 }).then(() => true, () => page.frames().some((f) => f.url().startsWith("chrome-extension://")));
  check("pdf loads in the built-in PDF viewer", pdfViewer);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, "e2e-4-pdf.png") });
  await page.keyboard.press("ArrowRight");
  await preview.getByRole("button", { name: "Open in Word" }).first().click();
  await page.waitForTimeout(200);
  check("docx opens in its default app", (await opened(app)).some(([k, v]) => k === "path" && v.endsWith("f-proposal.docx")));
  await page.keyboard.press("ArrowRight");
  await preview.getByRole("button", { name: /Open in/ }).first().click();
  await page.waitForTimeout(200);
  const o2 = await opened(app);
  check("exe is revealed, never run", o2.some(([k, v]) => k === "reveal" && v.endsWith("g-setup.exe")) && !o2.some(([k, v]) => k === "path" && v.endsWith(".exe")));
  await page.keyboard.press("ArrowRight");
  const fitView = preview.locator("[data-image-view=fit]");
  await fitView.locator("img").evaluate((i) => new Promise((ok) => (i.complete ? ok() : i.addEventListener("load", ok))));
  check("a tall image fits the preview whole", await fitView.evaluate((box) => {
    const img = box.querySelector("img");
    const b = box.getBoundingClientRect();
    const r = img.getBoundingClientRect();
    return img.naturalHeight > b.height && r.top >= b.top && r.bottom <= b.bottom + 0.5;
  }));
  await fitView.locator("img").click();
  const actualView = preview.locator("[data-image-view=actual]");
  check("clicking it shows actual size, scrolling to its bottom edge", await actualView.evaluate(async (box) => {
    box.scrollTop = box.scrollHeight;
    await new Promise((r) => requestAnimationFrame(r));
    const img = box.querySelector("img");
    return box.scrollHeight > box.clientHeight && box.scrollTop > 0 && img.getBoundingClientRect().bottom <= box.getBoundingClientRect().bottom + 1;
  }));
  await actualView.locator("img").click();
  check("clicking again fits it back", await shows(fitView));
  await page.keyboard.press("ArrowRight");
  const audio = preview.locator("audio");
  await audio.waitFor();
  await preview.getByRole("button", { name: "Close preview" }).focus();
  await page.keyboard.press("Tab");
  check("Tab from Close preview reaches the audio's controls", await audio.evaluate((a) => document.activeElement === a));
  await preview.getByRole("button", { name: "Close preview" }).click();
  await gone(page.getByRole("dialog"));
  await grid.first().waitFor();
  await page.screenshot({ path: path.join(SHOTS, "e2e-5-grid.png") });

  // The page cannot read outside linked folders
  const escape = await page.evaluate(async (root) => {
    const tryList = (r, rel) => window.kapevault.listFolder(r, rel).then(() => "allowed", () => "blocked");
    const readOutside = await window.kapevault.readText("C:\\Windows\\win.ini").then(() => "allowed", () => "blocked");
    return [await tryList(root, ".."), await tryList("C:\\Windows", ""), readOutside];
  }, sample);
  check("listing above a linked folder is blocked", escape[0] === "blocked");
  check("listing an unlinked folder is blocked", escape[1] === "blocked");
  check("reading a file outside linked folders is blocked", escape[2] === "blocked");
  const protoOutside = await app.evaluate(({ net }) => net.fetch("kapevault-file://local/C%3A/Windows/win.ini").then((r) => r.status));
  check("protocol refuses files outside linked folders", protoOutside === 403, String(protoOutside));

  // A junction inside a linked folder must not become a door to the rest of the disk.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "kapevault-outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "nope");
  fs.symlinkSync(outside, path.join(sample, "jump"), "junction");
  const viaJunction = `kapevault-file://local/${path.join(sample, "jump", "secret.txt").split(/[\\/]/).map(encodeURIComponent).join("/")}`;
  check("junction to outside is refused", (await app.evaluate(({ net }, u) => net.fetch(u).then((r) => r.status), viaJunction)) === 403);

  // Shortcuts and scripts are revealed, never launched.
  fs.writeFileSync(path.join(sample, "h-link.url"), "[InternetShortcut]\nURL=file:///C:/Windows/notepad.exe\n");
  const urlResult = await page.evaluate((p) => window.kapevault.openFile(p), path.join(sample, "h-link.url"));
  check(".url shortcut is revealed, not opened", urlResult === "revealed");

  await page.getByRole("button", { name: "Lock vault" }).click();
  await page.getByRole("button", { name: "Continue" }).waitFor();
  const lockedUrl = `kapevault-file://local/${sample.split(/[\\/]/).map(encodeURIComponent).join("/")}/b-notes.md`;
  const lockedFetch = await app.evaluate(({ net }, u) => net.fetch(u).then((r) => r.status), lockedUrl);
  check("protocol serves nothing while locked", lockedFetch === 403, String(lockedFetch));

  // The HTML fixture's blocked fetch to example.com is the expected CSP refusal, not an app error.
  const appErrors = errors.filter((e) => !e.includes("example.com"));
  check("no page errors (session 2)", appErrors.length === 0, appErrors.join(" | "));
  await app.close();

  // Session 3: cloud backup to (fake) R2 - connect, back up, auto backup, restore, disconnect.
  const vaultFile = path.join(dataDir, "vault.kapevault");
  const unlock = async () => {
    await page.getByPlaceholder("Master password").fill("new kettle harbor pass");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Lock vault" }).waitFor({ timeout: 15000 });
  };
  ({ app, page, errors } = await launch());
  check("lock screen offers Restore from backup", await shows(page.getByRole("button", { name: "Restore from backup" })));
  await unlock();
  // Nothing backs this vault up yet: one quiet line where the sync line goes, and a row in Settings.
  const noBackupLine = page.locator("[data-sync-line]").filter({ hasText: "No backup yet" });
  check("no backup: the line under the list says so", await shows(noBackupLine));
  await page.getByRole("button", { name: "Settings" }).click();
  const sheet = page.getByRole("dialog");
  await page.getByRole("dialog").getByRole("tab", { name: "Backup" }).click();
  const noBackupRow = sheet.getByText("No backup yet");
  check("no backup: Settings > Backup says so", await shows(noBackupRow));
  const shots = path.join(os.tmpdir(), "kapevault-recovery-shots");
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, "pc-backup-no-backup.png") });

  // Keep a copy in a folder: picked in main's dialog (stubbed), refused for a network path by name.
  const pickFolder = (p) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, p);
  const copyOf = (dir) => path.join(dir, "KAPEVault backup.kapevault");
  const [folderA, folderB, folderTheirs] = ["a", "b", "theirs"].map((n) => fs.mkdtempSync(path.join(os.tmpdir(), `kapevault-copy-${n}-`)));
  await pickFolder("\\\\mock-host\\share");
  await sheet.getByRole("button", { name: "Choose folder..." }).click();
  check("a network folder is refused", await shows(sheet.getByText("Network folders cannot be used", { exact: false })));
  // Another vault's copy (this file under another key) is never overwritten, e.g. a dead PC's only one.
  const theirs = JSON.parse(fs.readFileSync(vaultFile, "utf8"));
  theirs.kdf.salt = Buffer.alloc(16, 7).toString("base64");
  fs.writeFileSync(copyOf(folderTheirs), JSON.stringify(theirs));
  const theirBytes = fs.readFileSync(copyOf(folderTheirs));
  await pickFolder(folderTheirs);
  await sheet.getByRole("button", { name: "Choose folder..." }).click();
  check("a folder holding another vault's copy is refused", await shows(sheet.getByText("That folder holds a copy of a different vault", { exact: false })));
  check("another vault's copy is left as it was", fs.readFileSync(copyOf(folderTheirs)).equals(theirBytes));
  await pickFolder(folderA);
  await sheet.getByRole("button", { name: "Choose folder..." }).click();
  check("Choose folder copies the vault file as it is", await waitFor(() => fs.existsSync(copyOf(folderA)) && fs.readFileSync(copyOf(folderA)).equals(fs.readFileSync(vaultFile))));
  check("the Forever Opener goes beside the copy", fs.existsSync(path.join(folderA, "KAPEVault Opener.html")));
  check("the folder row shows the folder and its last copy", (await shows(sheet.getByTitle(folderA))) && (await shows(sheet.getByText(/^Last copy /))));
  check("No backup yet is gone once a folder is set", await gone(noBackupRow));
  check("settings.json holds the folder's path", JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8")).copyFolder === folderA);
  await page.screenshot({ path: path.join(shots, "pc-backup-folder.png") });
  await pickFolder(folderB);
  await sheet.getByRole("button", { name: "Change folder..." }).click();
  check("Change folder copies into the new folder", (await shows(sheet.getByTitle(folderB))) && fs.existsSync(copyOf(folderB)));
  await sheet.getByRole("button", { name: "Done" }).click();
  await gone(sheet);
  check("with a folder set, the line under the list does not nag", await gone(noBackupLine));
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByPlaceholder("Client name, then Enter").fill("Folder Probe");
  const vaultBefore = fs.readFileSync(vaultFile);
  await page.keyboard.press("Enter");
  await waitFor(() => !fs.readFileSync(vaultFile).equals(vaultBefore));
  check("a change is not copied before the pause", !fs.readFileSync(copyOf(folderB)).equals(fs.readFileSync(vaultFile)));
  check("a change is copied into the folder after the pause", await waitFor(() => fs.readFileSync(copyOf(folderB)).equals(fs.readFileSync(vaultFile))));
  const copiedBefore = fs.readFileSync(copyOf(folderB));
  await page.evaluate(async () => {
    await window.kapevault.addSpace("Lock Probe");
    await window.kapevault.lock(); // well inside the 400 ms pause
  });
  check("a lock writes the waiting copy at once", !copiedBefore.equals(fs.readFileSync(vaultFile)) && fs.readFileSync(copyOf(folderB)).equals(fs.readFileSync(vaultFile)));
  const stoppedLocked = await page.evaluate(() => window.kapevault.stopFolder());
  check("Turn off is refused while locked", stoppedLocked.ok === false && JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8")).copyFolder === folderB);
  await unlock();
  // A waiting copy that throws on the way out (here its status broadcast) never stops the lock.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const send = w.webContents.send.bind(w.webContents);
      w.webContents.send = (channel, ...args) => {
        if (channel === "backup:folder") throw new Error("mock broadcast failure");
        send(channel, ...args);
      };
    }
  });
  const lockError = await page.evaluate(async () => {
    await window.kapevault.addSpace("Throw Probe");
    try {
      await window.kapevault.lock();
      return "";
    } catch (e) {
      return String(e);
    }
  });
  check("a folder copy that throws on lock still locks the vault", lockError === "" && (await shows(page.getByPlaceholder("Master password"))), lockError);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => delete w.webContents.send));
  await unlock();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog").getByRole("tab", { name: "Backup" }).click();
  await sheet.getByRole("button", { name: "Turn off" }).click();
  check("Turn off forgets the folder and leaves its copy", (await shows(sheet.getByRole("button", { name: "Choose folder..." }))) && fs.existsSync(copyOf(folderB)) && !("copyFolder" in JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8"))));
  check("with nothing backing up, No backup yet is back", await shows(noBackupRow));
  const urlField = sheet.getByPlaceholder("https://<account-id>.r2.cloudflarestorage.com/<bucket>");
  const keyField = sheet.getByText("Access key ID").locator("..").locator("input");
  const secretField = sheet.getByText("Secret access key").locator("..").locator("input");
  await urlField.fill("https://example.com/kapevault-e2e");
  await keyField.fill("e2e-key-id");
  await secretField.fill("e2e-secret-value");
  await sheet.getByRole("button", { name: "Connect" }).click();
  check("a non-R2 URL is rejected", await shows(sheet.getByText("Paste the bucket's S3 API URL", { exact: false })));
  await urlField.fill("https://0123abcd.r2.cloudflarestorage.com/kapevault-e2e");
  await keyField.fill("wrong-key");
  await sheet.getByRole("button", { name: "Connect" }).click();
  check("wrong keys are refused with R2's reason", await shows(sheet.getByText("R2 refused the keys", { exact: false })));
  check("refused keys are not saved and nothing is uploaded", snapshotCount() === 0 && (await sheet.getByRole("button", { name: "Connect" }).isVisible()));
  await keyField.fill("e2e-key-id");
  await sheet.getByRole("button", { name: "Connect" }).click();
  check("Connect backs up straight away", await shows(sheet.getByText("Last backup", { exact: false })));
  check("connected to R2, No backup yet is gone", await gone(noBackupRow));
  check("one snapshot in the bucket", snapshotCount() === 1, String(snapshotCount()));
  const uploaded = [...r2.objects.values()][0];
  check("the upload is the encrypted vault file byte for byte", uploaded.equals(fs.readFileSync(vaultFile)));
  check("the upload has no plaintext", !/Pw-123456|GHL agency|Northwind Studio|e2e-secret-value/.test(uploaded.toString("utf8")));
  check("every R2 request was carried by the system curl (the Air Wall courier)", r2.agents.size > 0 && [...r2.agents].every((a) => /^curl\//.test(a)), [...r2.agents].join(", "));
  const statusJson = JSON.stringify(await page.evaluate(() => window.kapevault.cloudStatus()));
  check("the R2 secret never reaches the page", !statusJson.includes("e2e-secret-value") && !(await page.content()).includes("e2e-secret-value"));
  check("vault file on disk does not hold the R2 secret in clear", !fs.readFileSync(vaultFile, "utf8").includes("e2e-secret-value"));
  await sheet.getByRole("button", { name: "Back up now" }).click();
  check("Back up now adds a snapshot", await waitFor(() => snapshotCount() === 2));
  check("backup list shows both", await shows(sheet.getByRole("list", { name: "Backups" }).locator("li").nth(1)));
  await page.screenshot({ path: path.join(SHOTS, "e2e-6-cloud.png") });

  // Emergency Kit: the page it is printed from carries Add a phone's QR code only with the keys ticked.
  await app.evaluate(({ app: a, dialog: d }, f) => {
    globalThis.__printed = [];
    a.on("browser-window-created", (_e, w) => w.webContents.on("did-finish-load", () => globalThis.__printed.push(decodeURIComponent(w.webContents.getURL()))));
    d.showSaveDialog = async () => ({ canceled: false, filePath: f });
  }, path.join(shots, "mock-kit.pdf"));
  const printed = () => app.evaluate(() => globalThis.__printed);
  const saveKit = async (n) => {
    await sheet.getByRole("button", { name: "Save Emergency Kit..." }).click();
    await waitFor(async () => (await printed()).length === n, 10000);
    return (await printed())[n - 1] ?? "";
  };
  const plainKit = await saveKit(1);
  check("a kit without the keys has no QR code and no secret", plainKit.includes("KAPEVault Emergency Kit") && plainKit.includes("e2e-key-id") && !plainKit.includes('class="qr"') && !plainKit.includes("e2e-secret-value"));
  await sheet.getByRole("checkbox", { name: /Include the R2 keys/ }).check();
  const keysKit = await saveKit(2);
  check("a kit with the keys prints one QR code", (keysKit.match(/class="qr"/g) ?? []).length === 1 && keysKit.includes("e2e-secret-value"));
  await sheet.getByRole("checkbox", { name: /Include the R2 keys/ }).uncheck();
  await sheet.getByRole("button", { name: "Done" }).click();
  await gone(page.getByRole("dialog"));

  // Auto backup after a change
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByPlaceholder("Client name, then Enter").fill("Restore Probe");
  await page.keyboard.press("Enter");
  await page.locator("aside").getByText("Restore Probe").waitFor();
  check("a change is backed up automatically", await waitFor(() => snapshotCount() === 3));

  // Auto backup off: a change stays local
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog").getByRole("tab", { name: "Backup" }).click();
  const autoSwitch = sheet.getByRole("switch", { name: "Back up automatically" });
  await autoSwitch.click();
  check("auto backup switch turns off", await shows(sheet.getByRole("switch", { name: "Back up automatically", checked: false })));
  await sheet.getByRole("button", { name: "Done" }).click();
  await gone(page.getByRole("dialog"));
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByPlaceholder("Client name, then Enter").fill("Local Only");
  await page.keyboard.press("Enter");
  await page.locator("aside").getByText("Local Only").waitFor();
  await page.waitForTimeout(1200);
  check("with auto off, a change is not uploaded", snapshotCount() === 3, String(snapshotCount()));

  // Restore the oldest snapshot (made at Connect, before "Restore Probe" existed)
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog").getByRole("tab", { name: "Backup" }).click();
  const rows = sheet.getByRole("list", { name: "Backups" }).locator("li");
  await rows.nth(2).waitFor();
  await rows.last().getByRole("button", { name: "Restore" }).click();
  const backupPassword = rows.last().getByLabel("Master password for this backup");
  await backupPassword.fill("not the right password");
  await rows.last().getByRole("button", { name: "Confirm restore" }).click();
  check("a wrong backup password is refused", await shows(sheet.getByText("Wrong master password for that backup.")));
  check("a refused restore uploads nothing and changes nothing", ![...r2.objects.keys()].some((k) => k.includes("before-restore")) && (await page.locator("aside").getByText("Restore Probe").isVisible()));
  await backupPassword.fill("new kettle harbor pass");
  await rows.last().getByRole("button", { name: "Confirm restore" }).click();
  check("restore opens the restored vault straight away", await shows(sheet.getByText(/^Backup restored\. The vault it replaced is in your cloud backups/)));
  check("the current vault was backed up before the restore", [...r2.objects.keys()].some((k) => k.includes("before-restore")));
  check("snapshots are named per install", [...r2.objects.keys()].filter((k) => !k.startsWith("kapevault/opener/")).every((k) => /^kapevault\/snapshots\/[0-9a-f-]{36}\//.test(k)));
  await sheet.getByRole("button", { name: "Done" }).click();
  await gone(page.getByRole("dialog"));
  check("restored vault is the old one", await gone(page.locator("aside").getByText("Restore Probe")));

  // After a master password change, older backups (openable with the old password) can be deleted.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog").getByRole("tab", { name: "Security" }).click();
  const masterForm = sheet.locator("form", { hasText: "Change master password" }).locator('input[type="password"]');
  await masterForm.nth(0).fill("new kettle harbor pass");
  await masterForm.nth(1).fill("new kettle harbor pass");
  await masterForm.nth(2).fill("new kettle harbor pass");
  await sheet.getByRole("button", { name: "Change password" }).click();
  await sheet.getByText("Master password changed.").waitFor({ timeout: 15000 });
  check("password change offers to delete older backups", await shows(sheet.getByRole("button", { name: "Delete older backups" })));
  // Leaving the Security tab must not lose the offer: it stays under Cloud backup until done.
  await page.getByRole("dialog").getByRole("tab", { name: "Backup" }).click();
  check("the offer stays under Cloud backup", await shows(sheet.getByRole("button", { name: "Delete older backups" })));
  await sheet.getByRole("button", { name: "Delete older backups" }).click();
  check("deleting older backups asks to confirm", await shows(sheet.getByRole("button", { name: "Confirm delete" })) && snapshotCount() > 1);
  await sheet.getByRole("button", { name: "Confirm delete" }).click();
  check("older backups deleted, one fresh backup left", (await shows(sheet.getByText("older backups. A fresh one", { exact: false }))) && snapshotCount() === 1, String(snapshotCount()));

  // Disconnect
  await page.getByRole("dialog").getByRole("tab", { name: "Backup" }).click();
  await sheet.getByRole("button", { name: "Disconnect" }).click();
  check("Disconnect forgets the bucket", await shows(sheet.getByRole("button", { name: "Connect" })));
  await sheet.getByRole("button", { name: "Done" }).click();
  check("no page errors (session 3)", errors.length === 0, errors.join(" | "));
  await app.close();

  // New PC: no vault file at all, restore from the lock screen with typed-in keys.
  fs.rmSync(vaultFile);
  const before = snapshotCount();
  ({ app, page, errors } = await launch());
  await page.getByPlaceholder("Confirm master password").waitFor();
  await page.getByRole("button", { name: "Restore from backup" }).click();
  const restoreSheet = page.getByRole("dialog");
  await restoreSheet.getByPlaceholder("https://<account-id>.r2.cloudflarestorage.com/<bucket>").fill("https://0123abcd.r2.cloudflarestorage.com/kapevault-e2e");
  await restoreSheet.getByText("Access key ID").locator("..").locator("input").fill("e2e-key-id");
  await restoreSheet.getByText("Secret access key").locator("..").locator("input").fill("e2e-secret-value");
  await restoreSheet.getByRole("button", { name: "Find backups" }).click();
  const found = restoreSheet.getByRole("list", { name: "Backups" }).locator("li");
  check("lock screen lists the bucket's backups", await shows(found));
  await page.screenshot({ path: path.join(SHOTS, "e2e-7-restore.png") });
  await found.first().getByRole("button", { name: "Restore" }).click();
  await found.first().getByLabel("Master password for this backup").fill("new kettle harbor pass");
  await found.first().getByRole("button", { name: "Confirm restore" }).click();
  check("restore on a new PC opens the restored vault", await shows(page.getByRole("button", { name: "Lock vault" }), 15000));
  check("nothing to back up first on a new PC", snapshotCount() === before);

  // Import: a picked .json file adds a client + items, then the file is deleted.
  const importFile = path.join(os.tmpdir(), `kapevault-import-e2e-${Date.now()}.json`);
  const importBody = JSON.stringify({
    format: "kapevault-import",
    version: 1,
    entries: [
      { space: "Import Client", kind: "login", title: "Imported login", username: "who@example.com", password: "imported-secret-9", url: "https://example.com" },
      { space: "Import Client", kind: "link", title: "Imported folder", linkType: "folder", location: sample },
    ],
  });
  const pickFile = (p) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, p);
  fs.writeFileSync(importFile, importBody);
  await pickFile(importFile);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog").getByRole("tab", { name: "Import" }).click();
  await page.getByRole("button", { name: "Import file..." }).click();
  check("import adds the items", await shows(page.getByText("Added 2 items. The import file was deleted.")));
  check("import file is deleted afterwards", !fs.existsSync(importFile));
  fs.writeFileSync(importFile, importBody);
  await page.getByRole("button", { name: "Import file..." }).click();
  check("importing again skips what is already there", await shows(page.getByText("Added 0 items, skipped 2 already in the vault.", { exact: false })));
  fs.writeFileSync(importFile, "{ not json");
  await page.getByRole("button", { name: "Import file..." }).click();
  check("a non-import file is refused and kept", (await shows(page.getByText("That file is not a KAPEVault import file."))) && fs.existsSync(importFile));
  fs.rmSync(importFile, { force: true });
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await gone(page.getByRole("dialog"));
  check("imported client shows in the sidebar", await shows(page.locator("aside").getByText("Import Client")));
  check("imported password stays out of the page", !(await page.content()).includes("imported-secret-9"));
  check("no page errors (new PC restore)", errors.length === 0, errors.join(" | "));
  await app.close();
  r2Server.closeAllConnections();
  r2Server.close();

  fs.rmSync(sample, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
  for (const dir of [folderA, folderB, folderTheirs]) fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(path.join(shots, "mock-kit.pdf"), { force: true }); // it holds the mock R2 secret
  console.log(results.join("\n"));
  console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
  process.exitCode = results.every((r) => r.startsWith("PASS")) ? 0 : 1; // a FAIL stops `npm run e2e`, as the other suites do
})().catch((e) => {
  console.log(results.join("\n"));
  console.log("CRASH:", e.message.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
});
