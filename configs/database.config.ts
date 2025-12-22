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

// Connection pool configuration for backpressure handling
const POOL_CONFIG = {
  // Maximum connections in the pool
  max: parseInt(process.env.DB_POOL_MAX || "20", 10),
  // Minimum connections to keep open
  min: parseInt(process.env.DB_POOL_MIN || "5", 10),
  // Idle timeout before closing a connection (ms)
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || "30000", 10),
  // Connection acquisition timeout (ms)
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || "10000", 10),
};

// Query timeout for backpressure
const QUERY_TIMEOUT_MS = parseInt(process.env.DB_QUERY_TIMEOUT || "30000", 10);

// Backpressure state tracking
interface DatabaseBackpressureState {
  activeQueries: number;
  maxConcurrentQueries: number;
  pendingQueries: number;
  isUnderPressure: boolean;
}

const backpressureState: DatabaseBackpressureState = {
  activeQueries: 0,
  maxConcurrentQueries: POOL_CONFIG.max * 2, // Allow 2 queries per connection
  pendingQueries: 0,
  isUnderPressure: false,
};

// Get database metrics for monitoring
export const getDatabaseMetrics = () => ({
  ...backpressureState,
  poolConfig: POOL_CONFIG,
  queryTimeout: QUERY_TIMEOUT_MS,
});

// Initialize Prisma with connection pool settings (Prisma v7)
const adapter = new PrismaPg({
  connectionString: db_url,
  pool: {
    max: POOL_CONFIG.max,
    min: POOL_CONFIG.min,
    idleTimeoutMillis: POOL_CONFIG.idleTimeoutMillis,
    connectionTimeoutMillis: POOL_CONFIG.connectionTimeoutMillis,
  },
});

const prisma = new PrismaClient({
  adapter,
  log: [
    { emit: "event", level: "query" },
    { emit: "event", level: "error" },
    { emit: "event", level: "warn" },
  ],
});

// Query event logging for monitoring
prisma.$on("query" as never, (e: any) => {
  backpressureState.activeQueries++;

  // Check for backpressure
  if (backpressureState.activeQueries >= backpressureState.maxConcurrentQueries) {
    if (!backpressureState.isUnderPressure) {
      logger.warn(
        `⏸️  Database backpressure: High query load (${backpressureState.activeQueries}/${backpressureState.maxConcurrentQueries})`
      );
      backpressureState.isUnderPressure = true;
    }
  }

  // Log slow queries
  if (e.duration > 1000) {
    logger.warn(`🐢 Slow query (${e.duration}ms): ${e.query.substring(0, 100)}...`);
  }
});

// Decrement active queries (called after query completion)
const decrementActiveQueries = () => {
  backpressureState.activeQueries = Math.max(0, backpressureState.activeQueries - 1);

  if (
    backpressureState.isUnderPressure &&
    backpressureState.activeQueries < backpressureState.maxConcurrentQueries * 0.7
  ) {
    logger.info(
      `▶️  Database backpressure: Load reduced (${backpressureState.activeQueries}/${backpressureState.maxConcurrentQueries})`
    );
    backpressureState.isUnderPressure = false;
  }
};

// Wrap Prisma client with backpressure-aware methods
const createBackpressureAwareProxy = <T extends object>(target: T): T => {
  return new Proxy(target, {
    get(obj: any, prop: string) {
      const value = obj[prop];

      // If it's a model (like prisma.user), wrap its methods
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return createBackpressureAwareProxy(value);
      }

      // If it's a query method, wrap it with backpressure logic
      if (typeof value === "function") {
        return async (...args: any[]) => {
          // Check backpressure before executing
          if (backpressureState.isUnderPressure) {
            backpressureState.pendingQueries++;
            logger.debug(
              `📥 Query queued due to backpressure (pending: ${backpressureState.pendingQueries})`
            );

            // Wait for pressure to reduce (with timeout)
            const startWait = Date.now();
            while (
              backpressureState.isUnderPressure &&
              Date.now() - startWait < QUERY_TIMEOUT_MS
            ) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }

            backpressureState.pendingQueries--;

            if (backpressureState.isUnderPressure) {
              throw new Error("Database query timeout - system under backpressure");
            }
          }

          try {
            const result = await value.apply(obj, args);
            decrementActiveQueries();
            return result;
          } catch (error) {
            decrementActiveQueries();
            throw error;
          }
        };
      }

      return value;
    },
  });
};

// Create the backpressure-aware Prisma client
const prismaWithBackpressure = createBackpressureAwareProxy(prisma);

export async function connectToDatabase() {
  try {
    await prisma.$connect();
    logger.info(
      `🔥 Database connection successful (pool: ${POOL_CONFIG.min}-${POOL_CONFIG.max} connections)`
    );
  } catch (error) {
    logger.error("❌ Error connecting to the database:", error);
    process.exit(1);
  }
}

export async function disconnectDatabase() {
  try {
    logger.warn("Disconnecting from the database... 💔");

    // Wait for active queries to complete (with timeout)
    const startTime = Date.now();
    while (backpressureState.activeQueries > 0 && Date.now() - startTime < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (backpressureState.activeQueries > 0) {
      logger.warn(
        `⚠️  Forcing disconnect with ${backpressureState.activeQueries} active queries`
      );
    }

    await prisma.$disconnect();
    logger.warn("Database disconnected successfully 💔");
  } catch (error) {
    logger.error("Error disconnecting from the database:", error);
  }
}

// Check if database is under backpressure (for external use)
export const isDatabaseUnderBackpressure = () => backpressureState.isUnderPressure;

// Execute a query with explicit timeout
export async function executeWithTimeout<T>(
  queryFn: () => Promise<T>,
  timeoutMs: number = QUERY_TIMEOUT_MS
): Promise<T> {
  return Promise.race([
    queryFn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Query timeout")), timeoutMs)
    ),
  ]);
}

export { Prisma, prismaWithBackpressure as prisma };
