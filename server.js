// Starts the local server. `node server.js --open` also opens the browser.
// `node server.js --app` opens the notebook in its own window instead (no tabs, no address bar)
// and stops the server when that window is closed.
// If the app is already running, it just opens the browser (or the window) and exits.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./src/app.js";

const PORT = Number(process.env.PORT ?? 4517);
const HOST = "127.0.0.1"; // only this computer can reach the app
const URL_TO_OPEN = `http://localhost:${PORT}/`;
const dataDir = process.env.CADERNO_DATA_DIR ?? join(fileURLToPath(new URL(".", import.meta.url)), "data");
const shouldOpen = process.argv.includes("--open");
const asApp = process.argv.includes("--app");

function openBrowser() {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", URL_TO_OPEN], { detached: true, stdio: "ignore" }).unref();
  } else {
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    spawn(cmd, [URL_TO_OPEN], { detached: true, stdio: "ignore" }).unref();
  }
}

// Microsoft Edge comes with Windows; its "app" mode shows a page in a plain window.
function findEdge() {
  const places = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA];
  return places
    .filter(Boolean)
    .map((dir) => join(dir, "Microsoft", "Edge", "Application", "msedge.exe"))
    .find((path) => existsSync(path));
}

// Opens the app window and calls onClosed when it is closed. Without Edge, it opens a browser tab.
// The window has its own small browser profile (data/app-window), so it runs as its own process
// and closing it really ends it.
function openAppWindow(onClosed) {
  const edge = process.platform === "win32" ? findEdge() : null;
  if (!edge) return openBrowser();
  const child = spawn(edge, [
    `--app=${URL_TO_OPEN}`,
    `--user-data-dir=${join(dataDir, "app-window")}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
  ], { stdio: "ignore", detached: !onClosed });
  if (onClosed) child.on("exit", onClosed);
  else child.unref();
}

const { server } = createApp({ dataDir });

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Caderno de Leitura is already running at ${URL_TO_OPEN}`);
    if (asApp) openAppWindow();
    else if (shouldOpen) openBrowser();
    setTimeout(() => process.exit(0), 500);
    return;
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`Caderno de Leitura running at ${URL_TO_OPEN}`);
  console.log(`Data folder: ${dataDir}`);
  if (asApp) {
    console.log("Close the app window to stop the app.");
    openAppWindow(() => {
      server.close(() => process.exit(0));
      server.closeAllConnections(); // idle keep-alive connections would hold the close
    });
    return;
  }
  console.log("Close this window to stop the app.");
  if (shouldOpen) openBrowser();
});
