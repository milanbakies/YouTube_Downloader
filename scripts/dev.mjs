import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import net from "node:net";

const PORT = 4317;
const APP_URL = `http://127.0.0.1:${PORT}`;

function portInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function healthOk() {
  try {
    const res = await fetch(`${APP_URL}/api/health`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

function openBrowser() {
  try {
    execSync(`open "${APP_URL}"`, { stdio: "ignore" });
  } catch {
    console.log(`Open in your browser: ${APP_URL}`);
  }
}

const busy = await portInUse(PORT);
if (busy) {
  if (await healthOk()) {
    console.log(`YouTube Downloader is already running at ${APP_URL}`);
    openBrowser();
    process.exit(0);
  }
  console.error(
    `Port ${PORT} is in use but /api/health failed. Stop the other process, then run npm run dev again.`,
  );
  console.error(`  lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
  process.exit(1);
}

const child = spawn(
  "npx",
  ["next", "dev", "-p", String(PORT)],
  { stdio: "inherit", shell: true, cwd: process.cwd() },
);
child.on("exit", (code) => process.exit(code ?? 0));
