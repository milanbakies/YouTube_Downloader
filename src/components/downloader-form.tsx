"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isValidYouTubeUrl, normalizeYouTubeUrl } from "@/lib/youtube-url";
import { AUDIO_QUALITIES, type AudioQuality, type Job } from "@/lib/types";
import { Download, Loader2, Music2 } from "lucide-react";

type Health = {
  ok: boolean;
  ytdlp: { path: string; version: string | null };
  ffmpeg: { path: string; version: string | null };
};

export function DownloaderForm() {
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState<AudioQuality>(192);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const poll = useCallback(async (jobId: string) => {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) return;
    const data = (await res.json()) as { job: Job };
    setJob(data.job);
    if (data.job.status === "queued" || data.job.status === "running" || data.job.status === "zipping") {
      return false;
    }
    return true;
  }, []);

  useEffect(() => {
    if (!job?.id) return;
    if (
      job.status === "completed" ||
      job.status === "failed"
    ) {
      return;
    }

    const id = job.id;
    const timer = setInterval(async () => {
      const done = await poll(id);
      if (done) clearInterval(timer);
    }, 1500);

    return () => clearInterval(timer);
  }, [job?.id, job?.status, poll]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJob(null);

    const normalized = normalizeYouTubeUrl(url);
    if (!isValidYouTubeUrl(normalized)) {
      setError(
        "Enter a valid YouTube video or playlist link (youtube.com or youtu.be).",
      );
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalized, quality }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not start download");
        return;
      }
      setJob(data.job as Job);
    } catch {
      setError("Network error — is the dev server running?");
    } finally {
      setSubmitting(false);
    }
  }

  const busy =
    job &&
    (job.status === "queued" ||
      job.status === "running" ||
      job.status === "zipping");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Music2 className="size-6" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          YouTube to MP3
        </h1>
        <p className="text-sm text-muted-foreground">
          Paste a video or playlist link. Long streams and multi-hour playlists
          are supported — the server keeps working in the background.
        </p>
      </div>

      {health && !health.ok && (
        <Alert variant="destructive">
          <AlertTitle>Missing tools</AlertTitle>
          <AlertDescription>
            Install ffmpeg and yt-dlp on this machine (see README), then restart
            the dev server.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Download</CardTitle>
          <CardDescription>
            Playlists are packed into a ZIP when finished.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="url">YouTube URL</Label>
              <Input
                id="url"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://www.youtube.com/watch?v=… or playlist URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData("text");
                  if (!pasted) return;
                  e.preventDefault();
                  setUrl(pasted.trim());
                }}
                disabled={Boolean(busy)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Audio quality (kbps)</Label>
              <Select
                value={String(quality)}
                onValueChange={(v) => setQuality(Number(v) as AudioQuality)}
                disabled={Boolean(busy)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIO_QUALITIES.map((q) => (
                    <SelectItem key={q} value={String(q)}>
                      {q} kbps
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              disabled={submitting || Boolean(busy) || !url.trim()}
            >
              {submitting || busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Working…
                </>
              ) : (
                "Start conversion"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {job && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {job.title ?? "Your download"}
            </CardTitle>
            <CardDescription className="capitalize">
              Status: {job.status.replace("_", " ")}
              {job.isPlaylist && " · playlist"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {(job.status === "running" ||
              job.status === "zipping" ||
              job.status === "queued") && (
              <>
                <Progress value={job.progress} className="h-2" />
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {job.message}
                </p>
                {job.entryCount != null && job.entryCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Tracks: {job.entriesDone ?? 0} / {job.entryCount}
                  </p>
                )}
              </>
            )}

            {job.status === "failed" && (
              <Alert variant="destructive">
                <AlertTitle>Failed</AlertTitle>
                <AlertDescription>
                  {job.error ?? job.message}
                </AlertDescription>
              </Alert>
            )}

            {job.status === "completed" && (
              <a
                href={`/api/jobs/${job.id}/download`}
                className={cn(buttonVariants(), "w-full")}
                download
              >
                <Download className="size-4" />
                Download {job.outputFile?.endsWith(".zip") ? "ZIP" : "MP3"}
              </a>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
