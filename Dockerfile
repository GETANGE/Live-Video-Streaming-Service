FROM oven/bun:1-alpine AS base

# Install FFmpeg and dependencies
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Generate Prisma client
FROM deps AS prisma
COPY prisma ./prisma
RUN bunx prisma generate

# Production build
FROM base AS runner
WORKDIR /app

# Copy dependencies and prisma client
COPY --from=prisma /app/node_modules ./node_modules
COPY --from=prisma /app/prisma ./prisma

# Copy source code
COPY . .

# Create temp directory for video processing
RUN mkdir -p /tmp/video-processing

ENV NODE_ENV=production
ENV FFMPEG_TEMP_DIR=/tmp/video-processing

EXPOSE 3000

CMD ["bun","run","start"]
