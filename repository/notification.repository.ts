import { prisma } from "@configs/database.config";
import { NotificationType } from "@generated/prisma/client";

interface CreateNotificationData {
  message: string;
  type: NotificationType;
  userId?: string;
}

export const createNotification = async (data: CreateNotificationData) => {
  return prisma.notification.create({ data });
};

export const createManyNotifications = async (data: CreateNotificationData[]) => {
  return prisma.notification.createMany({ data });
};

export const getNotificationsByUserId = async (userId: string) => {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
};

export const getUnreadNotifications = async (userId: string) => {
  return prisma.notification.findMany({
    where: { userId, isRead: false },
    orderBy: { createdAt: "desc" },
  });
};

export const markAsRead = async (id: string) => {
  return prisma.notification.update({
    where: { id },
    data: { isRead: true },
  });
};

export const markAllAsRead = async (userId: string) => {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
};

export const deleteNotification = async (id: string) => {
  return prisma.notification.delete({ where: { id } });
};
