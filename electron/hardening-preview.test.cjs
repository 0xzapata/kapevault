const test = require("node:test");
const assert = require("node:assert/strict");
const { hardenSession } = require("./hardening.cjs");

// A kapevault-file:// request for a network path (a linked \\server\share folder) was fetched with no
// click behind it: checkPath looked the host up on disk, which froze main ~21 s per tag. The handler
// refuses it before any disk call.
async function previewHandler(linkedFolders) {
  const handlers = {};
  const session = { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setProxy: async () => {}, webRequest: { onBeforeRequest() {} } } };
  const protocol = { handle: (scheme, fn) => (handlers[scheme] = fn) };
  const state = { fetched: 0 };
  const net = {
    fetch: async () => {
      state.fetched++;
      return new Response("x");
    },
  };
  await hardenSession({ session, protocol, net, devUrl: undefined, linkedFolders });
  return { handle: handlers["kapevault-file"], state };
}

test("the preview protocol refuses a network path before touching the disk", async () => {
  let linkedCalls = 0;
  const { handle, state } = await previewHandler(() => {
    linkedCalls++;
    return ["\\\\192.0.2.1\\share"];
  });
  for (const p of ["\\\\192.0.2.1\\share\\a.png", "//192.0.2.1/share/a.png", "\\\\?\\UNC\\192.0.2.1\\share\\a.png", "\\\\.\\C:\\a.png"]) {
    const res = await handle({ url: `kapevault-file://local/${encodeURIComponent(p)}`, headers: new Headers() });
    assert.equal(res.status, 403, p);
  }
  assert.equal(linkedCalls, 0, "no linked-folder lookup, so no disk call");
  assert.equal(state.fetched, 0);
});
