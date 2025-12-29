import cron, { ScheduledTask } from "node-cron";
import { prisma } from "@configs/database.config";
import logger from "@utils/logger";

// Cron task reference
let cronTask: ScheduledTask | null = null;

// Configuration
// Run daily at 3:00 AM
const CRON_SCHEDULE = process.env.CHAT_CLEANUP_CRON || "0 3 * * *";
// Delete chat messages for streams that ended more than 24 hours ago and have no VOD
const CLEANUP_THRESHOLD_HOURS = parseInt(
  process.env.CHAT_CLEANUP_THRESHOLD_HOURS || "24",
  10
);
const BATCH_SIZE = parseInt(process.env.CHAT_CLEANUP_BATCH_SIZE || "1000", 10);

interface CleanupResult {
  streamsProcessed: number;
  messagesDeleted: number;
  moderationLogsDeleted: number;
}

// Main cleanup function
export const cleanupOrphanedChatMessages = async (): Promise<CleanupResult> => {
  const result: CleanupResult = {
    streamsProcessed: 0,
    messagesDeleted: 0,
    moderationLogsDeleted: 0,
  };

  try {
    const thresholdDate = new Date(
      Date.now() - CLEANUP_THRESHOLD_HOURS * 60 * 60 * 1000
    );

    // Find streams that:
    // 1. Have ended (status = ENDED)
    // 2. Ended more than threshold hours ago
    // 3. Have no VOD video (vodVideoId is null)
    // 4. Have chat messages to clean up
    const streamsToCleanup = await prisma.liveStream.findMany({
      where: {
        status: "ENDED",
        endedAt: { lt: thresholdDate },
        vodVideoId: null,
      },
      select: {
        id: true,
        title: true,
        endedAt: true,
        _count: {
          select: {
            chatMessages: true,
            moderationLogs: true,
          },
        },
      },
    });

    if (streamsToCleanup.length === 0) {
      logger.debug("Chat cleanup: No streams to clean up");
      return result;
    }

    logger.info(
      `Chat cleanup: Found ${streamsToCleanup.length} streams to process`
    );

    for (const stream of streamsToCleanup) {
      const messageCount = stream._count.chatMessages;
      const moderationCount = stream._count.moderationLogs;

      if (messageCount === 0 && moderationCount === 0) {
        continue;
      }

      logger.info(
        `Chat cleanup: Processing stream ${stream.id} (${stream.title || "Untitled"}) - ` +
          `${messageCount} messages, ${moderationCount} moderation logs`
      );

      // Delete chat messages in batches to avoid timeout
      let deletedMessages = 0;
      while (deletedMessages < messageCount) {
        const deleted = await prisma.chatMessage.deleteMany({
          where: { streamId: stream.id },
        });
        deletedMessages += deleted.count;

        if (deleted.count < BATCH_SIZE) break;
      }

      // Delete moderation logs
      const deletedModerationLogs = await prisma.moderationLog.deleteMany({
        where: { streamId: stream.id },
      });

      result.messagesDeleted += deletedMessages;
      result.moderationLogsDeleted += deletedModerationLogs.count;
      result.streamsProcessed++;

      logger.info(
        `Chat cleanup: Cleaned stream ${stream.id} - ` +
          `${deletedMessages} messages, ${deletedModerationLogs.count} moderation logs deleted`
      );
    }

    logger.info(
      `Chat cleanup complete: ${result.streamsProcessed} streams, ` +
        `${result.messagesDeleted} messages, ${result.moderationLogsDeleted} moderation logs deleted`
    );
  } catch (error) {
    logger.error("Chat cleanup job error:", error);
  }

  return result;
};

// Get stats about orphaned chat data
export const getOrphanedChatStats = async (): Promise<{
  streamsWithOrphanedChat: number;
  orphanedMessages: number;
  orphanedModerationLogs: number;
}> => {
  const thresholdDate = new Date(
    Date.now() - CLEANUP_THRESHOLD_HOURS * 60 * 60 * 1000
  );

  const streams = await prisma.liveStream.findMany({
    where: {
      status: "ENDED",
      endedAt: { lt: thresholdDate },
      vodVideoId: null,
    },
    select: {
      _count: {
        select: {
          chatMessages: true,
          moderationLogs: true,
        },
      },
    },
  });

  return {
    streamsWithOrphanedChat: streams.length,
    orphanedMessages: streams.reduce((sum, s) => sum + s._count.chatMessages, 0),
    orphanedModerationLogs: streams.reduce(
      (sum, s) => sum + s._count.moderationLogs,
      0
    ),
  };
};

// Start the chat cleanup cron job
export const startChatCleanupJob = (): void => {
  // Schedule recurring job
  cronTask = cron.schedule(CRON_SCHEDULE, cleanupOrphanedChatMessages);

  logger.info(
    `Chat cleanup job started (schedule: ${CRON_SCHEDULE}, ` +
      `threshold: ${CLEANUP_THRESHOLD_HOURS}h, batch: ${BATCH_SIZE})`
  );
};

// Stop the chat cleanup job
export const stopChatCleanupJob = (): void => {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info("Chat cleanup job stopped");
  }
};

// Manual trigger for cleanup (e.g., via admin API)
export const triggerChatCleanup = async (): Promise<CleanupResult> => {
  logger.info("Chat cleanup triggered manually");
  return cleanupOrphanedChatMessages();
};
