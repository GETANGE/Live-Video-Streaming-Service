import { Client } from "minio";
import logger from "@utils/logger";

const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT || "localhost",
  port: parseInt(process.env.MINIO_PORT || "9000"),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY || "minio_admin",
  secretKey: process.env.MINIO_SECRET_KEY || "minio_password",
});

const BUCKET_NAME = process.env.MINIO_BUCKET || "videos";

export const initMinio = async (): Promise<void> => {
  try {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    if (!exists) {
      await minioClient.makeBucket(BUCKET_NAME);
      logger.info(`🪣 Bucket '${BUCKET_NAME}' created`);
    }

    // Set bucket to public read for streaming
    await setBucketPublicRead();

    logger.info("🪣MinIO S3 bucket connected");
  } catch (error) {
    logger.error("MinIO connection failed:", error);
    throw error;
  }
};

// Set bucket policy for public read (for streaming)
export const setBucketPublicRead = async (): Promise<void> => {
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${BUCKET_NAME}/*`],
      },
    ],
  };

  await minioClient.setBucketPolicy(BUCKET_NAME, JSON.stringify(policy));
  logger.info(`🪣Bucket ${BUCKET_NAME} set to public read`);
};

export { minioClient, BUCKET_NAME };
