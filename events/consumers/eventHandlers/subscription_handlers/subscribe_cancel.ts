import * as subscriptionService from "@services/subscription.service";
import { UnsubscribePayload } from "@types";
import logger from "@utils/logger";

export const handleSubscriptionCancelled = async (payload: UnsubscribePayload) => {
  try {
    const { userId, channelId } = payload;

    logger.info(`Processing unsubscribe request for user ${userId} from channel ${channelId}`);

    await subscriptionService.unsubscribe(userId, channelId);

    logger.info(`Unsubscribed user ${userId} from channel ${channelId}`);
  } catch (error) {
    logger.error(`Failed to process subscription cancelled:`, error);
    throw error;
  }
};
