const rabbitmq_url =
  process.env.NODE_ENV === "production"
    ? process.env.RABBITMQ_URL
    : "amqp://admin:admin123@localhost:5673";

const RabbitMQConfig = {
  url: rabbitmq_url as string,
  queueName: "streaming_queue",
  exchangeName: "streaming_exchange",
  routingKey: "streaming_routing_key",
  maxPriority: 10,
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
