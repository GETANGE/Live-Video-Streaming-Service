import logger from "@utils/logger";
import RabbitMQConfig from "@constants/constant";
import amqplib from "amqplib";


let connection:  null | any = null;
let channel:  null | any = null;

export const getRabbitMQChannel = async (): Promise<any> => {
  if (channel) return channel;

  connection = await amqplib.connect(RabbitMQConfig.url);
  channel = await connection.createChannel();

  await channel.prefetch(1);

  await channel.assertExchange(RabbitMQConfig.exchangeName, "direct", { durable: true });

  // Durable priority queue
  await channel.assertQueue( RabbitMQConfig.queueName,{ durable: true, arguments: {
        "x-max-priority": RabbitMQConfig.maxPriority
      }
    }
  );

  await channel.bindQueue(RabbitMQConfig.queueName, RabbitMQConfig.exchangeName, RabbitMQConfig.routingKey );

  return channel;
};

/**
 * Graceful shutdown
 */
export const connectToRabbitMq = async () => {
  const channel = await getRabbitMQChannel();
  logger.info("🐰 Connected to RabbitMQ");

  process.on("SIGINT", async () => {
    console.log("Closing RabbitMQ connection... 🥲");
    await channel.close();
    await connection.close();
    process.exit(0);
  });
};
