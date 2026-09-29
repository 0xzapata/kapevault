// Run with `npm test` (Node strips the types). Backup codes pasted in the formats sites really use.
// Every code below is made up.
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CODES, MIN_CODES, parseCodes } from "./parse-codes.ts";

test("Google: numbered 8-digit pairs, with the download's heading and footer lines", () => {
  const block = [
    "SAVE YOUR BACKUP CODES",
    "Keep these backup codes somewhere safe but accessible.",
    "mock.user@gmail.com",
    "",
    "1. 1234 5678",
    "2. 2345 6789",
    "3. 3456 7890",
    "4. 4567 8901",
    "5. 5678 9012",
    "",
    "* You can only use each backup code once.",
    "* These codes were generated on: Sep 26, 2026",
  ].join("\n");
  assert.deepEqual(parseCodes(block), { codes: ["1234 5678", "2345 6789", "3456 7890", "4567 8901", "5678 9012"], error: "" });
});

test("Google copied from the page: two codes per line in columns, tabs or non-breaking spaces", () => {
  const block = "1234 5678\t2345 6789\r\n3456 7890    4567 8901\n5678 9012   6789 0123";
  assert.deepEqual(parseCodes(block).codes, ["1234 5678", "2345 6789", "3456 7890", "4567 8901", "5678 9012", "6789 0123"]);
});

test("GitHub: hex halves joined by a dash, under a heading", () => {
  const block = "GitHub recovery codes\n\na1b2c-3d4e5\nf6a7b-8c9d0\n0e1f2-a3b4c\n5d6e7-f8a9b\n\nPut these in a safe spot.";
  assert.deepEqual(parseCodes(block).codes, ["a1b2c-3d4e5", "f6a7b-8c9d0", "0e1f2-a3b4c", "5d6e7-f8a9b"]);
});

test("numbered and bulleted lists lose their marks, codes keep their own formatting", () => {
  const block = "1) 12345678\n(2) 87654321\n03: abcd-efgh\n- A1B2-C3D4\n* mock_code_5\n• zyxw9876\n10. 1111 2222";
  assert.deepEqual(parseCodes(block).codes, ["12345678", "87654321", "abcd-efgh", "A1B2-C3D4", "mock_code_5", "zyxw9876", "1111 2222"]);
});

test("numbering without punctuation still leaves the code", () => {
  assert.deepEqual(parseCodes("1 1234 5678\n2 2345 6789\n3 3456 7890\n4 4567 8901").codes, ["1234 5678", "2345 6789", "3456 7890", "4567 8901"]);
});

test("commas or semicolons on one line", () => {
  assert.deepEqual(parseCodes("abcd-efgh, ijkl-mnop, qrst-uvwx; yzab-cdef").codes, ["abcd-efgh", "ijkl-mnop", "qrst-uvwx", "yzab-cdef"]);
});

test("one-word codes on their own lines are kept (letters only too); headings are not", () => {
  assert.deepEqual(parseCodes("Backup codes\nabcdefgh\nq1w2e3r4\nzxcvbnml\nmnbv5678\nGitHub").codes, ["abcdefgh", "q1w2e3r4", "zxcvbnml", "mnbv5678"]);
});

test("the same code pasted twice counts once", () => {
  assert.deepEqual(parseCodes("1234 5678\n2345 6789\n1234 5678\n3456 7890\n4567 8901").codes, ["1234 5678", "2345 6789", "3456 7890", "4567 8901"]);
});

test(`too few, too many or none: a plain reason (${MIN_CODES} to ${MAX_CODES})`, () => {
  assert.match(parseCodes("").error, /No codes found/);
  assert.match(parseCodes("Your codes:\nnone yet.").error, /No codes found/);
  assert.equal(parseCodes("1234 5678\n2345 6789\n3456 7890").error, "Found 3. A set has at least 4 codes - paste them all.");
  const many = Array.from({ length: 21 }, (_, i) => `mock-${String(i).padStart(4, "0")}`).join("\n");
  assert.equal(parseCodes(many).error, "Found 21. KAPEVault keeps up to 20 codes in one set.");
  assert.equal(parseCodes(many.split("\n").slice(0, 20).join("\n")).error, "");
});

test("a single long recovery key is one code, not a set", () => {
  const result = parseCodes("ABCDE-FGHIJ-KLMNO-PQRST-UVWXY");
  assert.deepEqual(result.codes, ["ABCDE-FGHIJ-KLMNO-PQRST-UVWXY"]);
  assert.match(result.error, /Found 1/);
});

test("two numbered columns on one line (1-5 beside 6-10)", () => {
  const block = "1. 1234 5678    6. 6789 0123\n2. 2345 6789    7. 7890 1234\n3. 3456 7890    8. 8901 2345";
  assert.deepEqual(parseCodes(block).codes, ["1234 5678", "6789 0123", "2345 6789", "7890 1234", "3456 7890", "8901 2345"]);
});

test("a one-word heading in caps or lowercase is not saved as a code", () => {
  assert.deepEqual(parseCodes("BACKUP\n1111-2222\n3333-4444\n5555-6666\n7777-8888").codes, ["1111-2222", "3333-4444", "5555-6666", "7777-8888"]);
  assert.deepEqual(parseCodes("codes\nq1w2e3r4\nabcdefgh\nzxcv5678\nmnbv9876").codes, ["q1w2e3r4", "abcdefgh", "zxcv5678", "mnbv9876"], "a letters-only code as long as the rest stays");
});
