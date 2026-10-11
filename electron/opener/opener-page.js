// The Forever Opener page: pick a vault file, type its master password, read every item. Read only:
// nothing is stored and nothing leaves the page (its CSP blocks every request). checkOpenerFile, isNewerFile and
// openVault come from opener-crypto.cjs, inlined just above this script by opener.cjs (after core/scrypt.js).

// Phosphor icons, bold for actions and fill for item tiles - the same set and weights as the app.
const ICONS = {
  eye: "M251,123.13c-.37-.81-9.13-20.26-28.48-39.61C196.63,57.67,164,44,128,44S59.37,57.67,33.51,83.52C14.16,102.87,5.4,122.32,5,123.13a12.08,12.08,0,0,0,0,9.75c.37.82,9.13,20.26,28.49,39.61C59.37,198.34,92,212,128,212s68.63-13.66,94.48-39.51c19.36-19.35,28.12-38.79,28.49-39.61A12.08,12.08,0,0,0,251,123.13Zm-46.06,33C183.47,177.27,157.59,188,128,188s-55.47-10.73-76.91-31.88A130.36,130.36,0,0,1,29.52,128,130.45,130.45,0,0,1,51.09,99.89C72.54,78.73,98.41,68,128,68s55.46,10.73,76.91,31.89A130.36,130.36,0,0,1,226.48,128,130.45,130.45,0,0,1,204.91,156.12ZM128,84a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,84Zm0,64a20,20,0,1,1,20-20A20,20,0,0,1,128,148Z",
  eyeSlash: "M56.88,31.93A12,12,0,1,0,39.12,48.07l16,17.65C20.67,88.66,5.72,121.58,5,123.13a12.08,12.08,0,0,0,0,9.75c.37.82,9.13,20.26,28.49,39.61C59.37,198.34,92,212,128,212a131.34,131.34,0,0,0,51-10l20.09,22.1a12,12,0,0,0,17.76-16.14ZM128,188c-29.59,0-55.47-10.73-76.91-31.88A130.69,130.69,0,0,1,29.52,128c5.27-9.31,18.79-29.9,42-44.29l90.09,99.11A109.33,109.33,0,0,1,128,188Zm123-55.12c-.36.81-9,20-28,39.16a12,12,0,1,1-17-16.9A130.48,130.48,0,0,0,226.48,128a130.36,130.36,0,0,0-21.57-28.12C183.46,78.73,157.59,68,128,68c-3.35,0-6.7.14-10,.42a12,12,0,1,1-2-23.91c3.93-.34,8-.51,12-.51,36,0,68.63,13.67,94.49,39.52,19.35,19.35,28.11,38.8,28.48,39.61A12.08,12.08,0,0,1,251,132.88Z",
  copy: "M216,28H88A12,12,0,0,0,76,40V76H40A12,12,0,0,0,28,88V216a12,12,0,0,0,12,12H168a12,12,0,0,0,12-12V180h36a12,12,0,0,0,12-12V40A12,12,0,0,0,216,28ZM156,204H52V100H156Zm48-48H180V88a12,12,0,0,0-12-12H100V52H204Z",
  magnifyingGlass: "M232.49,215.51,185,168a92.12,92.12,0,1,0-17,17l47.53,47.54a12,12,0,0,0,17-17ZM44,112a68,68,0,1,1,68,68A68.07,68.07,0,0,1,44,112Z",
  downloadSimple: "M228,144v64a12,12,0,0,1-12,12H40a12,12,0,0,1-12-12V144a12,12,0,0,1,24,0v52H204V144a12,12,0,0,1,24,0Zm-108.49,8.49a12,12,0,0,0,17,0l40-40a12,12,0,0,0-17-17L140,115V32a12,12,0,0,0-24,0v83L96.49,95.51a12,12,0,0,0-17,17Z",
  lockSimple: "M208,76H180V56A52,52,0,0,0,76,56V76H48A20,20,0,0,0,28,96V208a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V96A20,20,0,0,0,208,76ZM100,56a28,28,0,0,1,56,0V76H100ZM204,204H52V100H204Z",
  fileArrowUp: "M216.49,79.52l-56-56A12,12,0,0,0,152,20H56A20,20,0,0,0,36,40V216a20,20,0,0,0,20,20H200a20,20,0,0,0,20-20V88A12,12,0,0,0,216.49,79.52ZM183,80H160V57ZM60,212V44h76V92a12,12,0,0,0,12,12h48V212Zm100.49-72.49a12,12,0,0,1-17,17L140,153v31a12,12,0,0,1-24,0V153l-3.51,3.52a12,12,0,0,1-17-17l24-24a12,12,0,0,1,17,0Z",
  warningCircle: "M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,192a84,84,0,1,1,84-84A84.09,84.09,0,0,1,128,212Zm-12-80V80a12,12,0,0,1,24,0v52a12,12,0,0,1-24,0Zm28,40a16,16,0,1,1-16-16A16,16,0,0,1,144,172Z",
  caretRight: "M184.49,136.49l-80,80a12,12,0,0,1-17-17L159,128,87.51,56.49a12,12,0,1,1,17-17l80,80A12,12,0,0,1,184.49,136.49Z",
  key: "M216.57,39.43A80,80,0,0,0,83.91,120.78L28.69,176A15.86,15.86,0,0,0,24,187.31V216a16,16,0,0,0,16,16H72a8,8,0,0,0,8-8V208H96a8,8,0,0,0,8-8V184h16a8,8,0,0,0,5.66-2.34l9.56-9.57A79.73,79.73,0,0,0,160,176h.1A80,80,0,0,0,216.57,39.43ZM180,92a16,16,0,1,1,16-16A16,16,0,0,1,180,92Z",
  notePencil: "M224,128v80a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32h80a8,8,0,0,1,0,16H48V208H208V128a8,8,0,0,1,16,0Zm5.66-58.34-96,96A8,8,0,0,1,128,168H96a8,8,0,0,1-8-8V128a8,8,0,0,1,2.34-5.66l96-96a8,8,0,0,1,11.32,0l32,32A8,8,0,0,1,229.66,69.66Zm-17-5.66L192,43.31,179.31,56,200,76.69Z",
  link: "M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM115.7,192.49a43.31,43.31,0,0,1-55-66.43l25.37-25.37a43.35,43.35,0,0,1,61.25,0,42.9,42.9,0,0,1,9.95,15.43,8,8,0,1,1-15,5.6A27.33,27.33,0,0,0,97.37,112L72,137.37a27.32,27.32,0,0,0,34.68,41.91,8,8,0,1,1,9,13.21Zm79.61-62.55-25.37,25.37A43,43,0,0,1,139.32,168h0a43.35,43.35,0,0,1-40.53-28.12,8,8,0,1,1,15-5.6A27.35,27.35,0,0,0,139.28,152h0a27.14,27.14,0,0,0,19.32-8L184,118.63a27.32,27.32,0,0,0-34.68-41.91,8,8,0,1,1-9-13.21,43.32,43.32,0,0,1,55,66.43Z",
  code: "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM92.8,145.6a8,8,0,1,1-9.6,12.8l-32-24a8,8,0,0,1,0-12.8l32-24a8,8,0,0,1,9.6,12.8L69.33,128Zm58.89-71.4-32,112a8,8,0,1,1-15.38-4.4l32-112a8,8,0,0,1,15.38,4.4Zm53.11,60.2-32,24a8,8,0,0,1-9.6-12.8L186.67,128,163.2,110.4a8,8,0,1,1,9.6-12.8l32,24a8,8,0,0,1,0,12.8Z",
  folder: "M216,72H131.31L104,44.69A15.88,15.88,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.41,15.41,0,0,0,39.39,216h177.5A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM40,56H92.69l16,16H40Z",
  cube: "M223.68,66.15,135.68,18a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,120,47.65,76,128,32l80.35,44Zm8,99.64V133.83l80-43.78v85.76Z",
};

