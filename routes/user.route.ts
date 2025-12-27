import {
  googleCallback,
  getCurrentUser,
  protectRoute,
  updateProfile,
} from "@controllers/OAuthController";
import express from "express";
import passport from "passport";
const router = express.Router();

router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] }),
);

router.get("/google/callback", googleCallback);
router.get("/me", protectRoute, getCurrentUser);
router.patch("/profile/update", protectRoute, updateProfile);

export default router;
