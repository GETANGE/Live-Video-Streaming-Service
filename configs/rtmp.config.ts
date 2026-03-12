import logger from "@utils/logger";

const RTMP_PORT = parseInt(process.env.RTMP_PORT || "1935");
const HTTP_PORT = parseInt(process.env.RTMP_HTTP_PORT || "8000");

/**
 * RTMP server runs as a Docker container (illuspas/node-media-server).
 * Stream lifecycle events are handled via HTTP callbacks (notify.url)
 * configured in nms-config.json → POST /api/v1/rtmp-callback
 */
export const initRtmpServer = (): void => {
  logger.info(`RTMP server running via Docker on port ${RTMP_PORT}`);
  logger.info(`RTMP HTTP/HLS server on port ${HTTP_PORT}`);
  logger.info(`Stream URL: rtmp://localhost:${RTMP_PORT}/live/{stream_key}`);
  logger.info(`HLS URL: http://localhost:${HTTP_PORT}/live/{stream_key}/index.m3u8`);
  logger.info(`NMS callbacks configured → POST /api/v1/rtmp-callback`);
};

export const stopRtmpServer = async (): Promise<void> => {
  logger.info("[RTMP] Docker container handles shutdown");
};

export const getRtmpStats = (): { running: boolean; ports: { rtmp: number; http: number } } => {
  return {
    running: true, // Docker container manages this
    ports: {
      rtmp: RTMP_PORT,
      http: HTTP_PORT,
    },
  };
};
