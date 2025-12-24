import { v2 as cloudinary } from "cloudinary";
import { streamFromMinio, getPublicUrl } from "@helpers/hls.helper-functions";
import redisClient from "@configs/redis.config";
import { getCDNCacheKeys } from "@helpers/cacheInvalidations/cdnCacheInvalidation";
import { createCircuitBreaker, getCircuitStats } from "@utils/circuitBreaker";
import logger from "@utils/logger";

const CDN_CACHE_TTL = 3600; // 1 hour

// Check if Cloudinary is configured
export const isCloudinaryConfigured = (): boolean => {
  return !!process.env.CLOUDINARY_CLOUD_NAME;
};

// Raw upload functions (wrapped by circuit breakers)
const _uploadImage = async (
  buffer: Buffer,
  folder: string = "images",
  publicId?: string,
): Promise<{ url: string; publicId: string }> => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: "image",
          transformation: [{ quality: "auto", fetch_format: "auto" }],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve({ url: result!.secure_url, publicId: result!.public_id });
        },
      )
      .end(buffer);
  });
};

const _uploadVideo = async (
  buffer: Buffer,
  folder: string = "videos",
  publicId?: string,
): Promise<{ url: string; publicId: string; duration: number }> => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: "video",
          eager: [{ streaming_profile: "hd", format: "m3u8" }],
          eager_async: true,
        },
        (error, result) => {
          if (error) reject(error);
          else
            resolve({
              url: result!.secure_url,
              publicId: result!.public_id,
              duration: result!.duration || 0,
            });
        },
      )
      .end(buffer);
  });
};

const _deleteFromCDN = async (
  publicId: string,
  resourceType: "image" | "video" = "image",
): Promise<void> => {
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
};

// Circuit breakers for Cloudinary operations
const imageUploadBreaker = createCircuitBreaker(_uploadImage, {
  name: "Cloudinary:ImageUpload",
  timeout: 30000, // 30s for image uploads
  errorThresholdPercentage: 50,
  resetTimeout: 60000, // 1 minute
  volumeThreshold: 3,
});

const videoUploadBreaker = createCircuitBreaker(_uploadVideo, {
  name: "Cloudinary:VideoUpload",
  timeout: 120000, // 2 minutes for video uploads
  errorThresholdPercentage: 50,
  resetTimeout: 60000,
  volumeThreshold: 3,
});

const deleteBreaker = createCircuitBreaker(_deleteFromCDN, {
  name: "Cloudinary:Delete",
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
});

// Public upload functions (use circuit breakers)
export const uploadImage = async (
  buffer: Buffer,
  folder: string = "images",
  publicId?: string,
): Promise<{ url: string; publicId: string }> => {
  return imageUploadBreaker.fire(buffer, folder, publicId);
};

export const uploadVideo = async (
  buffer: Buffer,
  folder: string = "videos",
  publicId?: string,
): Promise<{ url: string; publicId: string; duration: number }> => {
  return videoUploadBreaker.fire(buffer, folder, publicId);
};

// Sync thumbnail from MinIO to Cloudinary
export const syncThumbnailToCDN = async (
  videoId: string,
  buffer: Buffer,
): Promise<{ cdnUrl: string; publicId: string } | null> => {
  if (!isCloudinaryConfigured()) {
    logger.warn("Cloudinary not configured, skipping CDN sync");
    return null;
  }

  try {
    logger.info(`Syncing thumbnail ${videoId} to CDN`);

    const result = await uploadImage(buffer, "thumbnails", videoId);

    // Cache the CDN URL with version
    const cacheKeys = await getCDNCacheKeys();
    await redisClient.setex(cacheKeys.thumbnail(videoId), CDN_CACHE_TTL, result.url);

    logger.info(`Thumbnail ${videoId} synced to CDN: ${result.url}`);
    return { cdnUrl: result.url, publicId: result.publicId };
  } catch (error) {
    logger.error(`Failed to sync thumbnail ${videoId} to CDN:`, error);
    return null;
  }
};

