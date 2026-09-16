import { getJob } from "@/lib/job-store";
import { createRangeResponse, resolveJobOutput } from "@/lib/stream-file";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const job = getJob(id);

  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "completed" || !job.outputFile) {
    return Response.json(
      { error: "Download not ready", status: job.status },
      { status: 409 },
    );
  }

  try {
    const filePath = resolveJobOutput(id, job.outputFile);
    const isZip = job.outputFile.toLowerCase().endsWith(".zip");
    const contentType = isZip ? "application/zip" : "audio/mpeg";
    const range = request.headers.get("range");

    return createRangeResponse(
      filePath,
      range,
      contentType,
      job.outputFile,
    );
  } catch {
    return Response.json({ error: "File missing on server" }, { status: 410 });
  }
}
