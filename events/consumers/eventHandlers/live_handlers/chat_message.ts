import * as chatRepo from "@repository/chat.repository";
import { invalidateChatCache } from "@helpers/cacheInvalidations/chatCacheInvalidation";
import { ChatMessagePayload } from "@types";
import logger from "@utils/logger";


export const handleChatMessage = async (payload: ChatMessagePayload) => {
  const { streamId, userId, message, flagged, messageId } = payload;

  try {
    // If messageId exists, message was already created (real-time path)
    // Just handle flagging and cache invalidation
    if (messageId) {
      if (flagged) {
        await chatRepo.flagChatMessage(messageId);
        logger.warn(`Chat message flagged: ${messageId}`);
      }
      await invalidateChatCache();
      return { success: true, messageId };
    }

    // Fallback: create message if not already created
    const chatMessage = await chatRepo.createChatMessage({
      streamId,
      userId,
      message,
    });

    if (flagged) {
      await chatRepo.flagChatMessage(chatMessage.id);
      logger.warn(`Chat message flagged: ${chatMessage.id}`);
    }

    await invalidateChatCache();

    logger.debug(`Chat message persisted: ${chatMessage.id}`);
    return { success: true, messageId: chatMessage.id };
  } catch (error: any) {
    logger.error(`Failed to persist chat message: ${error.message}`);
    throw error;
  }
};
