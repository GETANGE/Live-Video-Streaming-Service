import { Router } from "express";
import {
  initiateSTK_push,
  handleSTK_push_callback,
  paymentTransaction_history,
} from "@controllers/payment.controller";
import { protectRoute } from "@controllers/OAuthController";

const router = Router();

router.post("/initiate", protectRoute, initiateSTK_push);
router.get("/history", protectRoute, paymentTransaction_history);

// M-Pesa callback
router.post("/callback", handleSTK_push_callback);

export default router;
