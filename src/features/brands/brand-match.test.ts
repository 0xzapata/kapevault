// Run with `npm test` (Node strips the types). Guards the logo auto-detect against lookalike domains.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createMatcher } from "./brand-match.ts";

const catalog = JSON.parse(fs.readFileSync(new URL("./brands.json", import.meta.url), "utf8"));
const detect = createMatcher(catalog);

const cases: [string, string | null][] = [
  ["https://app.gohighlevel.com/location/abc", "gohighlevel"],
  ["GHL agency login", "gohighlevel"],
  ["https://mail.google.com/mail/u/0", "gmail"],
  ["https://drive.google.com/drive/folders/x", "google-drive"],
  ["https://docs.google.com/spreadsheets/d/x", "google-sheets"],
  ["https://claude.ai/new", "claude"],
  ["https://x.com/home", "x"],
  ["https://www.dropbox.com/home", "dropbox"],
  ["https://www.netflix.com", null],
  ["https://www.fedex.com", null],
  ["https://olive.com", null],
  ["https://otherwise.com", null],
  ["https://business.facebook.com/latest", "meta"],
  ["https://www.facebook.com/northwindstudio", "facebook"],
  ["D:\\Clients\\Contract.meeting notes", null],
  ["https://wise.com/login", "wise"],
  ["Q3 report.docx", "word"],
  ["https://example.com/docxfiles", null],
  ["OBS Recording", "obs"],
  ["https://obsproject.com/download", "obs"],
  ["D:\\OBSrecordings", null],
  ["Obsidian vault", "obsidian"],
  // PH wallets, banks, remittance
  ["https://www.gcash.com", "gcash"],
  ["https://www.maya.ph/login", "maya"],
  ["https://www.gotyme.com.ph", "gotyme"],
  ["https://www.seabank.ph", "seabank"],
  ["https://online.bdo.com.ph/sso/login", "bdo"],
  ["https://www.bpi.com.ph", "bpi"],
  ["https://online.metrobank.com.ph", "metrobank"],
  ["https://www.unionbankph.com", "unionbank"],
  ["https://www.landbank.com", "landbank"], // a brand with no logo file ("logo": false): it still matches
  ["https://www.pnb.com.ph", "pnb"],
  ["https://www.securitybank.com", "security-bank"],
  ["https://www.rcbc.com", "rcbc"],
  ["https://www.chinabank.ph", "chinabank"],
  ["https://www.eastwestbanker.com", "eastwest"],
  ["https://www.cimbbank.com.ph", "cimb"],
  ["https://www.westernunion.com/ph/en/home.html", "western-union"],
  ["https://www.remitly.com", "remitly"],
  ["https://www.palawanpawnshop.com", "palawan-express"],
  ["https://cebuanalhuillier.com", "cebuana"],
  ["https://mlhuillier.com", "mlhuillier"],
  ["GCash", "gcash"],
  ["BDO savings", "bdo"],
  ["PayMaya", "maya"],
  ["Security Bank payroll", "security-bank"],
  ["China Bank", "chinabank"],
  ["Western Union", "western-union"],
  ["Cebuana Lhuillier", "cebuana"],
  ["M Lhuillier", "mlhuillier"],
  ["Palawan Express Pera Padala", "palawan-express"],
  ["Tita Maya birthday", null],
  ["Palawan trip", null],
  ["Security question", null],
  ["China trip", null],
  ["https://www.union.com", null],
  ["Sea view condo", null],
  ["Express delivery", null],
  // PH government agencies have no logo here (their marks need the agency's approval to use, see
  // NOTICE) but are still brands: the portals and the names people type match, and show the letter tile.
  ["https://member.sss.gov.ph/members/", "sss"],
  ["My.SSS", "sss"],
  ["SSS contribution", "sss"],
  ["https://memberinquiry.philhealth.gov.ph/member/", "philhealth"],
  ["PhilHealth premium", "philhealth"],
  ["https://www.pagibigfund.gov.ph/virtualpagibig/", "pag-ibig"],
  ["Virtual Pag-IBIG", "pag-ibig"],
  ["Pag-IBIG Fund MP2", "pag-ibig"],
  ["https://orus.bir.gov.ph", "bir"],
  ["BIR 1701Q", "bir"],
  ["Pag-ibig letters", null], // "love" in Filipino
  ["Birthday gift", null],
  ["Classes", null],
  // Devices (Sticker Capture): the maker is in the title or the model
  ["TP-Link Archer C6", "tp-link"],
  ["http://tplinkwifi.net", "tp-link"],
  ["PLDT Huawei EchoLife HG8145V5", "huawei"],
  ["Redmi Note 13", "xiaomi"],
  ["Xiaomi router", "xiaomi"],
  ["Mom's miso soup", null],
  ["https://www.xiaomi.com", "xiaomi"],
  ["https://ami.com", null],
];

for (const [text, want] of cases) {
  test(`${text} -> ${want}`, () => assert.equal(detect(text), want));
}

// A brand is in the app (BRANDS) when the catalog says "logo": false or a file in assets/logos has its slug.
const logoFiles = new Set(fs.readdirSync(new URL("../../assets/logos/", import.meta.url)).map((f) => f.replace(/\.\w+$/, "")));
const inApp = (slug: string) => {
  const b = catalog.find((x: { slug: string }) => x.slug === slug);
  return b !== undefined && (b.logo === false || logoFiles.has(slug));
};

test("brands shown by name only have no logo file", () => {
  const nameOnly = ["landbank", "remitly", "sss", "philhealth", "pag-ibig", "bir"];
  for (const slug of nameOnly) {
    assert.equal(catalog.find((x: { slug: string }) => x.slug === slug)?.logo, false, `${slug} is "logo": false`);
    assert.equal(logoFiles.has(slug), false, `${slug} has no file in assets/logos`);
    assert.ok(inApp(slug), `${slug} is still a brand`);
  }
});

