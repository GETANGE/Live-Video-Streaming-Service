import { Worker } from "worker_threads";
import { TranscodeTask, WorkerResult } from "@types";
import { join } from "path";
import logger from "@utils/logger";

type ProgressCallback = (quality: string, percent: number) => void;

// Run a single transcode task in a worker thread
const runWorker = (
  task: TranscodeTask,
  onProgress?: ProgressCallback,
): Promise<WorkerResult> => {
  return new Promise((resolve, reject) => {
    const workerPath = join(__dirname, "../workers/transcode.worker.js");

    const worker = new Worker(workerPath, {
      workerData: task,
    });

    worker.on("message", (msg) => {
      if (msg.type === "progress") {
        const percent = Math.round(msg.percent);
        logger.debug(`[${msg.quality}] Progress: ${percent}%`);
        onProgress?.(msg.quality, percent);
      } else if (msg.type === "info") {
        logger.info(`[${msg.quality}] ${msg.message}`);
      } else if (msg.type === "done") {
        onProgress?.(msg.quality, 100);
        resolve({ quality: msg.quality, success: true });
      } else if (msg.type === "error") {
        resolve({ quality: msg.quality, success: false, error: msg.error });
      }
    });

    worker.on("error", (err) => {
      reject(err);
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Worker exited with code ${code}`));
      }
    });
  });
};

// Transcode quality variants sequentially (one at a time: 360p → 720p → 1080p)
export const transcodeInParallel = async (
  tasks: TranscodeTask[],
  onProgress?: ProgressCallback,
): Promise<WorkerResult[]> => {
  logger.info(`Starting sequential transcode: ${tasks.length} variants`);

  const startTime = Date.now();
  const results: WorkerResult[] = [];

  // Process each quality preset one at a time in order
  for (const task of tasks) {
    logger.info(`Starting transcode for ${task.preset.name}...`);
    const result = await runWorker(task, onProgress);
    results.push(result);

    if (result.success) {
      logger.info(`Completed ${task.preset.name}`);
    } else {
      logger.error(`Failed ${task.preset.name}: ${result.error}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const failed = results.filter((r) => !r.success);

  if (failed.length > 0) {
    logger.error(`Transcode failed for: ${failed.map((f) => f.quality).join(", ")}`);
    throw new Error(`Failed to transcode: ${failed.map((f) => f.error).join("; ")}`);
  }

  logger.info(`Sequential transcode completed in ${elapsed}s`);

  return results;
};

export { ProgressCallback };
