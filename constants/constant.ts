const rabbitmq_url =
  process.env.NODE_ENV === "production"
    ? process.env.RABBITMQ_URL
    : "amqp://admin:admin123@localhost:5673";

// Queue configurations
export const QUEUES = {
  VIDEO: {
    name: "video_processing_queue",
    routingKey: "video.process",
    prefetch: 2,
    maxPriority: 10,
  },
  GENERAL: {
    name: "general_queue",
    routingKey: "general.events",
    prefetch: 200,
    maxPriority: 10,
  },
} as const;

// Event types routed to video queue
export const VIDEO_EVENTS = [
  "VIDEO_PROCESS",
  "VIDEO_TRANSCODE",
  "VIDEO_THUMBNAIL",
  "VIDEO_DELETE",
] as const;

const RabbitMQConfig = {
  url: rabbitmq_url as string,
  exchangeName: "streaming_exchange",
};

export const PRIORITY = {
  HIGH: 9,
  MEDIUM: 5,
  LOW: 1,
} as const;

export const mpesaConfig = {
  shortCode: process.env.MPESA_SHORTCODE as string,
  passkey: process.env.MPESA_PASSKEY as string,
  transactionType: process.env.MPESA_TRANSACTION_TYPE as string,
  callbackUrl: process.env.MPESA_CALLBACK_URL as string,
};

export default RabbitMQConfig;
