import { prisma, Prisma } from "@configs/database.config";
import APIError from "@utils/APIError";

export const createUserRepo = async (data: Prisma.UserCreateInput) => {
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email },
  });
  if (existingUser) throw new APIError("Email already in use", 400);

  return prisma.user.create({ data });
};

export const getUserByIdRepo = async (id: string) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new APIError("User not found", 404);
  return user;
};

export const getUserByEmailRepo = async (email: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new APIError("User not found", 404);
  return user;
};

export const getAllUsersRepo = async () => {
  const users = await prisma.user.findMany();
  if (!users || users.length === 0) throw new APIError("No users found", 404);
  return users;
};

export const updateUserRepo = async (
  id: string,
  data: Prisma.UserUpdateInput,
) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new APIError("User not found", 404);

  return prisma.user.update({ where: { id }, data });
};

export const deleteUserRepo = async (id: string) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new APIError("User not found", 404);

  return prisma.user.update({ where: { id }, data: { isActive: false } });
};
