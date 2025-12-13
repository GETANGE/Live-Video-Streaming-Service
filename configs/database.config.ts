import { PrismaClient, Prisma } from "@generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import logger from "@utils/logger";
import dotenv from "dotenv";

dotenv.config();

const db_url = process.env.DATABASE_URL;

if (!db_url) {
  logger.error("❌ DATABASE_URL not set for this environment!");
  process.exit(1);
}

// Initialize Prisma with datasourceUrl(prisma v7)
const adapter = new PrismaPg({
  connectionString: db_url,
});
const prisma = new PrismaClient({ adapter });

export async function connectToDatabase() {
  try {
    await prisma.$connect();
    logger.info("🔥 Database connection successful");
  } catch (error) {
    logger.error("❌ Error connecting to the database:", error);
    process.exit(1);
  }
}

export async function disconnectDatabase() {
  try {
    logger.warn("Disconnecting from the database... 💔");
    await prisma.$disconnect();
    logger.warn("Database disconnected successfully 💔");
  } catch (error) {
    logger.error("Error disconnecting from the database:", error);
  }
}

export { Prisma, prisma };
