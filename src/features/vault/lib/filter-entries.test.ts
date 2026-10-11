// Run with `npm test` (Node strips the types). Search, list views and the order results come in.
import test from "node:test";
import assert from "node:assert/strict";
import { filterEntries, matchesView, sortEntries } from "./filter-entries.ts";
import { SPACES, device, id, key, link, login, note, thing } from "./test-entries.ts";
import type { Entry, SortOrder, ViewFilter } from "../types";

const titles = (list: Entry[]) => list.map((e) => e.title);
const search = (entries: Entry[], query: string, extra: { view?: ViewFilter; sort?: SortOrder; spaceId?: string | null; heldFor?: string | null } = {}) =>
  filterEntries({ entries, spaces: SPACES, view: extra.view ?? "all", spaceId: extra.spaceId ?? null, heldFor: extra.heldFor, query, sort: extra.sort ?? "title" });

const gone = login({ id: "gone", title: "Old shop", lifecycle: { state: "gone", goneAt: "2026-05-01" } });
const closing = login({ id: "closing", title: "Gym", lifecycle: { state: "dormant" } });

test("the space name is searchable: 'northwind ghl' finds the client login", () => {
  const ghl = login({ id: "ghl", title: "GHL", spaceId: "northwind" });
  const mine = login({ id: "mine-ghl", title: "GHL" });
  assert.deepEqual(search([ghl, mine], "northwind ghl").map((e) => e.id), ["ghl"]);
});

test("every word must match somewhere, in any case", () => {
  const entries = [login({ title: "Example Mail" }), note({ title: "Example alarm" })];
  assert.deepEqual(titles(search(entries, "EXAMPLE mail")), ["Example Mail"]);
  assert.deepEqual(titles(search(entries, "example nothing")), []);
  assert.equal(search(entries, "   ").length, 2);
});

test("who an item is held for, its tags and notes are searchable", () => {
  const entries = [login({ id: "a", title: "Bank", heldFor: "Mama" }), note({ id: "b", title: "Wi-Fi", tags: ["home"] }), key({ id: "c", title: "Stripe", notes: "billing test mode" })];
  assert.deepEqual(search(entries, "mama").map((e) => e.id), ["a"]);
  assert.deepEqual(search(entries, "home").map((e) => e.id), ["b"]);
  assert.deepEqual(search(entries, "billing").map((e) => e.id), ["c"]);
});

test("each kind's own fields are searchable", () => {
  const entries = [
    login({ id: "sso", title: "Figma", signIn: "google", hasPassword: false }),
    login({ id: "totp", title: "Bank", hasTotp: true, questions: [{ question: "First pet?", hasAnswer: true }] }),
    key({ id: "key", title: "Harbor API", keyId: "pk_live_9" }),
    note({ id: "note", title: "Door" }),
    thing({ id: "thing", title: "Title deed", room: "Study", spot: "red box" }),
    device({ id: "dev", title: "Office router", ssid: "Lumen-Guest", model: "AX55" }),
    id({ id: "idc", title: "Card", idType: "Passport" }),
  ];
  const ids = (q: string) => search(entries, q).map((e) => e.id);
  assert.deepEqual(ids("google sign-in"), ["sso"]);
  assert.deepEqual(ids("2fa"), ["totp"]);
  assert.deepEqual(ids("pet"), ["totp"]);
  assert.deepEqual(ids("pk_live"), ["key"]);
  assert.deepEqual(ids("secure note"), ["note"]);
  assert.deepEqual(ids("study red"), ["thing"]);
  assert.deepEqual(ids("lumen-guest"), ["dev"]);
  assert.deepEqual(ids("wifi"), ["dev"]);
  assert.deepEqual(ids("router ax55"), ["dev"]);
  assert.deepEqual(ids("passport"), ["idc"]);
});

test("a link is found by its location", () => {
  assert.equal(search([link({ location: "D:\\Clients\\Northwind" })], "clients").length, 1);
});

test("title hits rank first: starts with > a word starts with > contains > other field", () => {
  const entries = [
    note({ id: "field", title: "Zeta", notes: "mail server" }),
    note({ id: "contains", title: "Gmailish" }),
    note({ id: "word", title: "Work mail" }),
    note({ id: "starts", title: "Mail archive" }),
  ];
  assert.deepEqual(search(entries, "mail").map((e) => e.id), ["starts", "word", "contains", "field"]);
});

test("equal title scores keep the chosen sort order", () => {
  const entries = [note({ id: "b", title: "Mail B", lastUsedAt: 1 }), note({ id: "a", title: "Mail A", lastUsedAt: 2 })];
  assert.deepEqual(search(entries, "mail", { sort: "title" }).map((e) => e.id), ["a", "b"]);
  assert.deepEqual(search(entries, "mail", { sort: "recent" }).map((e) => e.id), ["a", "b"]);
  const recentFirst = [note({ id: "b", title: "Mail B", lastUsedAt: 5 }), note({ id: "a", title: "Mail A", lastUsedAt: 2 })];
  assert.deepEqual(search(recentFirst, "mail", { sort: "recent" }).map((e) => e.id), ["b", "a"]);
});

