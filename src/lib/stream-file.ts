import fs from "fs";
import path from "path";
import { Readable } from "stream";

export function resolveJobOutput(jobId: string, outputFile: string): string {
  const jobRoot = path.join(process.cwd(), ".data", "jobs", jobId);
  const stableMp3 = path.join(jobRoot, "download.mp3");
  const stableZip = path.join(jobRoot, "download.zip");
  if (fs.existsSync(stableMp3)) return stableMp3;
  if (fs.existsSync(stableZip)) return stableZip;

  const base = path.basename(outputFile);
  const resolved = path.join(jobRoot, base);
  const filesAlt = path.join(jobRoot, "files", base);
  if (fs.existsSync(resolved)) return resolved;
  if (fs.existsSync(filesAlt)) return filesAlt;
  throw new Error("Output file not found");
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export function createRangeResponse(
  filePath: string,
  rangeHeader: string | null,
  contentType: string,
  downloadName: string,
): Response {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const disposition = contentDisposition(downloadName);

  if (!rangeHeader) {
    const stream = fs.createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(size),
        "Content-Disposition": disposition,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return new Response("Invalid Range", { status: 416 });
  }

  let start = match[1] ? parseInt(match[1], 10) : 0;
  let end = match[2] ? parseInt(match[2], 10) : size - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    return new Response("Invalid Range", { status: 416 });
  }

  end = Math.min(end, size - 1);
  const chunkSize = end - start + 1;
  const stream = fs.createReadStream(filePath, { start, end });

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Disposition": disposition,
      "Accept-Ranges": "bytes",
    },
  });
}
