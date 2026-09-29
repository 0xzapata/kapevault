// Run with `npm test` (Node strips the types). The photo prep shared by label and ID photos.
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_PHOTO_BYTES, fitUnder } from "./photo.ts";

test("the photo is squeezed under the cap: lower quality first, then smaller, then it gives up", async () => {
  const tried: string[] = [];
  // A mock encoder whose size falls with scale and quality.
  const encode = (limit: number) => async (scale: number, quality: number) => {
    tried.push(`${scale.toFixed(2)}@${quality}`);
    return new Blob([new Uint8Array(Math.round(limit * scale * scale * quality))]);
  };
  const fits = await fitUnder(MAX_PHOTO_BYTES, encode(MAX_PHOTO_BYTES));
  assert.ok(fits.size <= MAX_PHOTO_BYTES);
  assert.deepEqual(tried, ["1.00@0.82"], "a photo that fits is encoded once");
  tried.length = 0;
  const big = await fitUnder(MAX_PHOTO_BYTES, encode(MAX_PHOTO_BYTES * 3));
  assert.ok(big.size <= MAX_PHOTO_BYTES);
  assert.deepEqual(tried.slice(0, 5), ["1.00@0.82", "1.00@0.72", "1.00@0.62", "1.00@0.52", "0.80@0.82"]);
  await assert.rejects(fitUnder(MAX_PHOTO_BYTES, async () => new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)])), /too detailed/);
});
