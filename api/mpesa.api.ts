import logger from "@utils/logger";
import { STKPushRequest } from "@types";
import dotenv from "dotenv";

dotenv.config();

export const getAuthAccessToken = async (): Promise<string> => {
  try {
    const secret =
      process.env.NODE_ENV === "production"
        ? process.env.MPESA_CONSUMER_SECRET
        : process.env.MPESA_CONSUMER_SECRET_TEST;

    const consumer =
      process.env.NODE_ENV === "production"
        ? process.env.MPESA_CONSUMER_KEY
        : process.env.MPESA_CONSUMER_KEY_TEST;

    const password = Buffer.from(`${consumer}:${secret}`).toString("base64");

    const response = await fetch(`${process.env.MPESA_AUTH_URL}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${password}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get access token: ${response.statusText}`);
    }

    const data: any = await response.json();

    logger.info("💫 Mpesa access token retrieved successfully");

    return data.access_token;
  } catch (error) {
    logger.error(`Failed to get access token: ${error}`);
    throw error;
  }
};

export const sendSTKPUSH_request = async (
  requestBody: STKPushRequest,
  token: string,
) => {
  const response = await fetch(`${process.env.MPESA_STK_PUSH_URL}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      requestBody,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send STK push request: ${response.statusText}`);
  }

  const data: any = await response.json();

  logger.info("💫 STK push request created successfully");

  return data;
};
