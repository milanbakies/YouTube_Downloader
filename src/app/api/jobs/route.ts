import { randomUUID } from "crypto";
import { z } from "zod";
import { enqueueJob } from "@/lib/download-runner";
import { saveJob } from "@/lib/job-store";
import { isPlaylistUrl, jobDir } from "@/lib/paths";
import { isValidYouTubeUrl, normalizeYouTubeUrl } from "@/lib/youtube-url";
import { AUDIO_QUALITIES, type Job } from "@/lib/types";

const schema = z.object({
  url: z
    .string()
    .transform((s) => normalizeYouTubeUrl(s))
    .refine((s) => isValidYouTubeUrl(s), {
      message: "Must be a valid YouTube video or playlist URL",
    }),
  quality: z.coerce
    .number()
    .refine((n) => (AUDIO_QUALITIES as readonly number[]).includes(n)),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { url, quality } = parsed.data;
  const id = randomUUID();
  const now = new Date().toISOString();
  const isPlaylist = isPlaylistUrl(url);

  jobDir(id);

  const job: Job = {
    id,
    url,
    quality: quality as Job["quality"],
    status: "queued",
    progress: 0,
    message: "Queued",
    isPlaylist,
    createdAt: now,
    updatedAt: now,
  };

  saveJob(job);
  enqueueJob(id);

  return Response.json({ job });
}
