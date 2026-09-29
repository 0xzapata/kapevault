// npm start - open the built app (dist/) in Electron.
import { launchElectron } from "./launch-electron.mjs";

launchElectron().on("exit", (code) => process.exit(code ?? 0));
