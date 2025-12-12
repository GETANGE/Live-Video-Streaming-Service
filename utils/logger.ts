import winston from "winston";
import dotenv from "dotenv"

dotenv.config()

const { combine, timestamp, printf, colorize } = winston.format;

const customFormat = printf(({ level, message, timestamp }) => {
  return `[${level}]: ${message} : ${timestamp}`;
});

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL as string || 'info',
    defaultMeta: {
        service: 'live-video-streaming-service'
    },
    format: combine(
        colorize(), 
        timestamp({ format: 'YYYY-MM-DD hh:mm:ss.SSS A' }), 
        customFormat
    ),
    transports: [ 
        new winston.transports.Console(), // logging in the console
        new winston.transports.File({
            filename: 'combined.log'
        }),
        new winston.transports.File({
            filename:'app-error.log',
            level: 'error'
        })
    ],
    exceptionHandlers:[
        new winston.transports.Console(),
        new winston.transports.File({
            filename: 'exception.log'
        })
    ],
    rejectionHandlers:[
        new winston.transports.Console(),
        new winston.transports.File({
            filename: 'rejections.log'
        })
    ]
})

export default logger;