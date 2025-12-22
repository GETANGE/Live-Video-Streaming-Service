import passport from "passport";
import dotenv from "dotenv";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import * as repo from "@repository/users.repository";
import redisClient from "@configs/redis.config";
import { invalidateUserCache } from "helpers/cacheInvalidations/userCacheInvalidate";
import { getUserCacheKeys } from "helpers/cacheInvalidations/userCacheInvalidate";
import APIError from "@utils/APIError";

dotenv.config();

export const googleStrategy = () => {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        callbackURL: process.env.GOOGLE_CALLBACK_URL as string,
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: any,
        done,
      ) => {
        try {
          const imageUrl = profile.photos[0].value;
          const googleId = profile.id;
          const email = profile.emails[0].value;
          let username =
            profile.name.givenName && profile.name.familyName
              ? `${profile.name.givenName} ${profile.name.familyName}`
              : email.split("@")[0];

          // Fallback just in case
          if (!username) username = `user_${googleId}`;

          if (!email) {
            throw new APIError("Google account email not found", 400);
          }

          // Check if user already exists (use find - returns null instead of throwing)
          let user = await repo.findUserByEmailRepo(email);

          // If not, create user
          if (!user) {
            user = await repo.createUserRepo({
              email,
              username: username,
              imageUrl,
              isActive: true,
            });
          }

          // Return user
          return done(null, user);
        } catch (error) {
          return done(error as Error);
        }
      },
    ),
  );
};

// Centralized cache helper
const getCachedUser = async (cacheKey: string, dbCall: () => Promise<any>) => {
  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const result = await dbCall();
  if (!result) return null;

  await redisClient.setex(cacheKey, 300, JSON.stringify(result));
  return result;
};

export const createUserService = async (data: any) => {
  const user = await repo.createUserRepo(data);
  await invalidateUserCache();
  return user;
};

export const getUserByIdService = async (id: string) => {
  const keys = await getUserCacheKeys();
  return getCachedUser(keys.byId(id), () => repo.getUserByIdRepo(id));
};

export const getUserByEmailService = async (email: string) => {
  const keys = await getUserCacheKeys();
  return getCachedUser(keys.byEmail(email), () =>
    repo.getUserByEmailRepo(email),
  );
};

export const getAllUsersService = async () => {
  const keys = await getUserCacheKeys();
  return getCachedUser(keys.all(), () => repo.getAllUsersRepo());
};

export const updateUserService = async (id: string, data: any) => {
  const updated = await repo.updateUserRepo(id, data);
  await invalidateUserCache();
  return updated;
};

export const deleteUserService = async (id: string) => {
  const deleted = await repo.deleteUserRepo(id);
  await invalidateUserCache();
  return deleted;
};
