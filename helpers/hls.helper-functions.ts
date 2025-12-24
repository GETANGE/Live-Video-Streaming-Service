import { minioClient } from "@configs/minio.config";

const BUCKET_NAME = process.env.MINIO_BUCKET || "videos";

export const uploadToMinio = async (
  fileName: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> => {
  await minioClient.putObject(BUCKET_NAME, fileName, buffer, buffer.length, {
    "Content-Type": contentType,
  });

  return `${BUCKET_NAME}/${fileName}`;
};

export const getMinioUrl = (fileName: string): string => {
  const endpoint = process.env.MINIO_ENDPOINT || "localhost";
  const port = process.env.MINIO_PORT || "9000";
  const protocol = process.env.MINIO_USE_SSL === "true" ? "https" : "http";

  return `${protocol}://${endpoint}:${port}/${BUCKET_NAME}/${fileName}`;
};

export const getPresignedUrl = async (
  fileName: string,
  expirySeconds: number = 3600,
): Promise<string> => {
  return minioClient.presignedGetObject(BUCKET_NAME, fileName, expirySeconds);
};

export const deleteFromMinio = async (fileName: string): Promise<void> => {
  await minioClient.removeObject(BUCKET_NAME, fileName);
};

// Delete all objects with a given prefix (for HLS cleanup)
export const deleteByPrefix = async (prefix: string): Promise<number> => {
  const objectsList: string[] = [];
  const stream = minioClient.listObjects(BUCKET_NAME, prefix, true);

  return new Promise((resolve, reject) => {
    stream.on("data", (obj) => {
      if (obj.name) {
        objectsList.push(obj.name);
      }
    });

    stream.on("error", reject);

    stream.on("end", async () => {
      if (objectsList.length === 0) {
        resolve(0);
        return;
      }

      await minioClient.removeObjects(BUCKET_NAME, objectsList);
      resolve(objectsList.length);
    });
  });
};

export const streamFromMinio = async (fileName: string) => {
  return minioClient.getObject(BUCKET_NAME, fileName);
};

// Upload HLS files with correct content types
export const uploadHLSFile = async (
  path: string,
  buffer: Buffer,
  isPlaylist: boolean
): Promise<string> => {
  const contentType = isPlaylist ? "application/vnd.apple.mpegurl" : "video/MP2T";

  await minioClient.putObject(BUCKET_NAME, path, buffer, buffer.length, {
    "Content-Type": contentType,
    "Cache-Control": isPlaylist ? "no-cache" : "max-age=31536000",
  });

  return path;
};

// Upload thumbnail
export const uploadThumbnail = async (
  videoId: string,
  buffer: Buffer
): Promise<string> => {
  const path = `thumbnails/${videoId}.jpg`;

  await minioClient.putObject(BUCKET_NAME, path, buffer, buffer.length, {
    "Content-Type": "image/jpeg",
    "Cache-Control": "max-age=86400",
  });

  return path;
};

// Get public URL for streaming
export const getPublicUrl = (path: string): string => {
  const endpoint = process.env.MINIO_ENDPOINT || "localhost";
  const port = process.env.MINIO_PORT || "9000";
  const protocol = process.env.MINIO_USE_SSL === "true" ? "https" : "http";

  return `${protocol}://${endpoint}:${port}/${BUCKET_NAME}/${path}`;
};