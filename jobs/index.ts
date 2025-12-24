import { startCDNSyncJob, stopCDNSyncJob } from "./cdn-sync.job";
import logger from "@utils/logger";

// Start all background jobs
export const startAllJobs = (): void => {
  logger.info("♻️ Starting background jobs...");

  startCDNSyncJob();

  logger.info("▶️ All background jobs started");
};

// Stop all background jobs (for graceful shutdown)
export const stopAllJobs = (): void => {
  logger.info("⏹️ Stopping background jobs...");

  stopCDNSyncJob();

  logger.info("🛑 All background jobs stopped");
};
