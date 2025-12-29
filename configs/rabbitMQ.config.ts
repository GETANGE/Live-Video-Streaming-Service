import logger from "@utils/logger";
import RabbitMQConfig, { QUEUES } from "@constants/constant";
import amqplib from "amqplib";

let connection: any = null;
let channel: any = null;

export const getRabbitMQChannel = async (): Promise<any> => {
  if (channel) return channel;

  connection = await amqplib.connect(RabbitMQConfig.url);
  channel = await connection.createChannel();

  // Assert exchange
  await channel.assertExchange(RabbitMQConfig.exchangeName, "direct", {
    durable: true,
  });

  // Assert VIDEO queue (low prefetch for heavy processing)
  await channel.assertQueue(QUEUES.VIDEO.name, {
    durable: true,
    arguments: {
      "x-max-priority": QUEUES.VIDEO.maxPriority,
    },
  });
  await channel.bindQueue(
    QUEUES.VIDEO.name,
    RabbitMQConfig.exchangeName,
    QUEUES.VIDEO.routingKey,
  );

  // Assert GENERAL queue (high prefetch for lightweight ops)
  await channel.assertQueue(QUEUES.GENERAL.name, {
    durable: true,
    arguments: {
      "x-max-priority": QUEUES.GENERAL.maxPriority,
    },
  });
  await channel.bindQueue(
    QUEUES.GENERAL.name,
    RabbitMQConfig.exchangeName,
    QUEUES.GENERAL.routingKey,
  );

  // Assert LIVE queue (moderate prefetch for livestreaming)
  await channel.assertQueue(QUEUES.LIVE.name, {
    durable: true,
    arguments: {
      "x-max-priority": QUEUES.LIVE.maxPriority,
    },
  });
  await channel.bindQueue(
    QUEUES.LIVE.name,
    RabbitMQConfig.exchangeName,
    QUEUES.LIVE.routingKey,
  );

  logger.info(`Queues initialized: ${QUEUES.VIDEO.name}, ${QUEUES.GENERAL.name}, ${QUEUES.LIVE.name}`);

  return channel;
};

// Get a dedicated channel for video processing (separate prefetch)
export const getVideoChannel = async (): Promise<any> => {
  if (!connection) {
    await getRabbitMQChannel();
  }

  const videoChannel = await connection.createChannel();
  await videoChannel.prefetch(QUEUES.VIDEO.prefetch);

  return videoChannel;
};

// Get a dedicated channel for general processing
export const getGeneralChannel = async (): Promise<any> => {
  if (!connection) {
    await getRabbitMQChannel();
  }

  const generalChannel = await connection.createChannel();
  await generalChannel.prefetch(QUEUES.GENERAL.prefetch);

  return generalChannel;
};

// Get a dedicated channel for live streaming processing
export const getLiveChannel = async (): Promise<any> => {
  if (!connection) {
    await getRabbitMQChannel();
  }

  const liveChannel = await connection.createChannel();
  await liveChannel.prefetch(QUEUES.LIVE.prefetch);

  return liveChannel;
};

export const connectToRabbitMq = async () => {
  await getRabbitMQChannel();
  logger.info("Connected to RabbitMQ");

  process.on("SIGINT", async () => {
    logger.info("Closing RabbitMQ connection...");
    if (channel) await channel.close();
    if (connection) await connection.close();
    process.exit(0);
  });
};
