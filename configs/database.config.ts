import { PrismaClient, Prisma } from "@generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import logger from "@utils/logger";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  logger.error("DATABASE_URL not set");
  process.exit(1);
}

// Connection pool config
const pool = {
  max: parseInt(process.env.DB_POOL_MAX || "20"),
  min: parseInt(process.env.DB_POOL_MIN || "5"),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

// Initialize Prisma with PostgreSQL adapter
const adapter = new PrismaPg({ connectionString: DATABASE_URL, pool });

const prisma = new PrismaClient({
  adapter,
  log: ["error"],
});

export async function connectToDatabase() {
  try {
    await prisma.$connect();
    logger.info(`Database connected (pool: ${pool.min}-${pool.max})`);
  } catch (error) {
    logger.error("Database connection failed:", error);
    process.exit(1);
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
  logger.info("Database disconnected");
}

export { Prisma, prisma };
