import { Router } from "express";
import {
  initiateSTK_push,
  handleSTK_push_callback,
  paymentTransaction_history,
  initiateChannelSubscription,
} from "@controllers/payment.controller";
import { protectRoute } from "@controllers/OAuthController";

const router = Router();

router.post("/initiate", protectRoute, initiateSTK_push);
router.get("/history", protectRoute, paymentTransaction_history);

// Channel subscription payment
router.post("/subscribe-channel", protectRoute, initiateChannelSubscription);

// M-Pesa callback
router.post("/callback", handleSTK_push_callback);

export default router;
