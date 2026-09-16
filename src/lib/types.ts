export const AUDIO_QUALITIES = [128, 192, 256, 320] as const;
export type AudioQuality = (typeof AUDIO_QUALITIES)[number];

export type JobStatus =
  | "queued"
  | "running"
  | "zipping"
  | "completed"
  | "failed";

export interface Job {
  id: string;
  url: string;
  quality: AudioQuality;
  status: JobStatus;
  progress: number;
  message: string;
  isPlaylist: boolean;
  title?: string;
  createdAt: string;
  updatedAt: string;
  outputFile?: string;
  error?: string;
  entryCount?: number;
  entriesDone?: number;
}

export interface CreateJobBody {
  url: string;
  quality: AudioQuality;
}
