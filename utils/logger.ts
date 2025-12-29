import winston from "winston";
import dotenv from "dotenv";

dotenv.config();

const { combine, timestamp, printf, colorize } = winston.format;

const customFormat = printf(({ level, message, timestamp }) => {
  return `[${level}]: ${message} : ${timestamp}`;
});

const fileTransport = new winston.transports.File({ filename: "combined.log" });
const errorTransport = new winston.transports.File({ filename: "app-error.log", level: "error" });
const exceptionTransport = new winston.transports.File({ filename: "exception.log" });
const rejectionTransport = new winston.transports.File({ filename: "rejections.log" });

const logger = winston.createLogger({
  level: (process.env.LOG_LEVEL as string) || "info",
  defaultMeta: {
    service: "live-video-streaming-service",
  },
  format: combine(
    colorize(),
    timestamp({ format: "YYYY-MM-DD hh:mm:ss.SSS A" }),
    customFormat
  ),
  transports: [
    new winston.transports.Console(),
    fileTransport,
    errorTransport,
  ],
  exceptionHandlers: [
    new winston.transports.Console(),
    exceptionTransport,
  ],
  rejectionHandlers: [
    new winston.transports.Console(),
    rejectionTransport,
  ],
});

export const closeLogger = (): Promise<void> => {
  return new Promise((resolve) => {
    logger.info("Flushing logs...");

    const transports = [fileTransport, errorTransport, exceptionTransport, rejectionTransport];
    let closed = 0;

    const checkDone = () => {
      closed++;
      if (closed >= transports.length) {
        resolve();
      }
    };

    transports.forEach((transport) => {
      transport.on("finish", checkDone);
      transport.end();
    });

    setTimeout(resolve, 1000);
  });
};

export default logger;