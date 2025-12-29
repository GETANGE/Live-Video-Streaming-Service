import { Router } from "express";
import * as browserStreamController from "@controllers/browser-stream.controller";

const router = Router();

router.get("/stats", browserStreamController.getStats);
router.post("/stop/:streamKey", browserStreamController.stopStream);
router.get("/info", browserStreamController.getConnectionInfo);

export default router;
