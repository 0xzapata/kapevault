// Module resolve hooks for the host tests (see register.mjs).
const CORE = new URL("../../../../../core/index.js", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === "@core") return next(CORE, context);
  if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
}

// The app's .ts is ESM (package.json cannot say so: capacitor.config.js is CommonJS).
export async function load(url, context, next) {
  return next(url, url.endsWith(".ts") ? { ...context, format: "module-typescript" } : context);
}
