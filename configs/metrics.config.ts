import client from "prom-client";

// Create a Registry
const register = new client.Registry();

// Add default metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({
  register,
  prefix: "app_",
  labels: { instance: process.env.INSTANCE_ID || "unknown" },
});

// Custom metrics

// HTTP request metrics
export const httpRequestsTotal = new client.Counter({
  name: "app_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code", "instance"],
  registers: [register],
});

export const httpRequestDuration = new client.Histogram({
  name: "app_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code", "instance"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

// WebSocket metrics
export const websocketConnectionsGauge = new client.Gauge({
  name: "app_websocket_connections",
  help: "Number of active WebSocket connections",
  labelNames: ["instance"],
  registers: [register],
});

// Video processing metrics
export const videoProcessingTotal = new client.Counter({
  name: "app_video_processing_total",
  help: "Total videos processed",
  labelNames: ["status", "instance"],
  registers: [register],
});

export const videoProcessingDuration = new client.Histogram({
  name: "app_video_processing_duration_seconds",
  help: "Duration of video processing in seconds",
  labelNames: ["quality", "instance"],
  buckets: [10, 30, 60, 120, 300, 600, 1200],
  registers: [register],
});

// Queue metrics
export const queueMessagesGauge = new client.Gauge({
  name: "app_queue_messages",
  help: "Number of messages in queue",
  labelNames: ["queue", "instance"],
  registers: [register],
});

// Circuit breaker metrics
export const circuitBreakerState = new client.Gauge({
  name: "app_circuit_breaker_state",
  help: "Circuit breaker state (0=closed, 1=open, 0.5=half-open)",
  labelNames: ["service", "instance"],
  registers: [register],
});

// Memory metrics (custom)
export const memoryUsageGauge = new client.Gauge({
  name: "app_memory_usage_bytes",
  help: "Memory usage in bytes",
  labelNames: ["type", "instance"],
  registers: [register],
});

// Update memory metrics periodically
const updateMemoryMetrics = () => {
  const mem = process.memoryUsage();
  const instance = process.env.INSTANCE_ID || "unknown";

  memoryUsageGauge.set({ type: "heap_used", instance }, mem.heapUsed);
  memoryUsageGauge.set({ type: "heap_total", instance }, mem.heapTotal);
  memoryUsageGauge.set({ type: "rss", instance }, mem.rss);
  memoryUsageGauge.set({ type: "external", instance }, mem.external);
};

// Update every 5 seconds
setInterval(updateMemoryMetrics, 5000);
updateMemoryMetrics();

export { register };
export default client;