test("sortEntries: recent puts used items first, never-used ones A-Z; edited newest first", () => {
  const entries = [note({ id: "c", title: "C" }), note({ id: "b", title: "B", lastUsedAt: 10 }), note({ id: "a", title: "A" }), note({ id: "d", title: "D", lastUsedAt: 20 })];
  assert.deepEqual(sortEntries(entries, "recent").map((e) => e.id), ["d", "b", "a", "c"]);
  assert.deepEqual(sortEntries(entries, "title").map((e) => e.id), ["a", "b", "c", "d"]);
  const edited = [note({ id: "old", title: "A", updatedAt: "2026-01-01" }), note({ id: "new", title: "B", updatedAt: "2026-03-01" })];
  assert.deepEqual(sortEntries(edited, "edited").map((e) => e.id), ["new", "old"]);
  assert.deepEqual(entries.map((e) => e.id), ["c", "b", "a", "d"], "the input list is not reordered");
});

test("a closed account shows only in Closed", () => {
  for (const view of ["all", "favorites", "login", "security", "closing"] as ViewFilter[]) assert.equal(matchesView({ ...gone, favorite: true, issues: [{ type: "weak" }] }, view), false, view);
  assert.equal(matchesView(gone, "closed"), true);
  assert.equal(matchesView(login(), "closed"), false);
  assert.deepEqual(search([gone, login()], "old"), []);
});

test("smart views: favorites, 2FA codes, security, closing, and each kind", () => {
  assert.equal(matchesView(login({ favorite: true }), "favorites"), true);
  assert.equal(matchesView(login(), "favorites"), false);
  assert.equal(matchesView(login({ hasTotp: true }), "totp"), true);
  assert.equal(matchesView(login(), "totp"), false);
  assert.equal(matchesView(key({ issues: [{ type: "expired", days: 2 }] }), "security"), true);
  assert.equal(matchesView(key(), "security"), false);
  assert.equal(matchesView(closing, "closing"), true);
  assert.equal(matchesView(closing, "login"), true);
  assert.equal(matchesView(login(), "closing"), false);
  const all = [login(), note(), key(), link(), thing(), device(), id()];
  for (const e of all) assert.deepEqual(all.filter((x) => matchesView(x, e.kind)), [e], e.kind);
});

test("space and held-for filters", () => {
  const entries = [login({ id: "a", spaceId: "northwind" }), login({ id: "b", heldFor: "Mama " }), login({ id: "c" })];
  assert.deepEqual(search(entries, "", { spaceId: "northwind" }).map((e) => e.id), ["a"]);
  assert.deepEqual(search(entries, "", { heldFor: "mama" }).map((e) => e.id), ["b"]);
  assert.equal(search(entries, "", { heldFor: null }).length, 3);
});

test("the Trash view holds only trashed items, and searches them", () => {
  const trashed = login({ id: "t1", title: "Old mail", trashedAt: "2026-03-01T00:00:00.000Z" });
  assert.equal(matchesView(trashed, "trash"), true);
  assert.equal(matchesView(login(), "trash"), false);
  assert.deepEqual(titles(search([trashed, note({ trashedAt: "2026-03-02T00:00:00.000Z" })], "old", { view: "trash" })), ["Old mail"]);
});

// Audit run-1 4.3: a restored or synced entry can lack a title (or hold a non-text one); the list must still sort and search.
test("an entry with a missing or non-text title or updatedAt never throws in any sort or search", () => {
  const noTitle = { ...login({ id: "no-title", username: "test.user" }), title: undefined } as unknown as Entry;
  const numTitle = { ...login({ id: "num-title" }), title: 5, updatedAt: undefined } as unknown as Entry;
  const entries = [login({ id: "a", title: "Alpha" }), noTitle, numTitle, login({ id: "b", title: "Beta" })];
  const sorts: SortOrder[] = ["title", "recent", "edited"];
  for (const sort of sorts) {
    assert.equal(sortEntries(entries, sort).length, 4, sort);
    assert.equal(search(entries, "", { sort }).length, 4, sort);
    assert.deepEqual(search(entries, "test.user", { sort }).map((e) => e.id), ["no-title"], sort);
    assert.deepEqual(search(entries, "alp", { sort }).map((e) => e.id), ["a"], sort);
  }
  assert.deepEqual(sortEntries(entries, "title").map((e) => e.id).slice(2), ["a", "b"]);
});
