import * as subscriptionService from "@services/subscription.service";
import logger from "@utils/logger";

interface SubscribePayload {
  userId: string;
  channelId: string;
  endDate?: string | null;
  timestamp: string;
}

export const handleSubscriptionCreated = async (payload: SubscribePayload) => {
  try {
    const { userId, channelId, endDate } = payload;

    logger.info(`Processing subscription request for user ${userId} to channel ${channelId}`);

    await subscriptionService.subscribe(
      userId,
      channelId,
      endDate ? new Date(endDate) : undefined,
    );

    logger.info(`Subscription created for user ${userId} to channel ${channelId}`);
  } catch (error) {
    logger.error(`Failed to process subscription created:`, error);
    throw error;
  }
};
