import * as subscriptionService from "@services/subscription.service";
import logger from "@utils/logger";

interface BatchSubscribePayload {
  subscriptions: Array<{ userId: string; channelId: string; endDate?: string }>;
  triggeredBy: string;
  timestamp: string;
}

export const handleSubscriptionBatchCreate = async (payload: BatchSubscribePayload) => {
  try {
    const { subscriptions, triggeredBy } = payload;

    logger.info(`Processing batch subscription for ${subscriptions.length} items, triggered by ${triggeredBy}`);

    const formattedSubscriptions = subscriptions.map((sub) => ({
      userId: sub.userId,
      channelId: sub.channelId,
      endDate: sub.endDate ? new Date(sub.endDate) : undefined,
    }));

    const result = await subscriptionService.batchSubscribe(formattedSubscriptions);

    logger.info(`Batch created ${result.count} subscriptions`);
  } catch (error) {
    logger.error(`Failed to process batch subscription:`, error);
    throw error;
  }
};
