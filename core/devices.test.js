import test from "node:test";
import assert from "node:assert/strict";
import { luhnOk, isImei, cleanImei, macOf, cleanMac, cleanPhoto, parseLabel, MAX_PHOTO_BYTES } from "./devices.js";

// Mock labels as Windows OCR hands them back: one line per printed line, its usual misreads kept.
const TP_LINK = [
  "tp-link",
  "Model: Archer Power: 12V IA",
  "Default Access: http://tplinkwifi.net",
  "Username: admin Password: admin",
  "Wireless Network Name (SSID): Mock_Home_2.4G",
  "Wireless Password/PlN: 48213397",
  "MAC: 50-C7-BF-12-34-56",
  "SIN: 2231 MOCK09876",
].join("\n");

const HUAWEI = [
  "HUAWEI",
  "PLDT HOME FIBR",
  "Model: EchoLife HG8145V5",
  "WLAN SSID: PLDTHOMEFIBRmock1",
  "WLAN Key: mockKey7788",
  "Login Address: 192.168.1.1",
  "User Name: adminpldt Password: mock1234pass",
  "SN: 48575443MOCK0001",
  "MAC: 00:1A:2B:3C:4D:5E",
].join("\n");

const ZTE = [
  "ZTE",
  "ZXHN F670L",
  "Model: F670L",
  "SSID1: Converge_2.4GHz_mock",
  "WPA Key: m0ckZte55",
  "IP: 192.168.1.1",
  "User: user Password: mockzte01",
  "S/N: ZTEGMOCK1234",
  "MAC 3CDA6D112233",
].join("\n");

const HIKVISION = [
  "HIKVISION",
  "Network Video Recorder",
  "Model: DS-7604NI-K1",
  "S/N: DS-7604NI-K10420200101MOCK12345678",
  "Verification Code: MOCKAB",
  "12V DC",
].join("\n");

const PHONE_BOX = [
  "Samsung Galaxy A15",
  "Model: SM-A155F/DS",
  "Color: Black",
  "IMEI1: 356789101234563",
  "IMEI2: 356789101234571",
  "S/N: R58MOCK123A",
].join("\n");

test("Luhn: IMEIs with a good check digit pass, one wrong digit fails", () => {
  assert.equal(luhnOk("356789101234563"), true);
  assert.equal(luhnOk("356789101234564"), false);
  assert.equal(luhnOk("79927398713"), true); // the textbook example
  assert.equal(isImei("356789101234563"), true);
  assert.equal(isImei("35678910123456"), false, "14 digits");
});

test("IMEI is saved as 15 digits; a typo or a wrong length is refused", () => {
  assert.equal(cleanImei(" 35-678910-123456-3 "), "356789101234563");
  assert.equal(cleanImei(""), undefined);
  assert.equal(cleanImei(undefined), undefined);
  assert.throws(() => cleanImei("356789101234564"), /mistyped digit/);
  assert.throws(() => cleanImei("3567891012345"), /15 digits/);
  assert.throws(() => cleanImei("35678910123456a"), /15 digits/);
});

test("MAC addresses are read in any usual form and saved as AA:BB:CC:DD:EE:FF", () => {
  for (const typed of ["50-c7-bf-12-34-56", "50:C7:BF:12:34:56", "50c7.bf12.3456", "50C7BF123456", " 50 C7 BF 12 34 56 "]) assert.equal(macOf(typed), "50:C7:BF:12:34:56", typed);
  assert.equal(macOf("50-C7-BF-12-34"), null);
  assert.equal(macOf("GG:C7:BF:12:34:56"), null);
  assert.equal(cleanMac(""), undefined);
  assert.throws(() => cleanMac("not a mac"), /12 letters and numbers/);
});

