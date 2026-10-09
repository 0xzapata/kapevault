// RFC 7914 scrypt: the ONE implementation in core/scrypt.js, which the Forever Opener page also inlines.
// Imported by path, not through @core: it is async and uses WebCrypto, so core/index.js leaves it out.
// core/scrypt.test.js checks it against the RFC 7914 section 12 vectors and Node's crypto.scrypt.
export { scrypt } from "../../../../core/scrypt.js";
export type { ScryptStep } from "../../../../core/scrypt.js";
