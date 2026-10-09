import { execSync } from "child_process";
import {
  cookiesFromBrowser,
  cookiesFilePath,
  ffmpegPath,
  resolveYtdlpCookies,
  ytdlpPath,
} from "@/lib/paths";

function version(cmd: string, args: string[]): string | null {
  try {
    return execSync(`${cmd} ${args.join(" ")}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split("\n")[0];
  } catch {
    return null;
  }
}

export async function GET() {
  const ytdlp = ytdlpPath();
  const ffmpeg = ffmpegPath();

  const ytdlpVersion = version(ytdlp, ["--version"]);
  const ffmpegVersion = version(ffmpeg, ["-version"]);

  const ok = Boolean(ytdlpVersion && ffmpegVersion);

  const cookies = resolveYtdlpCookies();

  return Response.json({
    ok,
    ytdlp: { path: ytdlp, version: ytdlpVersion },
    ffmpeg: { path: ffmpeg, version: ffmpegVersion },
    cookiesFromBrowser: cookiesFromBrowser() ?? null,
    cookiesFile: cookiesFilePath() ?? null,
    youtubeAuth: cookies
      ? cookies.mode === "file"
        ? { mode: "file" as const, path: cookies.path }
        : { mode: "browser" as const, browser: cookies.browser }
      : null,
  });
}
