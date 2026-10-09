// Sticker Capture (device kind): the field rules a save checks, and the parser that turns the text
// OCR read off a router / CCTV / phone-box label into suggested fields. Suggestions are only ever shown
// in the form for the user to confirm - never saved as is.

export const DEVICE_TYPES = ["router", "cctv", "phone", "laptop", "other"];
export const MAX_PHOTOS_BYTES = 16 * 1024 * 1024; // every label photo together, as stored: keeps the vault far under MAX_VAULT_BYTES
export const MAX_PHOTO_BYTES = 150 * 1024; // the label photo lives inside the vault (and every R2 snapshot); src/lib/photo.ts aims under it

// IMEI: 15 digits, the last one a Luhn check digit, so one mistyped digit is caught.
export function luhnOk(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

export const isImei = (digits) => /^\d{15}$/.test(digits) && luhnOk(digits);

export function cleanImei(value) {
  const digits = typeof value === "string" ? value.replace(/[\s-]/g, "") : "";
  if (!digits) return undefined;
  if (!/^\d{15}$/.test(digits)) throw new Error("IMEI must be 15 digits");
  if (!luhnOk(digits)) throw new Error("IMEI has a mistyped digit. Check it against the box");
  return digits;
}

// Six hex pairs however they were written (50-c7-bf..., 50:C7:BF..., 50c7.bf12.3456) -> 50:C7:BF:12:34:56.
export function macOf(value) {
  const hex = typeof value === "string" ? value.replace(/[\s:.-]/g, "") : "";
  return /^[0-9a-f]{12}$/i.test(hex) ? /** @type {RegExpMatchArray} */ (hex.toUpperCase().match(/../g)).join(":") : null;
}

export function cleanMac(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const mac = macOf(value);
  if (!mac) throw new Error("MAC address must be 12 letters and numbers (0-9, A-F)");
  return mac;
}

// A photo (a device's label, an ID) as the page made it: a JPEG data URL under the size cap. "" removes it.
// Checked without decoding it all: every 4 base64 characters carry 3 bytes, and the first 4 hold the
// JPEG magic bytes FF D8 FF.
export function cleanPhoto(value) {
  if (value === "") return undefined;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+)={0,2}$/.exec(typeof value === "string" ? value : "");
  const size = m ? Math.floor((m[1].length * 3) / 4) : 0;
  if (size < 3 || size > MAX_PHOTO_BYTES || !atob(/** @type {RegExpExecArray} */ (m)[1].slice(0, 4)).startsWith("\xff\xd8\xff")) throw new Error("Photo could not be saved. Pick it again");
  return value;
}

// --- Reading a label --------------------------------------------------------------------------

