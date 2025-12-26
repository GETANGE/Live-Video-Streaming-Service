import { Worker } from "worker_threads";
import { TranscodeTask, WorkerResult} from "@types";
import { cpus } from "os";
import { join } from "path";
import logger from "@utils/logger";


type ProgressCallback = (quality: string, percent: number) => void;

// Limit concurrent workers to avoid overwhelming CPU/memory
const MAX_CONCURRENT_WORKERS = Math.min(cpus().length, 4);

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

// Process tasks with controlled concurrency
const processWithConcurrency = async <T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> => {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = processor(item).then((result) => {
      results.push(result);
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(
        executing.findIndex((p) => p === promise),
        1,
      );
    }
  }

  await Promise.all(executing);
  return results;
};

// Transcode multiple quality variants in parallel using worker threads
export const transcodeInParallel = async (
  tasks: TranscodeTask[],
  onProgress?: ProgressCallback,
): Promise<WorkerResult[]> => {
  logger.info(
    `Starting parallel transcode: ${tasks.length} variants, max ${MAX_CONCURRENT_WORKERS} workers`,
  );

  const startTime = Date.now();

  const results = await processWithConcurrency(
    tasks,
    (task) => runWorker(task, onProgress),
    MAX_CONCURRENT_WORKERS,
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const failed = results.filter((r) => !r.success);

  if (failed.length > 0) {
    logger.error(`Transcode failed for: ${failed.map((f) => f.quality).join(", ")}`);
    throw new Error(`Failed to transcode: ${failed.map((f) => f.error).join("; ")}`);
  }

  logger.info(`Parallel transcode completed in ${elapsed}s`);

  return results;
};

export { MAX_CONCURRENT_WORKERS, ProgressCallback };
