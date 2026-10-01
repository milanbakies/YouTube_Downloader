import Link from "next/link";
import { notFound } from "next/navigation";
import { JobAutoRefresh } from "@/components/job-auto-refresh";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getJob } from "@/lib/job-store";
import { cn } from "@/lib/utils";
import { Download } from "lucide-react";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function JobPage({ params }: PageProps) {
  const { id } = await params;
  const job = getJob(id);

  if (!job) {
    notFound();
  }

  const inProgress =
    job.status === "queued" ||
    job.status === "running" ||
    job.status === "zipping";

  const downloadLabel = job.outputFile?.endsWith(".zip")
    ? "Download ZIP"
    : "Download MP3";

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/40 px-4 py-12">
      <JobAutoRefresh active={inProgress} />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div className="text-center">
          <Link
            href="/"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← New conversion
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {job.title ?? "Your download"}
            </CardTitle>
            <CardDescription className="capitalize">
              Status: {job.status.replace("_", " ")}
              {job.isPlaylist ? " · playlist" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {inProgress && (
              <>
                <Progress value={job.progress} className="h-2" />
                <p className="text-sm text-muted-foreground">{job.message}</p>
                {job.entryCount != null && job.entryCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Tracks: {job.entriesDone ?? 0} / {job.entryCount}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  This page refreshes every few seconds until the file is ready.
                </p>
              </>
            )}

            {job.status === "failed" && (
              <p className="text-sm text-destructive">
                {job.error ?? job.message}
              </p>
            )}

            {job.status === "completed" && (
              <a
                href={`/api/jobs/${job.id}/download`}
                className={cn(buttonVariants(), "w-full")}
              >
                <Download className="size-4" />
                {downloadLabel}
              </a>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
