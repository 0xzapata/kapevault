// node scripts/emu-camera.mjs setup|totp|blank - points the running KAPEVault emulator's back camera at
// a test QR code (or at plain grey). `npm run sim` boots the camera as a panorama holding the codes
// (qr-poster.mjs qrPanorama); what it shows follows the phone's pose, which this sets.
// Import `aimCamera` to do the same from a proof. No dependencies: the emulator's gRPC endpoint is
// reached over Node's own http2, with a JWT from a throwaway key the emulator is told to trust (the
// "gradle-utp-emulator-control" issuer may call setPhysicalModel; emulator_access.json).
import crypto from "node:crypto";
import fs from "node:fs";
import http2 from "node:http2";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PANORAMA } from "../src/app/host/test/qr-poster.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The running KAPEVault emulator's discovery file: its gRPC port and the folder of keys it trusts.
export function discovery() {
  const dir = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "Temp", "avd", "running");
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!/^pid_\d+\.ini$/.test(name)) continue;
    const ini = Object.fromEntries(
      fs.readFileSync(path.join(dir, name), "utf8").split(/\r?\n/).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    if (ini["avd.name"] === "KAPEVault" && ini["grpc.port"]) return { port: Number(ini["grpc.port"]), jwks: ini["grpc.jwks"], active: ini["grpc.jwk_active"] };
  }
  // A temp-folder cleanup can delete the running emulator's discovery file; only a restart writes it again.
  throw new Error("no running KAPEVault emulator with gRPC (start it with `npm run sim -- --no-window`; if one is running, its discovery file in %LOCALAPPDATA%\\Temp\\avd\\running is gone: `adb emu kill`, then start it again)");
}

const b64url = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

async function token({ jwks, active }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = crypto.randomUUID();
  const file = path.join(jwks, `${kid}.jwk`);
  // A key SET: the emulator deletes a file holding a bare JWK and never trusts it.
  fs.writeFileSync(file, JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" }] }));
  // The emulator folds every key file into active.jwk when it notices the new one.
  for (let i = 0; i < 40 && !fs.readFileSync(active, "utf8").includes(kid); i += 1) await sleep(250);
  const now = Math.floor(Date.now() / 1000);
  // No "typ" in the header: the emulator's validator refuses a token that has one.
  const unsigned = `${b64url({ alg: "ES256", kid })}.${b64url({ iss: "gradle-utp-emulator-control", iat: now, exp: now + 300 })}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return { jwt: `${unsigned}.${signature}`, forget: () => fs.rmSync(file, { force: true }) };
}

// One unary gRPC call: a 5-byte frame header, then the message; the answer is in the trailers.
function call(port, jwt, method, message) {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`http://127.0.0.1:${port}`);
    client.on("error", reject);
    const req = client.request({
      ":method": "POST",
      ":path": `/android.emulation.control.EmulatorController/${method}`,
      "content-type": "application/grpc",
      te: "trailers",
      authorization: `Bearer ${jwt}`,
    });
    let status;
    let detail = "";
    req.on("response", (headers) => {
      status ??= headers["grpc-status"];
      detail ||= headers["grpc-message"] ?? "";
    });
    req.on("trailers", (trailers) => {
      status = trailers["grpc-status"];
      detail = trailers["grpc-message"] ?? "";
    });
    req.on("data", () => {});
    req.on("end", () => {
      client.close();
      if (status === "0") resolve();
      else reject(new Error(`${method}: gRPC status ${status} ${decodeURIComponent(detail)}`));
    });
    req.on("error", reject);
    const frame = Buffer.alloc(5 + message.length);
    frame.writeUInt32BE(message.length, 1);
    message.copy(frame, 5);
    req.end(frame);
  });
}

// PhysicalModelValue { target = 1 (ROTATION = 1); value = 3 { repeated float data = 1 [packed] };
// interpolation = 4 (STEP = 1) } - the phone's pose, in degrees around x, y, z.
function rotation(x, y, z) {
  const floats = Buffer.alloc(12);
  [x, y, z].forEach((v, i) => floats.writeFloatLE(v, i * 4));
  const value = Buffer.concat([Buffer.from([0x0a, floats.length]), floats]);
  return Buffer.concat([Buffer.from([0x08, 1]), Buffer.from([0x1a, value.length]), value, Buffer.from([0x20, 1])]);
}

// Measured: turning the phone to y = 90 - heading shows the panorama's heading straight ahead.
export async function aimCamera(target) {
  if (!(target in PANORAMA)) throw new Error(`aimCamera: ${target} is not one of ${Object.keys(PANORAMA).join(", ")}`);
  const where = discovery();
  const { jwt, forget } = await token(where);
  try {
    await call(where.port, jwt, "setPhysicalModel", rotation(0, 90 - PANORAMA[target], 0));
  } finally {
    forget();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await aimCamera(process.argv[2] ?? "blank");
  console.log(`emu-camera: the camera shows ${process.argv[2] ?? "blank"}`);
}
