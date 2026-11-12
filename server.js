// Starts the local server. `node server.js --open` also opens the browser.
// If the app is already running, it just opens the browser and exits.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./src/app.js";

const PORT = Number(process.env.PORT ?? 4517);
const HOST = "127.0.0.1"; // only this computer can reach the app
const URL_TO_OPEN = `http://localhost:${PORT}/`;
const dataDir = process.env.CADERNO_DATA_DIR ?? join(fileURLToPath(new URL(".", import.meta.url)), "data");
const shouldOpen = process.argv.includes("--open");

function openBrowser() {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", URL_TO_OPEN], { detached: true, stdio: "ignore" }).unref();
  } else {
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    spawn(cmd, [URL_TO_OPEN], { detached: true, stdio: "ignore" }).unref();
  }
}

const { server } = createApp({ dataDir });

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Caderno de Leitura is already running at ${URL_TO_OPEN}`);
    if (shouldOpen) openBrowser();
    setTimeout(() => process.exit(0), 500);
    return;
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`Caderno de Leitura running at ${URL_TO_OPEN}`);
  console.log(`Data folder: ${dataDir}`);
  console.log("Close this window to stop the app.");
  if (shouldOpen) openBrowser();
});
