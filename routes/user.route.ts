import {
  googleCallback,
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
router.patch("/profile/update", protectRoute, updateProfile);

export default router;
