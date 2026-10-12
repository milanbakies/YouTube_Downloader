import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { patchJob, getJob } from "./job-store";
import {
  ffmpegPath,
  jobDir,
  ytdlpCookieCliArgs,
  jobFilesDir,
  YTDLP_AUDIO_FORMAT,
  ytdlpPath,
} from "./paths";
import type { AudioQuality, Job } from "./types";
import { formatYtdlpFailure } from "./ytdlp-errors";
import { zipDirectory } from "./zip";

const active = new Set<string>();

function extractAudioPostArgs(quality: AudioQuality): string {
  return `FFmpegExtractAudio:-b:a ${quality}k`;
}

function parseProgressLine(line: string): number | null {
  const m = line.match(/(\d+(?:\.\d+)?)%/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  return Math.min(100, Math.max(0, n));
}

const YTDLP_NO_OUTPUT_MS = 3 * 60 * 1000;
const PROBE_TIMEOUT_MS = 45 * 1000;

function spawnYtdlp(
  args: string[],
  onStdoutLine?: (line: string) => void,
): Promise<{ code: number | null; stderrTail: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath(), args, {
      env: {
        ...process.env,
        PATH: `${path.dirname(ffmpegPath())}:${process.env.PATH ?? ""}`,
      },
    });

    let stderrTail = "";
    let lastOutputAt = Date.now();

    const touch = () => {
      lastOutputAt = Date.now();
    };

    const watchdog = setInterval(() => {
      if (Date.now() - lastOutputAt > YTDLP_NO_OUTPUT_MS) {
        proc.kill("SIGKILL");
        clearInterval(watchdog);
        reject(
          new Error(
            "yt-dlp stalled (no output for 3 minutes). If YT_DLP_COOKIES_FROM_BROWSER is set, launch the dev server from Terminal so macOS can access the browser keychain, or remove that variable and retry.",
          ),
        );
      }
    }, 5000);

    const onLine = (line: string) => {
      touch();
      onStdoutLine?.(line);
    };

    proc.stdout.on("data", (chunk) => {
      chunk.toString().split("\n").forEach(onLine);
    });
    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-2000);
      touch();
      text.split("\n").forEach(onLine);
    });

    proc.on("error", (err) => {
      clearInterval(watchdog);
      reject(err);
    });
    proc.on("close", (code) => {
      clearInterval(watchdog);
      resolve({ code, stderrTail });
    });
  });
}

async function probePlaylist(url: string): Promise<{ title?: string; count?: number }> {
  const args = [
    "--flat-playlist",
    "--dump-single-json",
    "--no-warnings",
    url,
  ];
  args.unshift(...ytdlpCookieCliArgs());

  let out = "";
  try {
    const result = await Promise.race([
      (async () => {
        const proc = spawn(ytdlpPath(), args, { env: process.env });
        return new Promise<{ code: number | null }>((resolve, reject) => {
          proc.stdout.on("data", (c) => {
            out += c.toString();
          });
          proc.on("error", reject);
          proc.on("close", (code) => resolve({ code }));
        });
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("probe timeout")), PROBE_TIMEOUT_MS),
      ),
    ]);
    if (result.code !== 0) return {};
    const data = JSON.parse(out);
    const title = data.title as string | undefined;
    const count =
      typeof data.playlist_count === "number"
        ? data.playlist_count
        : Array.isArray(data.entries)
          ? data.entries.length
          : undefined;
    return { title, count };
  } catch {
    return {};
  }
}

function listMp3Files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".mp3"))
    .map((f) => path.join(dir, f));
}

function clearAllJobFiles(jobId: string): void {
  const dir = jobFilesDir(jobId);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      /* ignore */
    }
  }
}

type YtdlpRunOptions = {
  embedThumbnail: boolean;
  embedMetadata: boolean;
  allowContinue: boolean;
  forceOverwrites: boolean;
};

