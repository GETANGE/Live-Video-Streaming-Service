import passport from "passport";
import dotenv from "dotenv";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { createUser, getUserByEmail_OAuth } from "@repository/users.repository";
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
          const imageUrl = profile.photos?.[0]?.value;
          const googleId = profile.id;
          const email = profile.emails?.[0]?.value;
          let username = profile.name.givenName && profile.name.familyName
            ? `${profile.name.givenName} ${profile.name.familyName}`
            : email.split("@")[0];
          
          // Fallback just in case
          if (!username) username = `user_${googleId}`;

          if (!email) {
            throw new APIError("Google account email not found", 400);
          }

          // Check if user already exists
          let user = await getUserByEmail_OAuth(email);

          // If not, create user
          if (!user) {
            user = await createUser({
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
