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

/** Long audiobooks can sit in ffmpeg for 10+ minutes with no yt-dlp lines. */
const YTDLP_NO_OUTPUT_MS = 90 * 60 * 1000;
const PROBE_TIMEOUT_MS = 45 * 1000;
const MIN_AUDIO_BYTES = 256 * 1024;

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
            "yt-dlp stalled (no output for 90 minutes). For long audiobooks, leave the job running while ffmpeg converts.",
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
  mode: "extract-mp3" | "download-only";
  embedThumbnail: boolean;
  embedMetadata: boolean;
  allowContinue: boolean;
  forceOverwrites: boolean;
  /** Signed-in cookies can force a broken SABR stub. Use only after a bot check. */
  useCookies: boolean;
};

const AUDIO_SOURCE_EXT = new Set([
  ".webm",
  ".m4a",
  ".opus",
  ".ogg",
  ".mp4",
  ".mkv",
  ".wav",
]);

function listAudioSources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => {
      const lower = f.toLowerCase();
      if (lower.endsWith(".mp3")) return false;
      const ext = path.extname(lower);
      return AUDIO_SOURCE_EXT.has(ext);
    })
    .map((f) => path.join(dir, f));
}

function spawnFfmpegMp3(
  inputPath: string,
  outputPath: string,
  quality: AudioQuality,
  onProgress?: (ratio: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = ffmpegPath();
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vn",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      `${quality}k`,
      "-progress",
      "pipe:1",
      "-nostats",
      outputPath,
    ];
    const proc = spawn(ff, args, {
      env: {
        ...process.env,
        PATH: `${path.dirname(ff)}:${process.env.PATH ?? ""}`,
      },
    });

    let buf = "";
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      let durationMs: number | null = null;
      let outTimeMs: number | null = null;
      for (const line of lines) {
        if (line.startsWith("duration=")) {
          const v = parseFloat(line.slice("duration=".length));
          if (!Number.isNaN(v)) durationMs = v * 1_000_000;
        }
        if (line.startsWith("out_time_ms=")) {
          const v = parseInt(line.slice("out_time_ms=".length), 10);
          if (!Number.isNaN(v)) outTimeMs = v;
        }
      }
      if (durationMs && outTimeMs && durationMs > 0 && onProgress) {
        onProgress(Math.min(99, (outTimeMs / durationMs) * 100));
      }
    });

    let stderr = "";
    proc.stderr.on("data", (c) => {
      stderr = (stderr + c.toString()).slice(-2000);
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (exit ${code ?? "?"}). ${stderr}`.trim()));
    });
  });
}

async function convertSourcesToMp3(job: Job): Promise<void> {
  const dir = jobFilesDir(job.id);
  const sources = listAudioSources(dir);
  if (sources.length === 0) {
    throw new Error(
      "No audio file was downloaded to convert. Try npm run cookies:export and retry.",
    );
  }

  for (const src of sources) {
    const st = fs.statSync(src);
    if (st.size < MIN_AUDIO_BYTES) {
      throw new Error(
        "Downloaded file is too small (likely a YouTube block page). Run npm run cookies:export, then retry.",
      );
    }
    const out = `${src.slice(0, -path.extname(src).length)}.mp3`;
    patchJob(job.id, {
      message: `Converting to MP3 (${path.basename(src)})…`,
      progress: 85,
    });
    await spawnFfmpegMp3(src, out, job.quality, (pct) => {
      patchJob(job.id, {
        progress: Math.round(85 + pct * 0.14),
        message: `Converting to MP3… ${Math.round(pct)}%`,
      });
    });
    try {
      fs.unlinkSync(src);
    } catch {
      /* keep source if delete fails */
    }
  }
}

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

  if (options.mode === "extract-mp3") {
    args.push(
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--postprocessor-args",
      extractAudioPostArgs(job.quality),
    );
  }

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

  if (options.useCookies) {
    args.push(...ytdlpCookieCliArgs());
  }

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

  if (code === 0) {
    if (options.mode === "download-only") {
      await convertSourcesToMp3(job);
    }
    assertMp3sAreReal(job.id);
    return;
  }

  if (options.mode === "download-only" && listAudioSources(outDir).length > 0) {
    try {
      await convertSourcesToMp3(job);
      return;
    } catch {
      /* fall through */
    }
  }

  throw new Error(stderrTail || `yt-dlp exited with code ${code ?? "?"}`);
}

function assertMp3sAreReal(jobId: string): void {
  const mp3s = listMp3Files(jobFilesDir(jobId));
  if (mp3s.length === 0) return;
  const real = mp3s.filter((f) => fs.statSync(f).size >= MIN_AUDIO_BYTES);
  if (real.length === 0) {
    throw new Error(
      "Postprocessing: Invalid data found when processing input (output was only a stub)",
    );
  }
}

function isBotCheck(message: string): boolean {
  return /Sign in to confirm|not a bot/i.test(message);
}

function isPostprocessFailure(message: string): boolean {
  return /Invalid data found when processing input|Error opening input files|Postprocessing|only a stub|SABR/i.test(
    message,
  );
}

async function runYtdlpWithRetry(job: Job): Promise<void> {
  const attempts: YtdlpRunOptions[] = [
    {
      mode: "extract-mp3",
      embedThumbnail: true,
      embedMetadata: true,
      allowContinue: false,
      forceOverwrites: true,
      useCookies: false,
    },
    {
      mode: "extract-mp3",
      embedThumbnail: false,
      embedMetadata: false,
      allowContinue: false,
      forceOverwrites: true,
      useCookies: false,
    },
    {
      mode: "download-only",
      embedThumbnail: false,
      embedMetadata: false,
      allowContinue: false,
      forceOverwrites: true,
      useCookies: false,
    },
  ];

  let lastError: unknown;
  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) {
      clearAllJobFiles(job.id);
      patchJob(job.id, {
        message: `Retrying without browser cookies (${i + 1}/${attempts.length})…`,
      });
    }
    try {
      await runYtdlp(job, attempts[i]!);
      return;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (isBotCheck(msg) && ytdlpCookieCliArgs().length > 0) {
        clearAllJobFiles(job.id);
        patchJob(job.id, {
          message: "YouTube asked for sign-in. Retrying with saved cookies…",
        });
        try {
          await runYtdlp(job, {
            mode: "download-only",
            embedThumbnail: false,
            embedMetadata: false,
            allowContinue: false,
            forceOverwrites: true,
            useCookies: true,
          });
          return;
        } catch (cookieErr) {
          lastError = cookieErr;
        }
      }
      const recoverable =
        isPostprocessFailure(msg) ||
        isBotCheck(msg) ||
        /too small|likely a YouTube block/i.test(msg);
      if (!recoverable || i === attempts.length - 1) {
        const raw = lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(formatYtdlpFailure(raw, null));
      }
    }
  }
  const raw = lastError instanceof Error ? lastError.message : "Download failed";
  throw new Error(formatYtdlpFailure(raw, null));
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
