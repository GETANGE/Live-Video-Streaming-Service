const rabbitmq_url =
  process.env.NODE_ENV === "production"
    ? process.env.RABBITMQ_URL
    : "amqp://admin:admin123@localhost:5673";

const RabbitMQConfig = {
  url: rabbitmq_url as string,
  queueName: "streaming_queue",
  exchangeName: "streaming_exchange",
  routingKey: "streaming_routing_key",
  maxPriority: 10
};

export default RabbitMQConfig;