import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const PROJECT_ROOT = path.resolve(process.cwd());

export function dataRoot(): string {
  const dir = path.join(PROJECT_ROOT, ".data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function jobDir(jobId: string): string {
  const dir = path.join(dataRoot(), "jobs", jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function jobFilesDir(jobId: string): string {
  const dir = path.join(jobDir(jobId), "files");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function jobMetaPath(jobId: string): string {
  return path.join(jobDir(jobId), "meta.json");
}

function resolveBinary(name: string, envVar?: string): string {
  if (envVar && process.env[envVar]?.trim()) {
    return process.env[envVar]!.trim();
  }
  try {
    return execSync(`command -v ${name}`, { encoding: "utf8" }).trim();
  } catch {
    const common = [
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`,
    ];
    for (const p of common) {
      if (fs.existsSync(p)) return p;
    }
    return name;
  }
}

export function ytdlpPath(): string {
  return resolveBinary("yt-dlp", "YT_DLP_PATH");
}

export function ffmpegPath(): string {
  return resolveBinary("ffmpeg", "FFMPEG_PATH");
}

export function cookiesFromBrowser(): string | undefined {
  const v = process.env.YT_DLP_COOKIES_FROM_BROWSER?.trim();
  return v || undefined;
}

/** True only for real playlists — not YouTube Mix/Radio (`list=RD…`). */
export function isPlaylistUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.pathname.includes("/playlist")) return true;
    const list = u.searchParams.get("list");
    if (!list) return false;
    // User playlists: PL… ; channel uploads: UU… / OLAK5uy_… etc.
    if (list.startsWith("RD")) return false;
    return list.startsWith("PL") || list.startsWith("UU") || list.startsWith("OL");
  } catch {
    return false;
  }
}
