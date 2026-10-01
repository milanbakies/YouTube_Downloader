import { spawn } from "node:child_process";
import { execSync } from "node:child_process";

const PORT = 4317;
const APP_URL = `http://127.0.0.1:${PORT}`;

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

if (await healthOk()) {
  console.log(`YouTube Downloader is already running at ${APP_URL}`);
  openBrowser();
  process.exit(0);
}

const child = spawn("npx", ["next", "dev", "-p", String(PORT)], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
