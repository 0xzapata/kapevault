// Run with `npm test` (Node strips the types). The erasure request email: filled in, and it claims
// nothing beyond the two named rights.
import test from "node:test";
import assert from "node:assert/strict";
import { emailText, erasureEmail } from "./erasure-email.ts";

const email = erasureEmail({ service: "Mock Shop", account: "mock.user@example.com", website: "https://shop.example.com" });

test("the account and the site are filled in", () => {
  assert.equal(email.subject, "Request to delete my account and personal data - Mock Shop");
  assert.match(email.body, /delete my Mock Shop account and the personal data you hold about me/);
  assert.match(email.body, /Account: mock\.user@example\.com\nWebsite: https:\/\/shop\.example\.com/);
});

test("it names GDPR Article 17 and RA 10173 Section 16(e), and nothing else", () => {
  assert.match(email.body, /Article 17 of the EU General Data Protection Regulation \(GDPR\)/);
  assert.match(email.body, /erased or blocked in Section 16\(e\) of the Philippine Data Privacy Act of 2012 \(Republic Act No\. 10173\)/);
  for (const claim of [/Article 12/, /Article 1[^7]/, /one month|30 days|within/i, /fine|penalt|lawsuit|court|complaint/i, /CCPA|California/i, /legal advice/i]) {
    assert.doesNotMatch(email.body, claim);
  }
});

test("missing details are left out, not left blank", () => {
  const bare = erasureEmail({ service: "Mock Forum", account: "", website: "" });
  assert.doesNotMatch(bare.body, /Account:|Website:/);
  assert.doesNotMatch(bare.body, /\n\n\n/);
});

test("Copy email puts the subject line above the body", () => {
  assert.ok(emailText(email).startsWith(`Subject: ${email.subject}\n\nHello,`));
});