// Label words and the field each one names. `colon`: a short, common word only counts as a label when
// a colon follows it ("Key: 1234"), never in the middle of a value. OCR misreads are part of the
// patterns: "S/N" comes back as "SIN" or "S1N", "PIN" as "PlN". Fields named "skip" are read only so
// their text does not run on into the value before them (a model followed by "Power: 12V 1A").
// "login" is a username and password printed as one pair ("Username/Password: admin/admin").
const LABELS = [
  ["ssid", String.raw`wireless network name(?:\s*\(ssid\))?|wi-?fi (?:network )?name|network name(?:\s*\(ssid\))?|(?:wlan\s*|wi-?fi\s*)?ssid(?:\s*\d)?(?:[\s-]*\(?(?:2\.4|5)\s*g(?:hz)?\)?)?`],
  ["wifiPassword", String.raw`wireless password(?:\s*/\s*p[i1l]n)?|wi-?fi (?:password|key)|wlan (?:key|password)|wireless key|network key|security key|pre-?shared key|wpa2?(?:[\s-]*psk)?(?:\s*key)?`],
  ["wifiPassword", "key", true],
  // Never "admin password": "admin" is often the username printed just before "Password:".
  ["adminPassword", String.raw`(?:login|default|web)\s*password`],
  ["adminPassword", "password|pwd", true],
  ["login", String.raw`(?:(?:login|default|web)\s*)?user\s*name\s*/\s*password`],
  ["adminUser", String.raw`(?:login|default|web)\s*user\s*name|user\s*name`],
  ["adminUser", "user|login", true],
  ["adminUrl", String.raw`default access|default (?:login|web|gateway|ip)(?:\s*address)?|login (?:address|url|page)|(?:web|management|admin) (?:address|url|page)`],
  ["adminUrl", String.raw`(?:lan\s*)?ip(?:\s*address)?|url|gateway`, true],
  ["serial", String.raw`serial(?:\s*(?:no\.?|number|#))?`],
  ["serial", String.raw`s\s*[/|\\1il]?\s*n\.?`, true],
  ["imei", String.raw`imei\s*[12]?`],
  ["mac", String.raw`(?:wan\s*|lan\s*|wlan\s*|base\s*)?mac(?:\s*(?:address|id))?`],
  ["model", String.raw`model(?:\s*(?:no\.?|number|name))?`],
  ["model", String.raw`p\s*/\s*n|product(?:\s*(?:name|model))?`, true],
  ["code", String.raw`(?:device\s*)?verif(?:y|ication)\s*code`],
  ["skip", String.raw`wps\s*p[i1l]n|p[i1l]n|product\s*key|power|input|output|rating|made in|fcc(?:\s*id)?|h/?w|f/?w|ver(?:sion)?|mfg|date`, true],
].map(([field, words, colon = false]) => ({
  field,
  // A short aside may sit between the words and the colon ("Password (WPA Key):"); the value is on
  // the same line - a label alone on its line never takes the next line's words.
  re: new RegExp(String.raw`(?<![a-z0-9])(?:${words})(?:[ \t]*\([^)\n]{0,24}\))?${colon ? String.raw`[ \t]*[:=][ \t]*` : String.raw`[ \t]*[:=]?[ \t]*`}`, "gi"),
}));

// Makers and the internet providers whose names are printed on the box, as a title would spell them.
// The provider wins: a Huawei modem from PLDT is "the PLDT modem" at home.
const PROVIDERS = [["pldt", "PLDT"], ["globe", "Globe"], ["converge", "Converge"]];
const MAKERS = [
  ["tp-?link", "TP-Link"], ["huawei", "Huawei"], ["zte", "ZTE"], ["hikvision", "Hikvision"], ["dahua", "Dahua"], ["ezviz", "EZVIZ"],
  ["xiaomi", "Xiaomi"], ["samsung", "Samsung"], ["apple|iphone|ipad|macbook", "Apple"], ["oppo", "OPPO"], ["vivo", "vivo"], ["realme", "realme"],
  ["tenda", "Tenda"], ["d-?link", "D-Link"], ["netgear", "NETGEAR"], ["asus", "ASUS"], ["lenovo", "Lenovo"], ["dell", "Dell"], ["acer", "Acer"],
];
const NOUN = { router: "router", cctv: "camera", phone: "phone", laptop: "laptop" };

const firstWord = (text) => text.split(/\s+/)[0] ?? "";
const trimEnd = (text) => text.replace(/[\s,;|]+$/, "");

// A serial the OCR split in two ("2231 MOCK09876") joins up again; words after it ("Made") do not.
function serialOf(text) {
  const [head, ...rest] = text.split(/\s+/);
  let serial = head ?? "";
  for (const part of rest) {
    if (!/^[A-Z0-9-]+$/.test(part) || !/\d/.test(part)) break;
    serial += part;
  }
  return serial;
}

// Every label found in the text with the value after it: the rest of its line, up to the next label.
function labelled(text) {
  const hits = [];
  for (const { field, re } of LABELS) {
    for (const m of text.matchAll(re)) hits.push({ field, start: m.index, end: m.index + m[0].length });
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const hit of hits) if (!kept.length || hit.start >= kept[kept.length - 1].end) kept.push(hit);
  return kept.map((hit, i) => {
    const lineEnd = text.indexOf("\n", hit.end);
    const stop = Math.min(kept[i + 1]?.start ?? text.length, lineEnd === -1 ? text.length : lineEnd);
    return { field: hit.field, value: trimEnd(text.slice(hit.end, stop).trim()) };
  });
}

