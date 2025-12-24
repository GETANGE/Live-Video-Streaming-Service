import { Router } from "express";
import multer from "multer";
import { protectRoute } from "@controllers/OAuthController";
import * as uploadController from "@controllers/upload.controller";

const router = Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedImages = ["image/jpeg", "image/png", "image/webp"];
    const allowedVideos = ["video/mp4", "video/webm", "video/quicktime"];
    const allowed = [...allowedImages, ...allowedVideos];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type"));
    }
  },
});

// Upload profile picture (max 5MB)
router.post(
  "/profile-pic",
  protectRoute,
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
  }).single("image"),
  uploadController.uploadProfilePic,
);

// Upload video (max 500MB)
router.post(
  "/video",
  protectRoute,
  upload.single("video"),
  uploadController.uploadVideo,
);

// Upload thumbnail (max 5MB)
router.post(
  "/thumbnail",
  protectRoute,
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
  }).single("image"),
  uploadController.uploadThumbnail,
);

// Get video URLs (CDN + MinIO fallback)
router.get("/videos/:videoId/urls", uploadController.getVideoUrls);

// Delete video (MinIO + CDN)
router.delete("/videos/:videoId", protectRoute, uploadController.deleteVideo);

export default router;
