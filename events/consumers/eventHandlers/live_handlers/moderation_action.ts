import * as moderationRepo from "@repository/moderation.repository";
import * as chatRepo from "@repository/chat.repository";
import { invalidateChatCache } from "@helpers/cacheInvalidations/chatCacheInvalidation";
import { ModerationPayload } from "@types";
import logger from "@utils/logger";


export const handleModerationAction = async (payload: ModerationPayload) => {
  const {
    streamId,
    moderatorId,
    targetUserId,
    action,
    reason,
    expiresAt,
    deleteMessages,
  } = payload;

  try {
    const log = await moderationRepo.createModerationLog({
      streamId,
      moderatorId,
      targetUserId,
      action,
      reason,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    await moderationRepo.invalidateModerationCache(streamId, targetUserId);

    if (action === "BAN" && deleteMessages) {
      await chatRepo.deleteUserMessagesInStream(streamId, targetUserId);
      await invalidateChatCache();
    }

    if (action === "UNBAN") {
      await moderationRepo.removeBan(streamId, targetUserId);
    }

    logger.info(
      `Moderation action ${action} on user ${targetUserId} by ${moderatorId}`
    );

    return { success: true, logId: log.id };
  } catch (error: any) {
    logger.error(`Failed to process moderation action: ${error.message}`);
    throw error;
  }
};