const URLISH = /^(?:https?:\/\/)?(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:\/\S*)?$/i;

// The label's text -> the fields it names. Only values that look right are kept (an IMEI that fails
// its check digit, a MAC that is not six hex pairs, an address that is not one).
export function parseLabel(text) {
  const clean = String(text ?? "").replace(/\r/g, "");
  const found = {};
  const set = (field, value) => {
    if (value && /[a-z0-9]/i.test(value) && found[field] === undefined) found[field] = value;
  };
  for (const { field, value } of labelled(clean)) {
    if (!value) continue;
    if (field === "ssid") set("ssid", value.split(/\s*\/\s*/)[0]);
    else if (field === "wifiPassword" || field === "adminPassword" || field === "adminUser") set(field, firstWord(value));
    else if (field === "login") {
      const [user, password] = firstWord(value).split("/");
      set("adminUser", user);
      set("adminPassword", password);
    } else if (field === "adminUrl") set("adminUrl", URLISH.test(firstWord(value)) ? firstWord(value).replace(/[.,]$/, "") : "");
    else if (field === "serial") set("serial", serialOf(value));
    else if (field === "imei") set("imei", isImei(value.replace(/[\s-]/g, "")) ? value.replace(/[\s-]/g, "") : "");
    else if (field === "mac") set("mac", macOf(firstWord(value)) ?? macOf(value));
    else if (field === "model") set("model", value);
    else if (field === "code") set("code", firstWord(value));
  }
  // Unlabelled but unmistakable: an IMEI printed under its label (the check digit holds), a MAC, a
  // router's address. Any 15 digits pass the check one time in ten, so the word IMEI must be there.
  if (/imei/i.test(clean)) set("imei", clean.match(/(?<!\d)\d{15}(?!\d)/g)?.find(isImei));
  set("mac", macOf(clean.match(/(?<![0-9a-f])[0-9a-f]{2}([:-])[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}(?![0-9a-f])/i)?.[0]));
  set("adminUrl", clean.match(/https?:\/\/[^\s,;]+|(?<![\d.])192\.168\.\d{1,3}\.\d{1,3}(?![\d.])|\b(?:tplinkwifi|tplinklogin|routerlogin|mwlogin)\.net\b|\bmiwifi\.com\b/i)?.[0]);

  const has = (re) => re.test(clean);
  // Wi-Fi details first: a pocket Wi-Fi has an IMEI too, and it is a router.
  let type;
  if (found.ssid || found.wifiPassword) type = "router";
  else if (found.imei) type = "phone";
  else if (found.code || has(/\b(?:nvr|dvr|ipc|cctv|camera|hikvision|dahua|ezviz)\b|\bDS-\d/i)) type = "cctv";
  else if (has(/\b(?:router|wi-?fi|wlan|ont|onu|gpon|modem|fibr)\b/i)) type = "router";
  else if (has(/\b(?:laptop|notebook|thinkpad|macbook|ideapad|vivobook|zenbook|inspiron|latitude)\b/i)) type = "laptop";

  const nameOf = (list) => list.find(([re]) => new RegExp(`(?<![a-z0-9])(?:${re})(?![a-z0-9])`, "i").test(clean))?.[1];
  const brand = nameOf(PROVIDERS) ?? nameOf(MAKERS);
  let title;
  if (brand && found.model) title = found.model.toLowerCase().startsWith(brand.toLowerCase()) ? found.model : `${brand} ${found.model}`;
  else if (brand && type && NOUN[type]) title = `${brand} ${NOUN[type]}`;
  else title = found.model;

  const { code, ...fields } = found;
  /** @type {Record<string, any>} */
  const result = { ...fields };
  if (type) result.type = type;
  if (title) result.title = title;
  if (code) result.notes = `Verification code: ${code}`;
  return result;
}
