import { prisma } from "@configs/database.config";

export const createTransaction = async (data: {
  userId: string;
  amount: number;
  checkoutRequestId: string;
  merchantRequestId: string;
  phoneNumber: string;
}) => {
  return prisma.transaction.create({
    data: {
      userId: data.userId,
      amount: data.amount,
      transactionId: data.checkoutRequestId,
      status: "PENDING",
    },
  });
};

export const findTransactionByCheckoutId = async (checkoutRequestId: string) => {
  return prisma.transaction.findUnique({
    where: { transactionId: checkoutRequestId },
    include: { user: true },
  });
};

export const updateTransactionStatus = async (
  checkoutRequestId: string,
  status: "COMPLETED" | "FAILED" | "CANCELLED",
  mpesaReceiptNumber?: string,
) => {
  return prisma.transaction.update({
    where: { transactionId: checkoutRequestId },
    data: { status },
  });
};

export const createPayment = async (data: {
  userId: string;
  amount: number;
  method: string;
  transactionId?: string;
  channelId?: string;
  purpose?: string;
}) => {
  return prisma.payment.create({
    data: {
      userId: data.userId,
      amount: data.amount,
      method: data.method,
      transactionId: data.transactionId,
      channelId: data.channelId,
      purpose: data.purpose,
      status: "COMPLETED",
    },
  });
};

export const getPaymentsByUserId = async (userId: string) => {
  return prisma.payment.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
};

export const getTransactionsByUserId = async (userId: string) => {
  return prisma.transaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
};
