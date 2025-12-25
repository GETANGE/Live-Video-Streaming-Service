import { Request, Response, NextFunction } from "express";
import { getAuthAccessToken, sendSTKPUSH_request } from "api/mpesa.api";
import * as paymentService from "@services/payment.service";
import { publishMessage } from "@events/producers/streaming.publisher";
import { MpesaCallbackBody } from "@types";
import { PRIORITY } from "@constants/constant";
import { createSTKPUSH_request } from "@helpers/payment.helper";
import APIError from "@utils/APIError";
import logger from "@utils/logger";

// Initiate STK Push - sends to M-Pesa, queues transaction creation
export const initiateSTK_push = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { amount, phoneNumber } = req.body;

    if (!amount || !phoneNumber) {
      throw new APIError("Amount and phone number are required", 400);
    }

    const accessToken = await getAuthAccessToken();
    const timestamp = paymentService.generateTimestamp();
    const password = paymentService.generatePassword(timestamp);

    const stkRequest = await createSTKPUSH_request(
      timestamp,
      password,
      amount,
      phoneNumber,
    );

    const response = await sendSTKPUSH_request(stkRequest, accessToken);

    // Queue transaction creation
    const message = {
      eventType: "PAYMENT_INITIATED",
      priority: PRIORITY.HIGH,
      payload: {
        userId,
        amount,
        phoneNumber,
        checkoutRequestId: response.CheckoutRequestID,
        merchantRequestId: response.MerchantRequestID,
        timestamp: new Date().toISOString(),
      },
    };

    await publishMessage(message);

    res.status(200).json({
      success: true,
      message: "STK Push sent. Check your phone to complete payment.",
      data: {
        checkoutRequestId: response.CheckoutRequestID,
        merchantRequestId: response.MerchantRequestID,
      },
    });
  } catch (error) {
    logger.error("STK Push initiation error:", error);
    next(error);
  }
};

// M-Pesa callback - queues callback processing
export const handleSTK_push_callback = async (
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  try {
    const callbackData: MpesaCallbackBody = req.body;

    logger.info("M-Pesa callback received");

    const message = {
      eventType: "PAYMENT_CALLBACK",
      priority: PRIORITY.HIGH,
      payload: {
        stkCallback: callbackData.Body.stkCallback,
        timestamp: new Date().toISOString(),
      },
    };

    await publishMessage(message);

    // Always respond 200 to M-Pesa
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Callback received",
    });
  } catch (error) {
    logger.error("M-Pesa callback error:", error);
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Callback received",
    });
  }
};

// GET - synchronous (needs immediate response)
export const paymentTransaction_history = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const [payments, transactions] = await Promise.all([
      paymentService.getPaymentHistory(userId),
      paymentService.getTransactionHistory(userId),
    ]);

    res.status(200).json({
      success: true,
      data: { payments, transactions },
    });
  } catch (error) {
    logger.error("Payment history error:", error);
    next(error);
  }
};
