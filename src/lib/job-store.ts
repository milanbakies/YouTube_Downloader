import fs from "fs";
import { jobMetaPath } from "./paths";
import type { Job } from "./types";

const memory = new Map<string, Job>();

export function getJob(id: string): Job | undefined {
  if (memory.has(id)) return memory.get(id);
  const meta = jobMetaPath(id);
  if (!fs.existsSync(meta)) return undefined;
  const job = JSON.parse(fs.readFileSync(meta, "utf8")) as Job;
  memory.set(id, job);
  return job;
}

export function saveJob(job: Job): void {
  job.updatedAt = new Date().toISOString();
  memory.set(job.id, job);
  fs.writeFileSync(jobMetaPath(job.id), JSON.stringify(job, null, 2));
}

export function patchJob(id: string, patch: Partial<Job>): Job {
  const job = getJob(id);
  if (!job) throw new Error(`Job ${id} not found`);
  const next = { ...job, ...patch };
  saveJob(next);
  return next;
}
