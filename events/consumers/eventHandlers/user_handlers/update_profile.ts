import { updateUserRepo } from "@repository/users.repository";
import APIError from "@utils/APIError";
import logger from "@utils/logger";
import type { Prisma } from "@configs/database.config";

interface UpdateProfilePayload {
  id: string;
  email?: string;
  username?: string;
  phoneNumber?: string;
}

export const handleUserProfileUpdate = async (payload: UpdateProfilePayload) => {
  try {
    const { id, email, username, phoneNumber } = payload;

    // Build the update object dynamically (omit undefined)
    const data: Prisma.UserUpdateInput = {};

    if (email !== undefined) data.email = email;
    if (username !== undefined) data.username = username;
    if (phoneNumber !== undefined) data.phoneNumber = phoneNumber;

    if (Object.keys(data).length === 0) {
      throw new APIError("No fields provided to update", 400);
    }

    const updatedUser = await updateUserRepo(id, data);
    
    logger.info(`🧑‍🦱 User profile updated successfully for user ${id}`);

    return updatedUser;
  } catch (error: any) {
    logger.error(error.message || "Failed to update profile");
    throw new APIError(error.message || "Failed to update profile", 500);
  }
};