async function runYtdlp(job: Job, options: YtdlpRunOptions): Promise<void> {
  const outDir = jobFilesDir(job.id);
  const outputTemplate = path.join(outDir, "%(title).200B [%(id)s].%(ext)s");

  const args = [
    "--newline",
    "--no-color",
    "--ffmpeg-location",
    path.dirname(ffmpegPath()),
    "-f",
    YTDLP_AUDIO_FORMAT,
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--postprocessor-args",
    extractAudioPostArgs(job.quality),
    "-o",
    outputTemplate,
    "--retries",
    "10",
    "--fragment-retries",
    "10",
    "--sleep-interval",
    "1",
    "--max-sleep-interval",
    "5",
  ];

  if (options.forceOverwrites) {
    args.push("--force-overwrites");
  } else {
    args.push("--no-overwrites");
  }

  if (options.allowContinue) {
    args.push("--continue");
  } else {
    args.push("--no-continue");
  }

  if (options.embedMetadata) {
    args.push("--embed-metadata");
  }

  if (options.embedThumbnail) {
    args.push("--embed-thumbnail", "--convert-thumbnails", "jpg");
  }

  if (job.isPlaylist) {
    args.push("--yes-playlist");
  } else {
    args.push("--no-playlist");
  }

  args.push(...ytdlpCookieCliArgs());

  args.push(job.url);

  let lastPct = 0;

  const { code, stderrTail } = await spawnYtdlp(args, (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.includes("[Merger]") || trimmed.includes("[ExtractAudio]")) {
      patchJob(job.id, { message: trimmed.slice(0, 200) });
    }

    const pct = parseProgressLine(trimmed);
    if (pct !== null) {
      lastPct = pct;
      const entriesDone = listMp3Files(outDir).length;
      patchJob(job.id, {
        progress: pct,
        message: trimmed.slice(0, 200),
        entriesDone,
      });
    } else if (trimmed.startsWith("[download]")) {
      patchJob(job.id, {
        progress: lastPct,
        message: trimmed.slice(0, 200),
        entriesDone: listMp3Files(outDir).length,
      });
    }
  });

  if (code === 0) return;

  throw new Error(formatYtdlpFailure(stderrTail, code));
}

function isPostprocessFailure(message: string): boolean {
  return /Invalid data found when processing input|Error opening input files|Postprocessing/i.test(
    message,
  );
}

async function runYtdlpWithRetry(job: Job): Promise<void> {
  const attempts: YtdlpRunOptions[] = [
    {
      embedThumbnail: true,
      embedMetadata: true,
      allowContinue: true,
      forceOverwrites: false,
    },
    {
      embedThumbnail: false,
      embedMetadata: true,
      allowContinue: false,
      forceOverwrites: true,
    },
    {
      embedThumbnail: false,
      embedMetadata: false,
      allowContinue: false,
      forceOverwrites: true,
    },
  ];

  let lastError: unknown;
  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) {
      clearAllJobFiles(job.id);
      patchJob(job.id, {
        message: `Retrying download (${i + 1}/${attempts.length})…`,
      });
    }
    try {
      await runYtdlp(job, attempts[i]!);
      return;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isPostprocessFailure(msg) || i === attempts.length - 1) {
        throw err;
      }
    }
  }
  throw lastError;
}

async function publishStableDownload(
  jobId: string,
  sourcePath: string,
  destName: "download.mp3" | "download.zip",
): Promise<string> {
  const destPath = path.join(jobDir(jobId), destName);
  await fs.promises.copyFile(sourcePath, destPath);
  return destPath;
}

async function finalizeOutput(job: Job): Promise<string> {
  const filesDir = jobFilesDir(job.id);
  const mp3s = listMp3Files(filesDir);

  if (mp3s.length === 0) {
    throw new Error(
      "No MP3 files were produced. If YouTube blocked the download, quit Chrome and set YT_DLP_COOKIES_FROM_BROWSER=chrome, then retry.",
    );
  }

  if (job.isPlaylist && mp3s.length > 1) {
    patchJob(job.id, { status: "zipping", progress: 99, message: "Creating ZIP…" });
    const zipPath = path.join(jobDir(job.id), "playlist-temp.zip");
    await zipDirectory(filesDir, zipPath);
    return publishStableDownload(job.id, zipPath, "download.zip");
  }

  if (mp3s.length === 1) {
    return publishStableDownload(job.id, mp3s[0]!, "download.mp3");
  }

  patchJob(job.id, { status: "zipping", progress: 99, message: "Creating ZIP…" });
  const zipPath = path.join(jobDir(job.id), "playlist-temp.zip");
  await zipDirectory(filesDir, zipPath);
  return publishStableDownload(job.id, zipPath, "download.zip");
}

export async function runJob(jobId: string): Promise<void> {
  if (active.has(jobId)) return;
  active.add(jobId);

  const job = getJob(jobId);
  if (!job) {
    active.delete(jobId);
    return;
  }

  try {
    patchJob(jobId, {
      status: "running",
      progress: 0,
      message: "Starting download…",
    });

    const probe = await probePlaylist(job.url);
    if (probe.title) {
      patchJob(jobId, {
        title: probe.title,
        entryCount: probe.count,
      });
    }

    await runYtdlpWithRetry(job);

    const outputFile = await finalizeOutput(job);
    const base = path.basename(outputFile);

    patchJob(jobId, {
      status: "completed",
      progress: 100,
      message: "Ready to download",
      outputFile: base,
      entriesDone: listMp3Files(jobFilesDir(jobId)).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed";
    patchJob(jobId, {
      status: "failed",
      error: message,
      message,
    });
  } finally {
    active.delete(jobId);
  }
}

export function enqueueJob(jobId: string): void {
  setImmediate(() => {
    void runJob(jobId);
  });
}
