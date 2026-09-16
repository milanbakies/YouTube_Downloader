import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { patchJob, getJob } from "./job-store";
import {
  cookiesFromBrowser,
  ffmpegPath,
  jobDir,
  jobFilesDir,
  ytdlpPath,
} from "./paths";
import type { AudioQuality, Job } from "./types";
import { zipDirectory } from "./zip";

const active = new Set<string>();

function bitrateArg(quality: AudioQuality): string {
  return `ffmpeg:-b:a ${quality}k`;
}

function parseProgressLine(line: string): number | null {
  const m = line.match(/(\d+(?:\.\d+)?)%/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  return Math.min(100, Math.max(0, n));
}

async function probePlaylist(url: string): Promise<{ title?: string; count?: number }> {
  return new Promise((resolve) => {
    const args = [
      "--flat-playlist",
      "--dump-single-json",
      "--no-warnings",
      url,
    ];
    if (cookiesFromBrowser()) {
      args.unshift("--cookies-from-browser", cookiesFromBrowser()!);
    }
    const proc = spawn(ytdlpPath(), args, { env: process.env });
    let out = "";
    proc.stdout.on("data", (c) => {
      out += c.toString();
    });
    proc.on("close", () => {
      try {
        const data = JSON.parse(out);
        const title = data.title as string | undefined;
        const count =
          typeof data.playlist_count === "number"
            ? data.playlist_count
            : Array.isArray(data.entries)
              ? data.entries.length
              : undefined;
        resolve({ title, count });
      } catch {
        resolve({});
      }
    });
    proc.on("error", () => resolve({}));
  });
}

function listMp3Files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".mp3"))
    .map((f) => path.join(dir, f));
}

async function runYtdlp(job: Job): Promise<void> {
  const outDir = jobFilesDir(job.id);
  const outputTemplate = path.join(outDir, "%(title).200B [%(id)s].%(ext)s");

  const args = [
    "--newline",
    "--no-color",
    "--ffmpeg-location",
    path.dirname(ffmpegPath()),
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--postprocessor-args",
    bitrateArg(job.quality),
    "-o",
    outputTemplate,
    "--embed-thumbnail",
    "--embed-metadata",
    "--no-overwrites",
    "--continue",
    "--retries",
    "10",
    "--fragment-retries",
    "10",
  ];

  if (job.isPlaylist) {
    args.push("--yes-playlist");
  } else {
    args.push("--no-playlist");
  }

  const cookies = cookiesFromBrowser();
  if (cookies) {
    args.push("--cookies-from-browser", cookies);
  }

  args.push(job.url);

  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath(), args, {
      env: {
        ...process.env,
        PATH: `${path.dirname(ffmpegPath())}:${process.env.PATH ?? ""}`,
      },
    });

    let lastPct = 0;

    const onLine = (line: string) => {
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
    };

    proc.stdout.on("data", (chunk) => {
      chunk
        .toString()
        .split("\n")
        .forEach(onLine);
    });
    proc.stderr.on("data", (chunk) => {
      chunk
        .toString()
        .split("\n")
        .forEach(onLine);
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited with code ${code ?? "unknown"}`));
    });
  });
}

async function finalizeOutput(job: Job): Promise<string> {
  const filesDir = jobFilesDir(job.id);
  const mp3s = listMp3Files(filesDir);

  if (mp3s.length === 0) {
    throw new Error("No MP3 files were produced. Check the URL and cookies.");
  }

  if (job.isPlaylist && mp3s.length > 1) {
    patchJob(job.id, { status: "zipping", progress: 99, message: "Creating ZIP…" });
    const zipPath = path.join(jobDir(job.id), "playlist.zip");
    await zipDirectory(filesDir, zipPath);
    return zipPath;
  }

  if (mp3s.length === 1) {
    return mp3s[0]!;
  }

  patchJob(job.id, { status: "zipping", progress: 99, message: "Creating ZIP…" });
  const zipPath = path.join(jobDir(job.id), "download.zip");
  await zipDirectory(filesDir, zipPath);
  return zipPath;
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

    await runYtdlp(job);

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