test("the label photo must be a JPEG data URL under the size cap; empty removes it", () => {
  const jpeg = (bytes) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes - 4)]).toString("base64")}`;
  assert.equal(cleanPhoto(jpeg(1000)), jpeg(1000));
  assert.equal(cleanPhoto(jpeg(MAX_PHOTO_BYTES)), jpeg(MAX_PHOTO_BYTES));
  assert.equal(cleanPhoto(""), undefined);
  assert.throws(() => cleanPhoto(jpeg(MAX_PHOTO_BYTES + 1)), /Photo could not be saved/, "one byte over the cap");
  assert.throws(() => cleanPhoto(`data:image/jpeg;base64,${Buffer.from("<svg onload=x>").toString("base64")}`), /Photo could not be saved/, "not a JPEG inside");
  assert.throws(() => cleanPhoto(jpeg(100).replace("jpeg", "svg+xml")), /Photo could not be saved/);
  assert.throws(() => cleanPhoto("https://example.test/a.jpg"), /Photo could not be saved/);
  assert.throws(() => cleanPhoto(42), /Photo could not be saved/);
});

test("a photo whose base64 does not decode is refused, so no app ever tries to draw it", () => {
  // The phone decodes the whole body with atob to show it; a body cut mid-group made atob throw and
  // blanked the app (security re-scan 2026-10-10). Only the first 4 characters used to be checked.
  for (const body of ["/9j/A", "/9j/4AA", "/9j/4AAQ=A", "/9j/4AAQ==", "/9j/4AAQ!!!!"]) {
    assert.throws(() => cleanPhoto(`data:image/jpeg;base64,${body}`), /Photo could not be saved/, body);
  }
  assert.equal(cleanPhoto(`data:image/jpeg;base64,${btoa("\xff\xd8\xff\xe0 ok")}`), `data:image/jpeg;base64,${btoa("\xff\xd8\xff\xe0 ok")}`);
});

test("a TP-Link router label: admin page and login, Wi-Fi name and password, MAC, serial split by OCR", () => {
  assert.deepEqual(parseLabel(TP_LINK), {
    type: "router",
    title: "TP-Link Archer",
    model: "Archer",
    adminUrl: "http://tplinkwifi.net",
    adminUser: "admin",
    adminPassword: "admin",
    ssid: "Mock_Home_2.4G",
    wifiPassword: "48213397",
    mac: "50:C7:BF:12:34:56",
    serial: "2231MOCK09876",
  });
});

test("a Huawei modem from PLDT: the provider names it, the address is found, both logins read", () => {
  const found = parseLabel(HUAWEI);
  assert.equal(found.type, "router");
  assert.equal(found.title, "PLDT EchoLife HG8145V5");
  assert.equal(found.ssid, "PLDTHOMEFIBRmock1");
  assert.equal(found.wifiPassword, "mockKey7788");
  assert.equal(found.adminUrl, "192.168.1.1");
  assert.equal(found.adminUser, "adminpldt");
  assert.equal(found.adminPassword, "mock1234pass");
  assert.equal(found.serial, "48575443MOCK0001");
  assert.equal(found.mac, "00:1A:2B:3C:4D:5E");
});

test("a ZTE modem: numbered SSID, WPA key, IP, short labels with colons, a MAC with no separators", () => {
  const found = parseLabel(ZTE);
  assert.equal(found.ssid, "Converge_2.4GHz_mock");
  assert.equal(found.wifiPassword, "m0ckZte55");
  assert.equal(found.adminUrl, "192.168.1.1");
  assert.equal(found.adminUser, "user");
  assert.equal(found.adminPassword, "mockzte01");
  assert.equal(found.serial, "ZTEGMOCK1234");
  assert.equal(found.mac, "3C:DA:6D:11:22:33");
  assert.equal(found.title, "Converge F670L", "the provider in the Wi-Fi name");
});

test("a Hikvision NVR: CCTV, serial, and the verification code goes to notes", () => {
  assert.deepEqual(parseLabel(HIKVISION), {
    type: "cctv",
    title: "Hikvision DS-7604NI-K1",
    model: "DS-7604NI-K1",
    serial: "DS-7604NI-K10420200101MOCK12345678",
    notes: "Verification code: MOCKAB",
  });
});

test("a phone box: the first valid IMEI, model and serial; it is a phone", () => {
  const found = parseLabel(PHONE_BOX);
  assert.equal(found.type, "phone");
  assert.equal(found.imei, "356789101234563");
  assert.equal(found.model, "SM-A155F/DS");
  assert.equal(found.serial, "R58MOCK123A");
  assert.equal(found.title, "Samsung SM-A155F/DS");
});

test("an IMEI that fails its check digit is not suggested; an unlabelled good one is", () => {
  assert.equal(parseLabel("IMEI: 356789101234564").imei, undefined);
  assert.equal(parseLabel("Galaxy box\nIMEI\n356789101234563").imei, "356789101234563", "a value on the line under its label");
  assert.equal(parseLabel("Galaxy box\n356789101234563").imei, undefined, "15 digits with no IMEI anywhere are just a number");
  assert.equal(parseLabel("IMEI: see box\nOrder 123456789012345").imei, undefined, "15 digits that fail Luhn stay unread");
});

test("labels printed in other shapes: pairs, asides, a label alone on its line", () => {
  assert.deepEqual(parseLabel("Default Username/Password: admin/admin"), { adminUser: "admin", adminPassword: "admin" });
  assert.equal(parseLabel("Password (WPA Key): abcd1234").adminPassword, "abcd1234");
  assert.equal(parseLabel("SSID\nPassword").ssid, undefined, "the next line's word is not the value");
  assert.equal(parseLabel("SSID: ):").ssid, undefined, "punctuation is not a value");
  const laptop = parseLabel("Lenovo IdeaPad 3\nProduct Key: MOCK1-MOCK2-MOCK3\nS/N: PF3MOCK1");
  assert.equal(laptop.wifiPassword, undefined, "a Windows product key is not a Wi-Fi password");
  assert.equal(laptop.type, "laptop");
  assert.equal(laptop.title, "Lenovo laptop");
  const pocket = parseLabel("Globe At Home Prepaid WiFi\nIMEI: 356789101234563\nSSID: Mock_Pocket\nWi-Fi Key: mockpocket1");
  assert.equal(pocket.type, "router", "a pocket Wi-Fi has an IMEI and is still a router");
  assert.equal(pocket.imei, "356789101234563");
});

test("nothing readable gives nothing; a stray word is not a label", () => {
  assert.deepEqual(parseLabel(""), {});
  assert.deepEqual(parseLabel("Made in China\nCE FC"), {});
  assert.equal(parseLabel("Keep dry. Use the key provided").wifiPassword, undefined, "\"key\" without a colon is just a word");
  assert.equal(parseLabel("The user manual is online").adminUser, undefined);
});
