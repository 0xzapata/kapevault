// The ID kind on the phone's real host: the number and the photo reach the page only one at a time, and
// a photo is never copied.
import test from "node:test";
import assert from "node:assert/strict";
import { createRealHost } from "./real-host.ts";
import { fakeClipboard, fakeKeystore, nodeFs, tempDir } from "./test/fixtures.mjs";

const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]).toString("base64")}`;

test("an ID's number and photo stay out of the view; the photo is never copied", async (t) => {
  const clipboard = fakeClipboard();
  const host = createRealHost({ fs: nodeFs(tempDir()), transport: async () => ({ status: 500, body: "" }), keystore: fakeKeystore(), clipboard, openUrl: () => {}, model: "Pixel 8" });
  t.after(() => host.lock());
  assert.equal((await host.createVault("Lantern-Mango-Quiet-47")).ok, true);
  const spaceId = (await host.view()).spaces[0].id;
  const saved = await host.saveEntry({ kind: "id", spaceId, title: "", idType: "UMID", idNumber: "0028-1234567-8", photo: JPEG, tags: [], favorite: false, notes: "" });
  assert.equal(saved.ok, false, "the title is filled by the form, never left empty");
  const { id } = await host.saveEntry({ kind: "id", spaceId, title: "UMID", idType: "UMID", idNumber: "0028-1234567-8", photo: JPEG, tags: [], favorite: false, notes: "" });

  const view = await host.view();
  const entry = view.entries.find((e) => e.id === id);
  assert.deepEqual({ idType: entry.idType, hasNumber: entry.hasNumber, hasPhoto: entry.hasPhoto }, { idType: "UMID", hasNumber: true, hasPhoto: true });
  assert.ok(!JSON.stringify(view).includes("0028-1234567-8") && !JSON.stringify(view).includes("data:image"));
  assert.equal(await host.getSecret(id, "idNumber"), "0028-1234567-8");
  assert.equal(await host.getSecret(id, "photo"), JPEG);

  await host.copySecret(id, "idNumber");
  assert.deepEqual({ text: clipboard.text, sensitive: clipboard.sensitive }, { text: "0028-1234567-8", sensitive: true });
  await assert.rejects(host.copySecret(id, "photo"), /not copied/);
  assert.equal(clipboard.text, "0028-1234567-8");
});
