// npm run app:dev - Vite dev server with hot reload, then the Electron window pointed at it.
import { createServer } from "vite";
import { launchElectron } from "./launch-electron.mjs";

const server = await createServer();
await server.listen();

const app = launchElectron({ KAPEVAULT_DEV_URL: server.resolvedUrls.local[0] });
app.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
