/**
 * Pure export-queue state machine: enqueue, run, progress, pause, resume,
 * cancel, fail. The main-process worker drives real FFmpeg jobs; this reducer
 * owns the state transitions so they're unit-tested and UI-agnostic.
 */
export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';

export interface ExportJob {
  id: string;
  label: string;
  status: JobStatus;
  progress: number; // 0..1
  error?: string;
}

export type QueueAction =
  | { type: 'enqueue'; id: string; label: string }
  | { type: 'start'; id: string }
  | { type: 'progress'; id: string; progress: number }
  | { type: 'pause'; id: string }
  | { type: 'resume'; id: string }
  | { type: 'complete'; id: string }
  | { type: 'cancel'; id: string }
  | { type: 'fail'; id: string; error: string };

const TERMINAL: ReadonlySet<JobStatus> = new Set(['completed', 'cancelled', 'failed']);

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1);
}

export function queueReducer(jobs: readonly ExportJob[], action: QueueAction): ExportJob[] {
  if (action.type === 'enqueue') {
    if (jobs.some((j) => j.id === action.id)) return [...jobs];
    return [...jobs, { id: action.id, label: action.label, status: 'queued', progress: 0 }];
  }

  return jobs.map((job) => {
    if (job.id !== action.id || TERMINAL.has(job.status)) return job;
    switch (action.type) {
      case 'start':
        return job.status === 'queued' ? { ...job, status: 'running' } : job;
      case 'progress':
        return job.status === 'running' ? { ...job, progress: clamp01(action.progress) } : job;
      case 'pause':
        return job.status === 'running' ? { ...job, status: 'paused' } : job;
      case 'resume':
        return job.status === 'paused' ? { ...job, status: 'running' } : job;
      case 'complete':
        return { ...job, status: 'completed', progress: 1 };
      case 'cancel':
        return { ...job, status: 'cancelled' };
      case 'fail':
        return { ...job, status: 'failed', error: action.error };
      default:
        return job;
    }
  });
}

/** The next job that should run (only one runs at a time). */
export function nextRunnable(jobs: readonly ExportJob[]): ExportJob | null {
  if (jobs.some((j) => j.status === 'running')) return null;
  return jobs.find((j) => j.status === 'queued') ?? null;
}
