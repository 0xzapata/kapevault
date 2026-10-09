// The release key's settings, shared by apk-release.mjs and its test. android/app/build.gradle reads the
// same file with the same rule: a storePassword / keyPassword in keystore.properties wins, and when the
// file has none, KAPEVAULT_STORE_PASSWORD / KAPEVAULT_KEY_PASSWORD from the environment are used. The
// owner keeps the key offline and builds with apk-release-prompt.ps1, which sets those two variables for
// one build and writes a properties file with only storeFile and keyAlias.

// keystore.properties text -> { key: value }. Blank lines and lines starting with # or ! are skipped.
export function parseProperties(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => /^\s*[^#!\s]/.test(line))
      .map((line) => line.split(/=(.*)/).map((s) => s.trim())),
  );
}

// The file's values with the two passwords filled from the environment when the file has none.
export function resolveSigning(properties, env = process.env) {
  return {
    ...properties,
    storePassword: properties.storePassword || env.KAPEVAULT_STORE_PASSWORD,
    keyPassword: properties.keyPassword || env.KAPEVAULT_KEY_PASSWORD,
  };
}

// What is missing for a build, as the names a person can act on ([] when complete).
export function missingSigning(signing) {
  const missing = [];
  if (!signing.storeFile) missing.push("storeFile");
  if (!signing.keyAlias) missing.push("keyAlias");
  if (!signing.storePassword) missing.push("storePassword (or KAPEVAULT_STORE_PASSWORD)");
  if (!signing.keyPassword) missing.push("keyPassword (or KAPEVAULT_KEY_PASSWORD)");
  return missing;
}
