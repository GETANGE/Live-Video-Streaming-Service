import { prisma } from "@configs/database.config";


export const findSubscription = async (userId: string, channelId: string) => {
  return prisma.subscription.findFirst({
    where: { userId, channelId },
  });
};

export const createSubscription = async (userId: string, channelId: string) => {
  return prisma.subscription.create({
    data: { userId, channelId },
  });
};

export const cancelSubscription = async (id: string) => {
  return prisma.subscription.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
};

export const getSubscriptionById = async (id: string) => {
  return prisma.subscription.findUnique({ where: { id } });
};

export const getSubscriptionsByUserId = async (userId: string) => {
  return prisma.subscription.findMany({ where: { userId } });
};

export const getAllSubscriptions = async () => {
  return prisma.subscription.findMany();
};
