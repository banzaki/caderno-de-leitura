// Starts the app on a random port with a temporary data folder.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../src/app.js";

export async function startApp(options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "caderno-test-"));
  const app = createApp({ dataDir, ...options });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  async function api(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  const stop = () => {
    app.server.close();
    app.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  };
  return { app, api, dataDir, stop };
}
