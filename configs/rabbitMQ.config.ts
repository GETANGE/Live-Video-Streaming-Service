import logger from "@utils/logger";
import RabbitMQConfig, { QUEUES } from "@constants/constant";
import amqplib from "amqplib";

let connection: any = null;
let channel: any = null;
let isClosing = false;
const activeChannels: Set<any> = new Set();

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

const createTrackedChannel = async (prefetch: number): Promise<any> => {
  if (!connection) {
    await getRabbitMQChannel();
  }

  const newChannel = await connection.createChannel();
  await newChannel.prefetch(prefetch);
  activeChannels.add(newChannel);

  newChannel.on("close", () => {
    activeChannels.delete(newChannel);
  });

  return newChannel;
};

export const getVideoChannel = async (): Promise<any> => {
  return createTrackedChannel(QUEUES.VIDEO.prefetch);
};

export const getGeneralChannel = async (): Promise<any> => {
  return createTrackedChannel(QUEUES.GENERAL.prefetch);
};

export const getLiveChannel = async (): Promise<any> => {
  return createTrackedChannel(QUEUES.LIVE.prefetch);
};

export const closeRabbitMQ = async (): Promise<void> => {
  if (isClosing) return;
  isClosing = true;

  logger.info("Closing RabbitMQ connection...");

  try {
    if (connection) {
      await connection.close();
      connection = null;
      channel = null;
      activeChannels.clear();
    }
  } catch (err: any) {
    if (err.message !== "Connection closing") {
      logger.error(`RabbitMQ close error: ${err.message}`);
    }
  }
};

export const connectToRabbitMq = async () => {
  await getRabbitMQChannel();
  logger.info("Connected to RabbitMQ");

  const shutdown = async () => {
    await closeRabbitMQ();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};
