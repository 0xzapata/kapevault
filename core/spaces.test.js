import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanVault } from "./clean-vault.js";
import { MAX_SPACE_PHOTO_BYTES, renameSpace, setSpacePhoto } from "./spaces.js";

// A space's picture: set, replaced, removed, kept by a rename, and checked when a vault opens.
const jpeg = (bytes) => `data:image/jpeg;base64,${btoa(`\xff\xd8\xff${"x".repeat(bytes - 3)}`)}`;
const PHOTO = jpeg(600);
const vault = () => ({ spaces: [{ id: "p", name: "Personal", kind: "personal" }, { id: "c", name: "Mock Client", kind: "client" }], entries: [] });

test("a space takes a photo, swaps it, and drops it for empty; the other space is untouched", () => {
  const data = vault();
  setSpacePhoto(data, "c", PHOTO);
  assert.deepEqual(data.spaces[1], { id: "c", name: "Mock Client", kind: "client", photo: PHOTO });
  const other = jpeg(900);
  setSpacePhoto(data, "c", other);
  assert.equal(data.spaces[1].photo, other);
  setSpacePhoto(data, "c", "");
  assert.deepEqual(data.spaces[1], { id: "c", name: "Mock Client", kind: "client" });
  assert.deepEqual(data.spaces[0], { id: "p", name: "Personal", kind: "personal" });
});

test("the personal space takes a photo too, and a rename keeps it", () => {
  const data = vault();
  setSpacePhoto(data, "p", PHOTO);
  renameSpace(data, "p", "Kape");
  assert.deepEqual(data.spaces[0], { id: "p", name: "Kape", kind: "personal", photo: PHOTO });
});

test("only a JPEG data URL up to the space cap is taken, for a space that exists", () => {
  const data = vault();
  assert.throws(() => setSpacePhoto(data, "c", `data:image/png;base64,${btoa("\x89PNG mock")}`), /could not be saved/);
  assert.throws(() => setSpacePhoto(data, "c", `data:image/jpeg;base64,${btoa("not a jpeg")}`), /could not be saved/);
  assert.throws(() => setSpacePhoto(data, "c", jpeg(MAX_SPACE_PHOTO_BYTES + 3)), /could not be saved/);
  assert.throws(() => setSpacePhoto(data, "missing", PHOTO), /Unknown space/);
  assert.equal(data.spaces[1].photo, undefined);
  setSpacePhoto(data, "c", jpeg(MAX_SPACE_PHOTO_BYTES));
  assert.ok(data.spaces[1].photo);
});

test("opening a vault keeps a good space photo and drops a bad one; other unknown space fields ride along", () => {
  const data = vault();
  data.spaces[0].photo = PHOTO;
  data.spaces[1].photo = `data:image/png;base64,${btoa("\x89PNG mock")}`;
  data.spaces[1].laterField = { a: 1 };
  const [personal, client] = cleanVault(data).spaces;
  assert.equal(personal.photo, PHOTO);
  assert.deepEqual(client, { id: "c", name: "Mock Client", kind: "client", laterField: { a: 1 } });
  data.spaces[1].photo = jpeg(MAX_SPACE_PHOTO_BYTES + 3);
  assert.equal(Object.hasOwn(cleanVault(data).spaces[1], "photo"), false, "an item-sized photo is too big for a space");
});
