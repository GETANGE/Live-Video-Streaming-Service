import { consumeVideoQueue, getVideoQueueMetrics } from "./video.consumer";
import { consumeGeneralQueue, getGeneralQueueMetrics } from "./general.consumer";
import logger from "@utils/logger";

// Start all consumers
export const consumeMessage = async () => {
  logger.info("Starting queue consumers...");

  // Start both consumers in parallel
  await Promise.all([
    consumeVideoQueue(),
    consumeGeneralQueue(),
  ]);

  logger.info("All queue consumers started");
};

// Get combined queue metrics
export const getQueueMetrics = () => ({
  video: getVideoQueueMetrics(),
  general: getGeneralQueueMetrics(),
});
