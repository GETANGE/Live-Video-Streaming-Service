import { Request, Response, NextFunction } from "express";
import * as browserStreamService from "@services/browser-stream.service";
import APIError from "@utils/APIError";

export const getStats = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const stats = browserStreamService.getActiveStreamCount();
    res.json({
      success: true,
      data: {
        activeStreams: browserStreamService.getActiveStreamCount(),
        streams: browserStreamService.getAllActiveStreams(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const stopStream = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { streamKey } = req.params;

    if (!streamKey) {
      throw new APIError("Stream key is required", 400);
    }

    const stopped = browserStreamService.stopBrowserStream(streamKey);

    if (!stopped) {
      throw new APIError("Stream not found or already stopped", 404);
    }

    res.json({
      success: true,
      message: "Stream stopped",
    });
  } catch (error) {
    next(error);
  }
};

export const getConnectionInfo = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const wsProtocol = req.secure ? "wss" : "ws";
    const host = req.get("host") || "localhost:3000";

    res.json({
      success: true,
      data: {
        socketUrl: `${wsProtocol}://${host}`,
        namespace: "/browser-stream",
        supportedFormats: ["video/webm", "video/mp4"],
        events: {
          emit: ["start-stream", "stream-data", "stop-stream"],
          listen: ["stream-ready", "stream-ended", "error"],
        },
        recommendedSettings: {
          videoBitrate: 2500000,
          audioBitrate: 128000,
          videoCodec: "vp8",
          audioCodec: "opus",
          frameRate: 30,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