// Sync video from MinIO to Cloudinary (lazy)
export const syncVideoToCDN = async (
  videoId: string,
  minioPath: string,
): Promise<{ cdnUrl: string; publicId: string } | null> => {
  if (!isCloudinaryConfigured()) {
    logger.warn("Cloudinary not configured, skipping CDN sync");
    return null;
  }

  // Check Redis cache first
  const cacheKeys = await getCDNCacheKeys();
  const cached = await redisClient.get(cacheKeys.video(videoId));
  if (cached) {
    return { cdnUrl: cached, publicId: `videos/${videoId}` };
  }

  try {
    logger.info(`Syncing video ${videoId} to CDN (lazy)`);

    // Stream from MinIO
    const stream = await streamFromMinio(minioPath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const result = await uploadVideo(buffer, "videos", videoId);

    // Cache the CDN URL with version
    await redisClient.setex(cacheKeys.video(videoId), CDN_CACHE_TTL, result.url);

    logger.info(`Video ${videoId} synced to CDN: ${result.url}`);
    return { cdnUrl: result.url, publicId: result.publicId };
  } catch (error) {
    logger.error(`Failed to sync video ${videoId} to CDN:`, error);
    return null;
  }
};

// Get content URL - returns CDN URL if cached, MinIO fallback
export const getContentUrl = async (
  type: "thumbnail" | "video" | "stream",
  id: string,
): Promise<{ url: string; source: "cdn" | "minio" }> => {
  const cacheKeys = await getCDNCacheKeys();

  let cacheKey: string;
  switch (type) {
    case "thumbnail":
      cacheKey = cacheKeys.thumbnail(id);
      break;
    case "video":
      cacheKey = cacheKeys.video(id);
      break;
    case "stream":
      cacheKey = cacheKeys.stream(id);
      break;
  }

  const cached = await redisClient.get(cacheKey);
  if (cached) {
    return { url: cached, source: "cdn" };
  }

  // Fallback to MinIO
  let minioPath: string;
  switch (type) {
    case "thumbnail":
      minioPath = `thumbnails/${id}.jpg`;
      break;
    case "video":
      minioPath = `raw/${id}.mp4`;
      break;
    case "stream":
      minioPath = `hls/${id}/master.m3u8`;
      break;
  }

  return { url: getPublicUrl(minioPath), source: "minio" };
};

// Delete asset from Cloudinary (with circuit breaker)
export const deleteFromCDN = async (
  publicId: string,
  resourceType: "image" | "video" = "image",
): Promise<void> => {
  if (!isCloudinaryConfigured()) return;

  try {
    await deleteBreaker.fire(publicId, resourceType);
    logger.info(`Deleted ${publicId} from CDN`);
  } catch (error) {
    logger.warn(`Failed to delete ${publicId} from CDN:`, error);
  }
};

// Clear specific CDN cache entry
export const clearCDNCache = async (
  type: "thumbnail" | "video" | "stream",
  id: string,
): Promise<void> => {
  const cacheKeys = await getCDNCacheKeys();

  let cacheKey: string;
  switch (type) {
    case "thumbnail":
      cacheKey = cacheKeys.thumbnail(id);
      break;
    case "video":
      cacheKey = cacheKeys.video(id);
      break;
    case "stream":
      cacheKey = cacheKeys.stream(id);
      break;
  }

  await redisClient.del(cacheKey);
};

// Get Cloudinary streaming URL for a video
export const getCDNStreamingUrl = (publicId: string): string => {
  return cloudinary.url(publicId, {
    resource_type: "video",
    format: "m3u8",
    streaming_profile: "hd",
  });
};

// Get circuit breaker stats for monitoring
export const getCDNCircuitStats = () => ({
  imageUpload: getCircuitStats(imageUploadBreaker),
  videoUpload: getCircuitStats(videoUploadBreaker),
  delete: getCircuitStats(deleteBreaker),
});
