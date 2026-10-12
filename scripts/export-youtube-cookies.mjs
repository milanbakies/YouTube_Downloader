#!/usr/bin/env node
/**
 * Export Chrome (etc.) cookies to .data/cookies.txt once per launch.
 * yt-dlp then uses --cookies (no Keychain prompt on every download).
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const browser = (process.env.YT_DLP_COOKIES_FROM_BROWSER || "chrome").trim();
if (!browser || process.env.YT_DLP_SKIP_COOKIE_EXPORT === "1") {
  process.exit(0);
}

const dataDir = path.join(process.cwd(), ".data");
fs.mkdirSync(dataDir, { recursive: true });
const cookieFile = path.join(dataDir, "cookies.txt");

const maxAgeMs = 12 * 60 * 60 * 1000;
if (process.env.YT_DLP_REFRESH_COOKIES !== "1" && fs.existsSync(cookieFile)) {
  const st = fs.statSync(cookieFile);
  if (st.size > 32 && Date.now() - st.mtimeMs < maxAgeMs) {
    console.log("YouTube cookies: using cached .data/cookies.txt");
    process.exit(0);
  }
}

function ytdlpBin() {
  if (process.env.YT_DLP_PATH?.trim()) return process.env.YT_DLP_PATH.trim();
  const r = spawnSync("command", ["-v", "yt-dlp"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  for (const p of ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp"]) {
    if (fs.existsSync(p)) return p;
  }
  return "yt-dlp";
}

console.log(
  `Refreshing YouTube cookies from ${browser} → .data/cookies.txt (Keychain may ask once)…`,
);

const result = spawnSync(
  ytdlpBin(),
  [
    "--cookies-from-browser",
    browser,
    "--cookies",
    cookieFile,
    "--skip-download",
    "--no-warnings",
    "https://www.youtube.com",
  ],
  { stdio: "inherit" },
);

if (result.status !== 0 || !fs.existsSync(cookieFile) || fs.statSync(cookieFile).size < 32) {
  console.warn(
    "Cookie export did not complete. Sign in to YouTube in Chrome, allow Keychain, or add cookies.txt manually.",
  );
  process.exit(0);
}

console.log("YouTube cookies saved to .data/cookies.txt");
