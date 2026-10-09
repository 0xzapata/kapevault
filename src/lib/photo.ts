// A photo (a device's label, an ID), made in the page from a picked or pasted image: a JPEG small
// enough to live in the vault (and in every cloud snapshot), plus, for a label, a sharper copy for
// Windows to read the text from, which is never stored.
import { MAX_PHOTO_BYTES, MAX_SPACE_PHOTO_BYTES } from "../../core/index.js";

export { MAX_PHOTO_BYTES }; // main refuses more (core/devices.js)
const PHOTO_SIDE = 1200; // longest side of the kept photo
const AVATAR_SIDE = 128; // a space's picture: drawn at 24 px, sharp up to 5x display scaling
const SCAN_SIDE = 2400; // Windows OCR reads up to 2600 px a side; small photos are enlarged up to 2x
const QUALITIES = [0.82, 0.72, 0.62, 0.52];
const MIN_SCALE = 0.3;

// Tries each quality, then 80% of the size, and so on, until the JPEG fits. encode(scale, quality)
// draws the photo at that fraction of its full size.
export async function fitUnder(maxBytes: number, encode: (scale: number, quality: number) => Promise<Blob>): Promise<Blob> {
  for (let scale = 1; scale >= MIN_SCALE; scale *= 0.8) {
    for (const quality of QUALITIES) {
      const blob = await encode(scale, quality);
      if (blob.size <= maxBytes) return blob;
    }
  }
  throw new Error("That photo is too detailed to keep. Try a closer photo.");
}

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// createImageBitmap turns a phone photo upright (EXIF) - OCR cannot read sideways text.
async function openImage(image: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(image);
  } catch {
    throw new Error("That file is not a photo KAPEVault can open. Use a JPG or PNG.");
  }
}

function jpegCanvas(width: number, height: number) {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  const g = canvas.getContext("2d");
  if (!g) throw new Error("This device cannot prepare photos.");
  g.fillStyle = "white"; // a transparent screenshot would turn black in a JPEG
  g.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, g };
}

// withScan false: no copy to read (scan is "").
export async function preparePhoto(image: Blob, withScan = true): Promise<{ photo: string; scan: string }> {
  const bitmap = await openImage(image);
  const longest = Math.max(bitmap.width, bitmap.height);
  const draw = (factor: number, quality: number) => {
    const { canvas, g } = jpegCanvas(bitmap.width * factor, bitmap.height * factor);
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.convertToBlob({ type: "image/jpeg", quality });
  };
  try {
    const photo = await fitUnder(MAX_PHOTO_BYTES, (scale, quality) => draw(Math.min(1, PHOTO_SIDE / longest) * scale, quality));
    const scan = withScan ? await asDataUrl(await draw(Math.min(2, SCAN_SIDE / longest), 0.92)) : "";
    return { photo: await asDataUrl(photo), scan };
  } finally {
    bitmap.close();
  }
}

// A space's picture (core/spaces.js): the middle square of the image, small enough to sync with its name.
export async function prepareAvatar(image: Blob): Promise<string> {
  const bitmap = await openImage(image);
  const side = Math.min(bitmap.width, bitmap.height);
  try {
    const avatar = await fitUnder(MAX_SPACE_PHOTO_BYTES, (scale, quality) => {
      const px = Math.min(AVATAR_SIDE, side) * scale;
      const { canvas, g } = jpegCanvas(px, px);
      g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
      return canvas.convertToBlob({ type: "image/jpeg", quality });
    });
    return await asDataUrl(avatar);
  } finally {
    bitmap.close();
  }
}
