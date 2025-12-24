import { Request, Response, NextFunction } from "express";
import * as uploaderService from "@services/uploader.service";
import { publishMessage } from "@events/producers/streaming.publisher";
import { PRIORITY } from "@constants/constant";
import APIError from "@utils/APIError";
import logger from "@utils/logger";

// Upload profile picture
export const uploadProfilePic = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const file = req.file;
    if (!file) throw new APIError("No file uploaded", 400);

    const result = await uploaderService.uploadProfilePic(file.buffer, userId);

    // Queue profile update with new image URL
    await publishMessage({
      eventType: "USER_PROFILE_UPDATE",
      priority: PRIORITY.LOW,
      payload: {
        id: userId,
        imageUrl: result.url,
        timestamp: new Date().toISOString(),
      },
    });

    res.status(200).json({
      success: true,
      data: { url: result.url },
    });
  } catch (error) {
    logger.error("Profile pic upload error:", error);
    next(error);
  }
};

// Upload video
export const uploadVideo = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const file = req.file;
    if (!file) throw new APIError("No file uploaded", 400);

    const { title, description, channelId } = req.body;
    if (!title || !channelId) {
      throw new APIError("Title and channelId are required", 400);
    }

    // Upload raw video to MinIO
    const result = await uploaderService.uploadRawVideo(
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    // Queue video processing (FFmpeg → HLS)
    await publishMessage({
      eventType: "VIDEO_PROCESS",
      priority: PRIORITY.MEDIUM,
      payload: {
        videoId: result.id,
        userId,
        channelId,
        title,
        description,
        fileName: `raw/${result.id}.${file.originalname.split(".").pop() || "mp4"}`,
        timestamp: new Date().toISOString(),
      },
    });

    res.status(202).json({
      success: true,
      message: "Video uploaded, processing started",
      data: {
        id: result.id,
        status: "processing",
      },
    });
  } catch (error) {
    logger.error("Video upload error:", error);
    next(error);
  }
};

// Upload thumbnail
export const uploadThumbnail = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const file = req.file;
    if (!file) throw new APIError("No file uploaded", 400);

    const { videoId } = req.body;
    if (!videoId) throw new APIError("videoId is required", 400);

    // Queue thumbnail processing
    await publishMessage({
      eventType: "VIDEO_THUMBNAIL",
      priority: PRIORITY.MEDIUM,
      payload: {
        videoId,
        userId,
        buffer: file.buffer.toString("base64"),
        mimetype: file.mimetype,
        timestamp: new Date().toISOString(),
      },
    });

    res.status(202).json({
      success: true,
      message: "Thumbnail upload queued",
      data: { videoId },
    });
  } catch (error) {
    logger.error("Thumbnail upload error:", error);
    next(error);
  }
};

// Get video URLs (CDN + MinIO)
export const getVideoUrls = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { videoId } = req.params;
    if (!videoId) throw new APIError("videoId is required", 400);

    const urls = await uploaderService.getVideoUrls(videoId);

    res.status(200).json({
      success: true,
      data: urls,
    });
  } catch (error) {
    logger.error("Get video URLs error:", error);
    next(error);
  }
};

// Delete video (MinIO + CDN)
export const deleteVideo = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { videoId } = req.params;
    if (!videoId) throw new APIError("videoId is required", 400);

    // Queue video deletion
    await publishMessage({
      eventType: "VIDEO_DELETE",
      priority: PRIORITY.LOW,
      payload: {
        videoId,
        userId,
        timestamp: new Date().toISOString(),
      },
    });

    res.status(202).json({
      success: true,
      message: "Video deletion queued",
      data: { videoId },
    });
  } catch (error) {
    logger.error("Delete video error:", error);
    next(error);
  }
};
