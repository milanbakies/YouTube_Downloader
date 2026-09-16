import { ZipArchive } from "archiver";
import fs from "fs";
import path from "path";

export async function zipDirectory(
  sourceDir: string,
  destZip: string,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(destZip), { recursive: true });

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destZip);
    const archive = new ZipArchive({ zlib: { level: 5 } });

    output.on("close", () => resolve());
    archive.on("error", (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}
