import { mpesaConfig } from "@constants/constant";
import * as paymentRepo from "@repository/payment.repository";
import { emitNotification } from "@configs/socket.config";
import { MpesaSTKCallback, ProcessedCallbackResult } from "@types";
import logger from "@utils/logger";

export const generatePassword = (timestamp: string): string => {
  const { passkey, shortCode } = mpesaConfig;

  const password = Buffer.from(`${passkey}${timestamp}${shortCode}`).toString(
    "base64",
  );
  return password;
};

export const generateTimestamp = (): string => {
  const date = new Date();
  const pad = (num: number) => num.toString().padStart(2, "0");

  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
};

// Extract metadata from M-Pesa callback
const extractCallbackMetadata = (callback: MpesaSTKCallback) => {
  const metadata: Record<string, string | number> = {};

  if (callback.CallbackMetadata?.Item) {
    for (const item of callback.CallbackMetadata.Item) {
      metadata[item.Name] = item.Value;
    }
  }

  return {
    amount: metadata.Amount as number,
    mpesaReceiptNumber: metadata.MpesaReceiptNumber as string,
    transactionDate: metadata.TransactionDate as number,
    phoneNumber: metadata.PhoneNumber as string,
  };
};

export const processCallback = async (
  callbackData: MpesaSTKCallback,
): Promise<ProcessedCallbackResult> => {
  const { CheckoutRequestID, ResultCode, ResultDesc } =
    callbackData;

  logger.info(
    `Processing M-Pesa callback: ${CheckoutRequestID}, ResultCode: ${ResultCode}`,
  );

  try {
    // Find the pending transaction
    const transaction =
      await paymentRepo.findTransactionByCheckoutId(CheckoutRequestID);

    if (!transaction) {
      logger.warn(
        `Transaction not found for CheckoutRequestID: ${CheckoutRequestID}`,
      );
      return {
        success: false,
        resultCode: ResultCode,
        resultDesc: "Transaction not found",
      };
    }

    if (ResultCode === 0) {
      // Payment successful
      const metadata = extractCallbackMetadata(callbackData);

      // Update transaction status
      await paymentRepo.updateTransactionStatus(
        CheckoutRequestID,
        "COMPLETED",
        metadata.mpesaReceiptNumber,
      );

      // Create payment record
      await paymentRepo.createPayment({
        userId: transaction.userId,
        amount: metadata.amount || transaction.amount,
        method: "mpesa",
        transactionId: metadata.mpesaReceiptNumber,
      });

      // Notify user of successful payment
      await emitNotification(transaction.userId, {
        type: "PAYMENT_SUCCESS",
        message: `Payment of KES ${metadata.amount} received successfully`,
        mpesaReceiptNumber: metadata.mpesaReceiptNumber,
      });

      logger.info(`Payment successful: ${metadata.mpesaReceiptNumber}`);

      return {
        success: true,
        transactionId: CheckoutRequestID,
        mpesaReceiptNumber: metadata.mpesaReceiptNumber,
        amount: metadata.amount,
        phoneNumber: String(metadata.phoneNumber),
        resultCode: ResultCode,
        resultDesc: ResultDesc,
      };
    } else {
      // Payment failed
      await paymentRepo.updateTransactionStatus(CheckoutRequestID, "FAILED");

      // Notify user of failed payment
      await emitNotification(transaction.userId, {
        type: "PAYMENT_FAILED",
        message: `Payment failed: ${ResultDesc}`,
      });

      logger.warn(`Payment failed: ${ResultDesc}`);

      return {
        success: false,
        transactionId: CheckoutRequestID,
        resultCode: ResultCode,
        resultDesc: ResultDesc,
      };
    }
  } catch (error) {
    logger.error(`Error processing M-Pesa callback:`, error);
    throw error;
  }
};

// create a pending transaction after initiating STK Push.
export const initiatePayment = async (data: {
  userId: string;
  amount: number;
  phoneNumber: string;
  checkoutRequestId: string;
  merchantRequestId: string;
}) => {
  return paymentRepo.createTransaction({
    userId: data.userId,
    amount: data.amount,
    checkoutRequestId: data.checkoutRequestId,
    merchantRequestId: data.merchantRequestId,
    phoneNumber: data.phoneNumber,
  });
};

// Get user's payment history
export const getPaymentHistory = async (userId: string) => {
  return paymentRepo.getPaymentsByUserId(userId);
};

// Get user's transaction history
export const getTransactionHistory = async (userId: string) => {
  return paymentRepo.getTransactionsByUserId(userId);
};
