import { mpesaConfig } from "@constants/constant";
import { STKPushRequest } from "@types";

export const createSTKPUSH_request = async (
  timestamp: string,
  password: string,
  amount: number,
  phoneNumber: string,
) => {

  const stkRequest: STKPushRequest = {
    BusinessShortCode: mpesaConfig.shortCode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: mpesaConfig.transactionType,
    Amount: amount,
    PartyA: phoneNumber,
    PartyB: mpesaConfig.shortCode,
    PhoneNumber: phoneNumber,
    CallBackURL: mpesaConfig.callbackUrl,
    AccountReference: `StreamApp`,
    TransactionDesc: "Subscription Payment",
  };

  return stkRequest;
};
