import { getRabbitMQChannel } from "@configs/rabbitMQ.config";
import RabbitMQConfig from "@constants/constant";

// send the message to the exchange . The exchange will route this to the queue.
export const publishMessage = async (payload: any) => {
  const channel = await getRabbitMQChannel();

  const messageBuffer = Buffer.from(JSON.stringify(payload));

  channel.publish(
    RabbitMQConfig.exchangeName,   // exchange
    RabbitMQConfig.routingKey,     // routing key
    messageBuffer,
    {
      persistent: true,            // survives broker restart
      headers: {
        "x-retries": 0,
      },
      priority: payload.priority ?? 0,
      contentType: "application/json",
    }
  );
};