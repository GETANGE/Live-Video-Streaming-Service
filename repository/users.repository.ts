import { prisma, Prisma } from "@configs/database.config";
import APIError from "@utils/APIError";

export const createUser = async (data: Prisma.UserCreateInput) => {
  // check if email is already in use
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email },
  });

  if (existingUser) throw new APIError("Email already in use", 400);

  const user = await prisma.user.create({ data });
  return user;
};

export const getUserById = async (id: string) => {
  // check if user exists
  const user = await prisma.user.findUnique({ where: { id } });

  if (!user) throw new APIError("User not found", 404);

  return user;
};

export const getUserByEmail = async (email: string) => {
  // check if user exists
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) throw new APIError("User not found", 404);

  return user;
};

export const getUserByEmail_OAuth = async (email: string) => {
  return await prisma.user.findUnique({ where: { email } });
};


export const getAllUsers = async () => {
  const users = await prisma.user.findMany();

  if (!users) throw new APIError("No users found", 404);

  return users;
};

export const updateUser = async (id: string, data: Prisma.UserUpdateInput) => {
  if (!id) throw new APIError("User ID is required", 400);

  // Check if user exists
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new APIError("User not found", 404);

  // Update
  const updatedUser = await prisma.user.update({ where: { id }, data });
  return updatedUser;
};

export const deleteUser = async (id: string) => {
  // check if user exists
  const user = await prisma.user.findUnique({ where: { id } });

  if (!user) throw new APIError("User not found", 404);

  // update user status to deleted
  await prisma.user.update({ where: { id }, data: { isActive: false } });
};
