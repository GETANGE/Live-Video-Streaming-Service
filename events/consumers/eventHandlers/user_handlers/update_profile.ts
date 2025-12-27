import { updateUserRepo } from "@repository/users.repository";
import APIError from "@utils/APIError";
import logger from "@utils/logger";
import type { Prisma } from "@configs/database.config";
import { UpdateProfilePayload } from "@types";
import { invalidateUserCache } from "@helpers/cacheInvalidations/userCacheInvalidate";

export const handleUserProfileUpdate = async (
  payload: UpdateProfilePayload,
): Promise<void> => {
  try {
    const { id, email, username, phoneNumber, imageUrl } = payload;

    const data: Prisma.UserUpdateInput = {};

    if (email !== undefined) data.email = email;
    if (username !== undefined) data.username = username;
    if (phoneNumber !== undefined) data.phoneNumber = phoneNumber;
    if (imageUrl !== undefined) data.imageUrl = imageUrl;

    if (Object.keys(data).length === 0) {
      throw new APIError("No fields provided to update", 400);
    }

    await updateUserRepo(id, data);

    // Invalidate user cache so fresh data is fetched
    await invalidateUserCache();

    logger.info(`User profile updated for ${id}`);
  } catch (error: any) {
    logger.error(error.message || "Failed to update profile");
    throw new APIError(error.message || "Failed to update profile", 500);
  }
};
