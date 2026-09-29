// Run with `npm test` (Node strips the types). withLocalImages: a Markdown preview's relative
// images point at the checked file protocol beside the file, and nothing else is touched.
import test from "node:test";
import assert from "node:assert/strict";
import { withLocalImages } from "./file-kinds.ts";

const WIN = "D:\\Notes\\Northwind\\readme.md";

test("a relative image points at the file protocol beside the markdown file", () => {
  assert.equal(withLocalImages('<p><img src="shots/a.png" alt="A"></p>', WIN), '<p><img src="kapevault-file://local/D%3A/Notes/Northwind/shots/a.png" alt="A"></p>');
  assert.equal(withLocalImages('<img src="a.png">', "/Users/mock/notes/readme.md"), '<img src="kapevault-file://local//Users/mock/notes/a.png">');
});

test("each path segment is encoded, after the markdown's own escapes are read", () => {
  assert.equal(withLocalImages('<img src="my%20shots/caf%C3%A9.png">', WIN), '<img src="kapevault-file://local/D%3A/Notes/Northwind/my%20shots/caf%C3%A9.png">');
  assert.equal(withLocalImages('<img src="my shots/b.png">', WIN), '<img src="kapevault-file://local/D%3A/Notes/Northwind/my%20shots/b.png">');
});

test("an image with a scheme or a //host is left as it is", () => {
  for (const src of ["https://example.com/a.png", "data:image/png;base64,AAAA", "file:///C:/x.png", "kapevault-file://local/D%3A/x.png", "//server/share/a.png", "JAVASCRIPT:alert(1)"]) {
    const html = `<img src="${src}">`;
    assert.equal(withLocalImages(html, WIN), html, src);
  }
});

test("a malformed escape leaves the image as it was", () => {
  const html = '<img src="bad%zz.png">';
  assert.equal(withLocalImages(html, WIN), html);
});

test("only img src changes: links and other attributes stay", () => {
  const html = '<a href="notes.md">notes</a> <img alt="x" class="wide" src="b.png"> <script src="c.js"></script>';
  assert.equal(withLocalImages(html, WIN), '<a href="notes.md">notes</a> <img alt="x" class="wide" src="kapevault-file://local/D%3A/Notes/Northwind/b.png"> <script src="c.js"></script>');
});