const MAX_FILE_BYTES = 64 * 1024 * 1024; // = MAX_VAULT_BYTES (vault-crypto.cjs), the largest vault the app saves
const MASK = "••••••••";
const NEWER = "This vault was saved by a newer KAPEVault. Use a newer Opener to open it.";
const LABELS = {
  lifecycle: "Account status",
  heldFor: "Held for",
  username: "Username",
  password: "Password",
  url: "Website",
  signIn: "Signs in with",
  totp: "2FA setup key",
  recoveryCodes: "Backup codes",
  questions: "Security questions",
  keyId: "Key ID",
  secret: "Secret",
  expires: "Expires",
  linkType: "Link type",
  location: "Location",
  who: "Who",
  relation: "Relation",
  provider: "Wallet or bank",
  number: "Account number",
  accountName: "Account name",
  confirmedAt: "Confirmed by call",
  room: "Room",
  spot: "Where",
  grab: "In a hurry",
  type: "Type",
  model: "Model",
  serial: "Serial number",
  imei: "IMEI",
  mac: "MAC address",
  adminUrl: "Admin page",
  adminUser: "Admin username",
  adminPassword: "Admin password",
  ssid: "Wi-Fi name",
  wifiPassword: "Wi-Fi password",
  photo: "Label photo",
  idType: "ID",
  idNumber: "ID number",
  agency: "For",
  nextDue: "Next due",
  amount: "Amount",
  schedule: "Schedule",
  receipts: "Payments",
  body: "Note",
  notes: "Notes",
  tags: "Tags",
  updatedAt: "Last edited",
  passwordChangedAt: "Password changed",
  lastUsedAt: "Last used",
};
const VALUE_NAMES = {
  signIn: { google: "Google", microsoft: "Microsoft", apple: "Apple", github: "GitHub", facebook: "Facebook", "email-link": "Email link", sso: "SSO" },
  linkType: { web: "Website", drive: "Google Drive", folder: "Folder", doc: "Document" },
  grab: { 1: "Grab first", 2: "If there is time", 3: "Leave it" },
  type: { router: "Router", cctv: "CCTV / NVR", phone: "Phone", laptop: "Laptop", other: "Other" },
  agency: { sss: "SSS", philhealth: "PhilHealth", pagibig: "Pag-IBIG", "bir-1701q": "BIR 1701Q", "bir-2551q": "BIR 2551Q", "bir-1701": "BIR 1701 / 1701A", custom: "Other" },
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Closing an account on purpose (Shrink Queue), in words.
const STATUS = {
  dormant: () => "Not in use",
  "deletion-requested": (l) => ["Asked to delete", l.requestedAt, l.followUpAt && `(follow up ${l.followUpAt})`].filter(Boolean).join(" "),
  gone: (l) => ["Closed", l.goneAt, l.requestedAt && `(deletion requested ${l.requestedAt})`].filter(Boolean).join(" "),
};
const NOT_SHOWN = new Set(["id", "kind", "spaceId", "title", "brand", "favorite", "viaEntryId"]);
const FIRST = ["lifecycle", "heldFor", "username", "password", "url", "signIn", "totp", "recoveryCodes", "questions", "keyId", "secret", "expires", "linkType", "location", "who", "relation", "provider", "number", "accountName", "confirmedAt", "room", "spot", "grab", "type", "model", "serial", "imei", "mac", "adminUrl", "adminUser", "adminPassword", "ssid", "wifiPassword", "idType", "idNumber", "photo", "agency", "nextDue", "amount", "schedule", "receipts", "body", "history"];
const LAST = ["notes", "tags", "passwordChangedAt", "updatedAt", "lastUsedAt"];
// Every field is hidden until shown except these and dates: a saved opener lives on for years, and a
// field a later KAPEVault adds (a PIN, a Wi-Fi password) must never open in plain sight.
const PLAIN = new Set(["heldFor", "username", "url", "signIn", "keyId", "expires", "linkType", "location", "who", "relation", "provider", "number", "accountName", "room", "spot", "grab", "type", "model", "serial", "imei", "mac", "adminUrl", "adminUser", "ssid", "idType", "agency", "nextDue", "amount", "notes", "tags"]);
const isSecret = (key) => !PLAIN.has(key) && !key.endsWith("At");
const IDLE_MS = 5 * 60 * 1000; // closes like the app locks
// A photo (a device's label, an ID): shown as a picture (the CSP allows data: images and nothing else).
// Anything that is not exactly a JPEG data URL stays masked text.
const PHOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
// Lookups by a name from the vault: own keys only, so a kind of "constructor" is just unknown.
const own = (map, key) => (Object.hasOwn(map, key) ? map[key] : undefined);
const TILES = { login: ["", "key"], link: ["", "link"], note: ["note", "notePencil"], key: ["key", "code"] };

const $ = (id) => document.getElementById(id);
let picked = null; // { name, file }: a chosen file whose header checked out
let vault = null; // the opened vault, only while it is shown
let rows = []; // { entry, text, node } per item, built once per open
let space = "all";
let toastTimer = null;
let lastPaint = 0;
let idleTimer = null;
const tick = new MessageChannel(); // yields without the throttling setTimeout gets in a background tab

// Icons are fixed strings from ICONS; vault text only ever goes in through textContent.
function icon(name) {
  const t = document.createElement("template");
  t.innerHTML = `<svg class="i" viewBox="0 0 256 256" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
  return t.content.firstChild;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function say(text) {
  $("message").textContent = text;
}

function toast(text, ms = 1800) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

// "adminPassword" -> "Admin password", for fields this page does not know yet.
function labelFor(key) {
  if (own(LABELS, key)) return LABELS[key];
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// A due date's schedule in words. Null for a shape this page does not know (it then shows the raw fields).
function scheduleWords(s) {
  const md = (v) => typeof v === "string" && /^\d{2}-\d{2}$/.test(v);
  const day = (v) => `${MONTHS[Number(v.slice(0, 2)) - 1] ?? v} ${Number(v.slice(3))}`;
  if (s.every === "month" && Number.isInteger(s.day)) return s.day >= 31 ? "Every month, by the last day" : `Every month, by day ${s.day}`;
  if (s.every === "quarter" && Array.isArray(s.dates) && s.dates.every(md)) return `Every ${s.dates.map(day).join(", ")}`;
  if (s.every === "year" && md(s.date)) return `Every year, by ${day(s.date)}`;
  if (s.every === "once") return "One time";
  return null;
}

function display(key, value) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && key.endsWith("At")) return new Date(value).toLocaleString();
  const names = own(VALUE_NAMES, key);
  return (names && own(names, String(value))) ?? String(value);
}

const spaceName = (id) => vault.spaces.find((s) => s.id === id)?.name ?? "";

// Every field of an item as { label, value, secret, stamp, photo } (stamp: a date, nothing to copy), known
// fields in the app's order. Fields a later KAPEVault adds still show under their own name, so this
// page keeps opening newer vaults.
function fieldsOf(entry) {
  const out = [];
  const add = (label, value, secret, stamp = false, photo = false) => out.push({ label, value, secret, stamp, photo });
  const visit = (key, value, label, secret) => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      if (!value.every((v) => typeof v === "string")) return value.forEach((v, i) => visit(key, v, `${label} ${i + 1}`, secret));
      if (value.length) add(label, value.join(", "), secret);
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(k, v, `${label} - ${labelFor(k).toLowerCase()}`, secret || isSecret(k));
    } else {
      add(label, display(key, value), secret, key.endsWith("At"));
    }
  };
  const rank = (k) => (FIRST.includes(k) ? FIRST.indexOf(k) : LAST.includes(k) ? 100 + LAST.indexOf(k) : 50);
  for (const key of Object.keys(entry).filter((k) => !NOT_SHOWN.has(k)).sort((a, b) => rank(a) - rank(b))) {
    if (key === "signIn" && entry.signIn === "password") continue; // the default, not worth a row
    if (key === "history" && Array.isArray(entry.history)) {
      // changedAt: a UTC timestamp, or a local YYYY-MM-DD in rows from before
      for (const h of entry.history) {
        if (!h || typeof h !== "object") continue; // a malformed row never stops the item showing
        const when = String(h.changedAt ?? "");
        add(`Old password, replaced ${/T/.test(when) ? new Date(when).toLocaleDateString() : when}`.trim(), String(h.password ?? ""), true);
      }
      continue;
    }
    if (key === "genHistory" && Array.isArray(entry.genHistory)) {
      for (const g of entry.genHistory) if (typeof g?.value === "string" && g.value) add(`Generated ${/T/.test(g.at) ? new Date(g.at).toLocaleString() : (g.at ?? "")}`.trim(), g.value, true);
      continue;
    }
    // Backup codes: the count and paper copies read plainly, every code stays masked until shown.
    if (key === "recoveryCodes" && Array.isArray(entry.recoveryCodes?.codes)) {
      const { setAt, paper } = entry.recoveryCodes;
      const codes = entry.recoveryCodes.codes.filter((c) => c && typeof c === "object"); // a malformed row is left out
      add("Backup codes", `${codes.filter((c) => !c.used).length} of ${codes.length} left${setAt ? `, set ${setAt}` : ""}`, false, true);
      codes.forEach((c, i) => add(`Backup code ${i + 1}${c.used ? " (used)" : ""}`, String(c.code), true));
      (Array.isArray(paper) ? paper : []).filter((p) => p && typeof p === "object").forEach((p) => add(p.outdatedAt ? "Printed copy (out of date)" : "Printed copy", `${p.where}, printed ${p.printedAt}`, false, true));
      continue;
    }
    if (key === "photo" && PHOTO.test(entry.photo)) {
      add(entry.kind === "id" ? "ID photo" : "Label photo", entry.photo, true, true, true);
      continue;
    }
    // Closing an account: where it stands, in words, plainly (a closed one has no secrets left).
    if (key === "lifecycle" && typeof entry.lifecycle?.state === "string") {
      const say = own(STATUS, entry.lifecycle.state);
      add("Account status", say ? say(entry.lifecycle) : entry.lifecycle.state, false, true);
      continue;
    }
    // Due dates: the schedule in words, each payment plainly (a reference is not a secret), the portal by name.
    const words = key === "schedule" && entry.schedule && scheduleWords(entry.schedule);
    if (words) {
      add("Schedule", words, false, true);
      continue;
    }
    if (key === "receipts" && Array.isArray(entry.receipts)) {
      entry.receipts.forEach((r) => add(`Paid ${r?.paidAt ?? ""}`.trim(), [r?.reference, r?.amount && `amount ${r.amount}`, r?.dueDate && `for ${r.dueDate}`].filter(Boolean).join(", ") || "No reference", false));
      continue;
    }
    if (key === "agency") {
      visit(key, entry.agency, labelFor(key), false);
      const portal = vault.entries.find((e) => e.id === entry.viaEntryId);
      if (portal) add("Website login", portal.title, false);
      continue;
    }
    // Security questions: each question reads plainly, each answer stays masked until shown.
    if (key === "questions" && Array.isArray(entry.questions)) {
      entry.questions.forEach((q, i) => {
        add(`Security question ${i + 1}`, String(q?.question ?? ""), false);
        if (q?.answer) add(`Answer ${i + 1}`, String(q.answer), true);
      });
      continue;
    }
    visit(key, entry[key], labelFor(key), isSecret(key));
    const via = key === "signIn" && vault.entries.find((e) => e.id === entry.viaEntryId);
    if (via) add("Signs in through", via.title, false);
  }
  return out;
}

// The vault's generated passwords (genHistory, a list beside the items) read as one more item, every value masked.
function generatedItem(data) {
  return Array.isArray(data.genHistory) && data.genHistory.length ? { id: "generated", kind: "generated", spaceId: "", title: "Generated passwords", genHistory: data.genHistory } : null;
}

function subtitle(entry) {
  if (entry.kind === "id") return entry.title === entry.idType ? "ID" : entry.idType || "ID";
  return entry.username || entry.location || entry.url || entry.keyId || (entry.nextDue && `Next due ${entry.nextDue}`) || labelFor(String(entry.kind ?? "item"));
}

function iconButton(name, label) {
  const b = el("button", "icon-button");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.title = label;
  b.append(icon(name));
  return b;
}

// A web page can neither clear the clipboard later nor keep a copy out of Windows' clipboard history,
// so a copied secret says so.
async function copyText(value, secret) {
  try {
    await navigator.clipboard.writeText(value);
    if (secret) toast("Copied. Windows may keep it in clipboard history (Win+V).", 4000);
    else toast("Copied");
  } catch {
    toast("Could not copy - show it and select the text");
  }
}

// A photo is hidden like a secret: a label photo shows the passwords printed on the sticker, an ID
// photo is identity data. Shown, it is a small picture; a click shows it at full width and back.
function photoRow(label, value) {
  const row = el("div", "field");
  const masked = el("span", "field-value secret masked", MASK);
  const picture = el("button", "field-photo");
  picture.type = "button";
  picture.setAttribute("aria-label", `Show the ${label.toLowerCase()} larger`);
  picture.setAttribute("aria-pressed", "false");
  picture.addEventListener("click", () => picture.setAttribute("aria-pressed", String(picture.classList.toggle("large"))));
  const reveal = iconButton("eye", `Show ${label.toLowerCase()}`);
  reveal.addEventListener("click", () => {
    const show = !picture.isConnected;
    if (show && !picture.firstChild) {
      const img = el("img");
      img.alt = label;
      img.src = value;
      picture.append(img);
    }
    (show ? masked : picture).replaceWith(show ? picture : masked);
    reveal.replaceChildren(icon(show ? "eyeSlash" : "eye"));
    reveal.setAttribute("aria-label", `${show ? "Hide" : "Show"} ${label.toLowerCase()}`);
    reveal.title = reveal.getAttribute("aria-label");
  });
  const actions = el("span", "field-actions");
  actions.append(reveal);
  row.append(el("span", "field-label", label), masked, actions);
  return row;
}

function fieldRow({ label, value, secret, stamp, photo }) {
  if (photo) return photoRow(label, value);
  const row = el("div", "field");
  const shown = el("span", secret ? "field-value secret masked" : "field-value", secret ? MASK : value);
  const actions = el("span", "field-actions");
  // "Password" -> "Show password", but "2FA setup key" keeps its capitals.
  const name = /^.[a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
  if (secret) {
    const reveal = iconButton("eye", `Show ${name}`);
    reveal.addEventListener("click", () => {
      const masked = shown.classList.toggle("masked");
      shown.textContent = masked ? MASK : value;
      reveal.replaceChildren(icon(masked ? "eye" : "eyeSlash"));
      reveal.setAttribute("aria-label", `${masked ? "Show" : "Hide"} ${name}`);
      reveal.title = reveal.getAttribute("aria-label");
    });
    actions.append(reveal);
  }
  if (!stamp) {
    const copy = iconButton("copy", `Copy ${name}`);
    copy.addEventListener("click", () => copyText(value, secret));
    actions.append(copy);
  }
  row.append(el("span", "field-label", label), shown, actions);
  return row;
}

function itemNode(entry) {
  const li = el("li", "item");
  const row = el("button", "row");
  row.type = "button";
  row.setAttribute("aria-expanded", "false");
  const [tone, glyph] = entry.kind === "link" && entry.linkType === "folder" ? ["", "folder"] : (own(TILES, entry.kind) ?? ["other", "cube"]);
  const tile = el("span", `tile ${tone}`);
  tile.append(icon(glyph));
  const text = el("span", "row-text");
  text.append(el("span", "row-title", entry.title || "Untitled"), el("span", "row-sub", subtitle(entry)));
  const caret = el("span", "caret");
  caret.append(icon("caretRight"));
  row.append(tile, text, el("span", "row-space", spaceName(entry.spaceId)), caret);
  let fields = null; // built on first open, so secrets sit in the page only once asked for
  row.addEventListener("click", () => {
    const open = row.getAttribute("aria-expanded") !== "true";
    row.setAttribute("aria-expanded", String(open));
    if (open && !fields) {
      fields = el("div", "fields");
      const list = fieldsOf(entry);
      if (!list.length) fields.append(el("p", "field-empty", "No other details."));
      fields.append(...list.map(fieldRow));
      li.append(fields);
    }
    fields.hidden = !open;
  });
  li.append(row);
  return li;
}

function spaceButton(id, name, count) {
  const b = el("button", "space");
  b.type = "button";
  b.dataset.space = id;
  const tile = el("span", id === "all" ? "mono-tile all" : "mono-tile");
  if (id === "all") tile.append(icon("lockSimple"));
  else tile.textContent = name.split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join("").toUpperCase();
  // Like the app: a count only when there is something to count.
  b.append(tile, el("span", "space-name", name), el("span", "space-count", count ? String(count) : ""));
  b.addEventListener("click", () => {
    space = id;
    render();
  });
  return b;
}

function render() {
  const query = $("search").value.trim().toLowerCase();
  let count = 0;
  for (const r of rows) {
    const show = (space === "all" || r.entry.spaceId === space) && (!query || r.text.includes(query));
    r.node.hidden = !show;
    if (show) count += 1;
  }
  for (const b of $("spaces").children) b.setAttribute("aria-current", String(b.dataset.space === space));
  $("list-title").textContent = space === "all" ? "All items" : spaceName(space);
  $("list-count").textContent = `${count} ${count === 1 ? "item" : "items"}`;
  $("items").classList.toggle("in-space", space !== "all" || vault.spaces.length < 2);
  $("empty").hidden = count > 0;
}

function showVault(data) {
  vault = data;
  const spaces = [...vault.spaces].sort((a, b) => (a.kind === "personal" ? -1 : b.kind === "personal" ? 1 : a.name.localeCompare(b.name)));
  const generated = generatedItem(vault);
  const items = generated ? [...vault.entries, generated] : vault.entries;
  $("spaces").replaceChildren(
    spaceButton("all", "All items", items.length),
    ...spaces.map((s) => spaceButton(s.id, s.name, vault.entries.filter((e) => e.spaceId === s.id).length)),
  );
  rows = [...items]
    .sort((a, b) => String(a.title).localeCompare(String(b.title)))
    .map((entry) => {
      try {
        const plain = fieldsOf(entry).filter((f) => !f.secret && !f.photo).map((f) => f.value);
        return { entry, text: [entry.title, spaceName(entry.spaceId), ...plain].join("\n").toLowerCase(), node: itemNode(entry) };
      } catch {
        // One bad item must not hide the rest of the vault.
        const li = el("li", "item");
        li.append(el("p", "field-empty", `${String(entry.title ?? "") || "An item"} could not be shown.`));
        return { entry, text: String(entry.title ?? "").toLowerCase(), node: li };
      }
    });
  $("items").replaceChildren(...rows.map((r) => r.node));
  $("file-name").textContent = picked.name;
  $("search").value = "";
  space = "all";
  render();
  $("unlock").hidden = true;
  $("vault").hidden = false;
  $("search").focus();
  stayAwake();
}

// Like the app's auto-lock: five minutes without input closes the vault.
function stayAwake() {
  clearTimeout(idleTimer);
  if (!vault) return;
  idleTimer = setTimeout(() => {
    closeVault();
    say("Closed after 5 minutes without use.");
  }, IDLE_MS);
}

function closeVault() {
  clearTimeout(idleTimer);
  vault = null;
  rows = [];
  $("items").replaceChildren();
  $("spaces").replaceChildren();
  $("export").hidden = true;
  $("vault").hidden = true;
  $("unlock").hidden = false;
  $("password").focus();
}

async function pick(file) {
  picked = null;
  $("drop").classList.remove("ready");
  $("drop-title").textContent = "Choose a vault file";
  $("drop-sub").textContent = "or drop it here";
  say("");
  if (!file) return;
  let parsed = null;
  try {
    if (file.size <= MAX_FILE_BYTES) parsed = JSON.parse(await file.text());
  } catch {
    parsed = null;
  }
  if (!checkOpenerFile(parsed)) return say(isNewerFile(parsed) ? NEWER : "That file is not a KAPEVault vault.");
  picked = { name: file.name, file: parsed };
  $("drop").classList.add("ready");
  $("drop-title").textContent = file.name;
  $("drop-sub").textContent = parsed.format === "bovault" ? "Saved before the rename to KAPEVault - it opens the same way" : "Ready - type its master password";
  $("password").focus();
}

// scrypt runs on this thread in chunks; each pause lets the bar repaint and the page stay responsive.
function progress(done, total) {
  $("bar").style.transform = `scaleX(${done / total})`;
  if (performance.now() - lastPaint < 30) return undefined;
  lastPaint = performance.now();
  return new Promise((resolve) => {
    tick.port1.onmessage = () => resolve();
    tick.port2.postMessage(0);
  });
}

function busy(on) {
  for (const id of ["file", "password", "open"]) $(id).disabled = on;
  $("open").textContent = on ? "Unlocking..." : "Open";
  $("progress").hidden = !on;
  $("bar").style.transform = "scaleX(0)";
}

async function unlock(event) {
  event.preventDefault();
  const password = $("password").value;
  if (!picked) return say("Choose a vault file first.");
  if (!password) return say("Type the master password.");
  say("");
  busy(true);
  let data;
  try {
    data = await openVault(picked.file, password, progress);
  } catch (e) {
    busy(false);
    if (e.message === "Not a KAPEVault vault file") return say("That file is not a KAPEVault vault.");
    if (e.message === "Newer KAPEVault vault file") return say(NEWER);
    const why = e instanceof RangeError ? "This browser ran out of memory - close other tabs and try again." : "Try another browser.";
    return say(`Could not open the vault here. ${why}`);
  }
  busy(false);
  if (data === null) {
    say("Wrong master password.");
    $("password").select();
    return;
  }
  if (!Array.isArray(data?.spaces) || !Array.isArray(data?.entries)) return say("That file is not a KAPEVault vault.");
  $("password").value = "";
  try {
    showVault(data);
  } catch {
    closeVault();
    say("The vault opened, but this page could not show it. Try a newer opener.");
  }
}

function download() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(vault, null, 2)], { type: "application/json" }));
  const a = el("a");
  a.href = url;
  a.download = `KAPEVault export ${new Date().toLocaleDateString("en-CA")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("export").hidden = true;
  toast("Downloaded");
}

for (const slot of document.querySelectorAll("[data-icon]")) slot.append(icon(slot.dataset.icon));
$("file").addEventListener("change", (e) => pick(e.target.files[0]));
$("unlock-form").addEventListener("submit", unlock);
$("search").addEventListener("input", render);
$("close").addEventListener("click", closeVault);
$("download").addEventListener("click", () => {
  $("export").hidden = false;
  $("download-confirm").focus();
});
$("download-cancel").addEventListener("click", () => ($("export").hidden = true));
$("download-confirm").addEventListener("click", download);
// A file dropped anywhere must never navigate the tab away to it.
for (const type of ["dragover", "drop"]) document.addEventListener(type, (e) => e.preventDefault());
$("drop").addEventListener("dragover", () => $("drop").classList.add("over"));
$("drop").addEventListener("dragleave", () => $("drop").classList.remove("over"));
$("drop").addEventListener("drop", (e) => {
  $("drop").classList.remove("over");
  if (!$("file").disabled) pick(e.dataTransfer.files[0]);
});
for (const type of ["pointerdown", "keydown", "wheel"]) document.addEventListener(type, stayAwake, true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("export").hidden = true;
  if (e.key === "/" && vault && document.activeElement?.tagName !== "INPUT") {
    e.preventDefault();
    $("search").focus();
  }
});
