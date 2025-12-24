import * as paymentService from "@services/payment.service";
import { MpesaSTKCallback } from "@types";
import logger from "@utils/logger";

interface PaymentCallbackPayload {
  stkCallback: MpesaSTKCallback;
  timestamp: string;
}

export const handlePaymentCallback = async (
  payload: PaymentCallbackPayload,
): Promise<void> => {
  try {
    const { stkCallback } = payload;

    logger.info(
      `✅ Processing payment callback: ${stkCallback.CheckoutRequestID}`,
    );

    await paymentService.processCallback(stkCallback);

    logger.info(`✅ Payment callback processed: ${stkCallback.CheckoutRequestID}`);
  } catch (error) {
    logger.error("❌ Failed to process payment callback:", error);
    throw error;
  }
};
