// node --import ./src/app/host/test/register.mjs: lets Node run the host's TypeScript the way Vite
// builds it - "@core" is ../core/index.js and relative imports leave out ".ts". Node strips the types.
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
