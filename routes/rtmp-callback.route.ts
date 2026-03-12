import express from "express";
import { handleNmsCallback } from "@controllers/rtmp-callback.controller";

const router = express.Router();

// NMS sends JSON without Content-Type header, so we force JSON parsing
router.post("/", express.json({ type: "*/*" }), handleNmsCallback);

export default router;
