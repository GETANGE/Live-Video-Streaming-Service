import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "crypto";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to your .env file.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function streamKey() {
  return `sk_live_${randomUUID().replace(/-/g, "")}`;
}

async function main() {
  console.log("Seeding database...\n");

  // Clean existing seed data (reverse dependency order)
  await prisma.chatMessage.deleteMany({});
  await prisma.moderationLog.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.liveStream.deleteMany({});
  await prisma.streamKey.deleteMany({});
  await prisma.video.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.channel.deleteMany({});
  console.log("✓ Cleaned existing data");

  // ── Users ──────────────────────────────────────────────
  const users = await Promise.all(
    [
      {
        email: "alex@streamhub.io",
        username: "AlexStreams",
        imageUrl: "https://api.dicebear.com/9.x/avataaars/svg?seed=Alex",
        isAdmin: true,
      },
      {
        email: "maya@streamhub.io",
        username: "MayaLive",
        imageUrl: "https://api.dicebear.com/9.x/avataaars/svg?seed=Maya",
      },
      {
        email: "jordan@streamhub.io",
        username: "JordanPlays",
        imageUrl: "https://api.dicebear.com/9.x/avataaars/svg?seed=Jordan",
      },
      {
        email: "sam@streamhub.io",
        username: "SamCodes",
        imageUrl: "https://api.dicebear.com/9.x/avataaars/svg?seed=Sam",
      },
      {
        email: "riley@streamhub.io",
        username: "RileyMusic",
        imageUrl: "https://api.dicebear.com/9.x/avataaars/svg?seed=Riley",
      },
      {
        email: "casey@streamhub.io",
        username: "CaseyArt",
        imageUrl: "https://api.dicebear.com/9.x/avataaars/svg?seed=Casey",
      },
      {
        email: "morgan@streamhub.io",
        username: "MorganFit",
        imageUrl: "https://api.dicebear.com/9.x/avataaars/svg?seed=Morgan",
      },
      {
        email: "taylor@streamhub.io",
        username: "TaylorTech",
        imageUrl: "https://api.dicebear.com/9.x/avataaars/svg?seed=Taylor",
      },
    ].map((u) =>
      prisma.user.upsert({
        where: { email: u.email },
        update: {},
        create: u,
      })
    )
  );

  console.log(`✓ ${users.length} users`);

  const [alex, maya, jordan, sam, riley, casey, morgan, taylor] = users;

  // ── Channels ───────────────────────────────────────────
  const channelData = [
    {
      name: "GameZone",
      description:
        "High-energy gaming streams — FPS, RPGs, and competitive tournaments.",
      thumbnailUrl: "https://picsum.photos/seed/gamezone/800/450",
      ownerId: alex.id,
    },
    {
      name: "MayaLive Studio",
      description:
        "Lifestyle, travel vlogs, and behind-the-scenes creative content.",
      thumbnailUrl: "https://picsum.photos/seed/mayalive/800/450",
      ownerId: maya.id,
    },
    {
      name: "ProPlays",
      description: "Esports commentary, match analysis, and ranked gameplay.",
      thumbnailUrl: "https://picsum.photos/seed/proplays/800/450",
      ownerId: jordan.id,
    },
    {
      name: "CodeCraft",
      description:
        "Live coding sessions — building real projects from scratch.",
      thumbnailUrl: "https://picsum.photos/seed/codecraft/800/450",
      ownerId: sam.id,
    },
    {
      name: "BeatLab",
      description: "Live music production, DJ sets, and beat-making sessions.",
      thumbnailUrl: "https://picsum.photos/seed/beatlab/800/450",
      ownerId: riley.id,
      isPaid: true,
      subscriptionPrice: 499,
      currency: "KES",
    },
    {
      name: "ArtFlow",
      description: "Digital art, speed-painting, and creative tutorials.",
      thumbnailUrl: "https://picsum.photos/seed/artflow/800/450",
      ownerId: casey.id,
    },
    {
      name: "FitStream",
      description:
        "Live workout classes, nutrition tips, and fitness challenges.",
      thumbnailUrl: "https://picsum.photos/seed/fitstream/800/450",
      ownerId: morgan.id,
      isPaid: true,
      subscriptionPrice: 299,
      currency: "KES",
    },
    {
      name: "TechTalk",
      description:
        "Tech reviews, gadget unboxings, and industry deep-dives.",
      thumbnailUrl: "https://picsum.photos/seed/techtalk/800/450",
      ownerId: taylor.id,
    },
  ];

  const channels = await Promise.all(
    channelData.map((ch) =>
      prisma.channel.upsert({
        where: { name: ch.name },
        update: {},
        create: ch,
      })
    )
  );

  console.log(`✓ ${channels.length} channels`);

  // ── Subscriptions (cross-subscribe users) ──────────────
  const subPairs = [
    [maya.id, channels[0].id],
    [jordan.id, channels[0].id],
    [sam.id, channels[0].id],
    [alex.id, channels[1].id],
    [riley.id, channels[1].id],
    [alex.id, channels[2].id],
    [maya.id, channels[2].id],
    [taylor.id, channels[2].id],
    [alex.id, channels[3].id],
    [jordan.id, channels[3].id],
    [casey.id, channels[3].id],
    [morgan.id, channels[3].id],
    [alex.id, channels[4].id],
    [maya.id, channels[4].id],
    [sam.id, channels[5].id],
    [riley.id, channels[5].id],
    [alex.id, channels[6].id],
    [maya.id, channels[6].id],
    [sam.id, channels[6].id],
    [casey.id, channels[7].id],
    [morgan.id, channels[7].id],
    [jordan.id, channels[7].id],
  ];

  let subCount = 0;
  for (const [userId, channelId] of subPairs) {
    await prisma.subscription.upsert({
      where: { userId_channelId: { userId, channelId } },
      update: {},
      create: { userId, channelId, status: "ACTIVE" },
    });
    subCount++;
  }
  console.log(`✓ ${subCount} subscriptions`);

  // ── Videos ─────────────────────────────────────────────
  const videoData = [
    {
      title: "Top 10 FPS Plays of the Week",
      description: "The best competitive FPS highlights from this week's ranked matches.",
      duration: 612,
      uploadedBy: alex.id,
      channelId: channels[0].id,
      thumbnailUrl: "https://picsum.photos/seed/fps1/640/360",
    },
    {
      title: "Building a Full-Stack App in 2 Hours",
      description: "Live coding a complete web app with Node.js, Postgres, and React.",
      duration: 7245,
      uploadedBy: sam.id,
      channelId: channels[3].id,
      thumbnailUrl: "https://picsum.photos/seed/code1/640/360",
    },
    {
      title: "Lo-fi Beat Making Session #14",
      description: "Chill beat production with Ableton — making lo-fi hip hop from scratch.",
      duration: 3480,
      uploadedBy: riley.id,
      channelId: channels[4].id,
      thumbnailUrl: "https://picsum.photos/seed/beat1/640/360",
    },
    {
      title: "Speed Painting: Cyberpunk City",
      description: "Creating a cyberpunk cityscape in Procreate in under an hour.",
      duration: 2940,
      uploadedBy: casey.id,
      channelId: channels[5].id,
      thumbnailUrl: "https://picsum.photos/seed/art1/640/360",
    },
    {
      title: "30-Minute HIIT Cardio Workout",
      description: "No-equipment full body HIIT session. All fitness levels welcome.",
      duration: 1845,
      uploadedBy: morgan.id,
      channelId: channels[6].id,
      thumbnailUrl: "https://picsum.photos/seed/fit1/640/360",
    },
    {
      title: "M4 MacBook Pro — Honest Review",
      description: "After 30 days with the M4 MBP. Is it actually worth the upgrade?",
      duration: 1520,
      uploadedBy: taylor.id,
      channelId: channels[7].id,
      thumbnailUrl: "https://picsum.photos/seed/tech1/640/360",
    },
    {
      title: "RPG Playthrough: Chapter 1",
      description: "Starting a blind playthrough of the most anticipated RPG of the year.",
      duration: 5400,
      uploadedBy: alex.id,
      channelId: channels[0].id,
      thumbnailUrl: "https://picsum.photos/seed/rpg1/640/360",
    },
    {
      title: "Tokyo Street Food Vlog",
      description: "Exploring the best street food stalls in Shibuya and Shinjuku.",
      duration: 960,
      uploadedBy: maya.id,
      channelId: channels[1].id,
      thumbnailUrl: "https://picsum.photos/seed/vlog1/640/360",
    },
    {
      title: "Pro Match Analysis: Grand Finals",
      description: "Breaking down every round of the grand finals with pro commentary.",
      duration: 4200,
      uploadedBy: jordan.id,
      channelId: channels[2].id,
      thumbnailUrl: "https://picsum.photos/seed/esport1/640/360",
    },
    {
      title: "Rust Crash Course for Beginners",
      description: "Learn Rust from zero — ownership, borrowing, and building a CLI tool.",
      duration: 5580,
      uploadedBy: sam.id,
      channelId: channels[3].id,
      thumbnailUrl: "https://picsum.photos/seed/rust1/640/360",
    },
    {
      title: "Watercolor Landscape Tutorial",
      description: "Step-by-step watercolor painting tutorial for beginners.",
      duration: 2700,
      uploadedBy: casey.id,
      channelId: channels[5].id,
      thumbnailUrl: "https://picsum.photos/seed/art2/640/360",
    },
    {
      title: "Mechanical Keyboard Build Log",
      description: "Custom mechanical keyboard build from scratch — soldering, lubing, and sound test.",
      duration: 1800,
      uploadedBy: taylor.id,
      channelId: channels[7].id,
      thumbnailUrl: "https://picsum.photos/seed/tech2/640/360",
    },
  ];

  const videos = await Promise.all(
    videoData.map((v) =>
      prisma.video.create({
        data: {
          ...v,
          cdnSynced: true,       // Seed data — no real files in MinIO
          cdnSyncedAt: new Date(),
        },
      })
    )
  );
  console.log(`✓ ${videos.length} videos`);

  // ── Live Streams (some LIVE, some ENDED) ───────────────
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

  const liveStreamData = [
    // ═══ CURRENTLY LIVE ═══
    {
      title: "Late Night Ranked Grind — Road to Diamond",
      description: "Pushing for Diamond before end of season. Come hang out and vibe!",
      channelId: channels[0].id,
      streamerId: alex.id,
      status: "LIVE" as const,
      streamKey: streamKey(),
      rtmpUrl: "rtmp://localhost:1935/live",
      hlsUrl: "http://localhost:8000/live/stream1/index.m3u8",
      currentViewers: 342,
      peakViewers: 510,
      totalViews: 1247,
      startedAt: hoursAgo(2),
      thumbnailUrl: "https://picsum.photos/seed/live-ranked/640/360",
    },
    {
      title: "Building a Real-Time Chat App from Scratch",
      description: "WebSocket chat with Bun + Socket.IO — no frameworks, pure code.",
      channelId: channels[3].id,
      streamerId: sam.id,
      status: "LIVE" as const,
      streamKey: streamKey(),
      rtmpUrl: "rtmp://localhost:1935/live",
      hlsUrl: "http://localhost:8000/live/stream2/index.m3u8",
      currentViewers: 189,
      peakViewers: 275,
      totalViews: 823,
      startedAt: hoursAgo(1),
      thumbnailUrl: "https://picsum.photos/seed/live-chat-app/640/360",
    },
    {
      title: "Sunset DJ Set — Deep House & Progressive",
      description: "Chill deep house mix for your evening. Drop your requests in chat!",
      channelId: channels[4].id,
      streamerId: riley.id,
      status: "LIVE" as const,
      streamKey: streamKey(),
      rtmpUrl: "rtmp://localhost:1935/live",
      hlsUrl: "http://localhost:8000/live/stream3/index.m3u8",
      currentViewers: 478,
      peakViewers: 612,
      totalViews: 2150,
      startedAt: hoursAgo(3),
      thumbnailUrl: "https://picsum.photos/seed/live-djset/640/360",
    },
    {
      title: "Morning Yoga & Breathwork Flow",
      description: "Start your day right with a 45-minute flow. All levels welcome.",
      channelId: channels[6].id,
      streamerId: morgan.id,
      status: "LIVE" as const,
      streamKey: streamKey(),
      rtmpUrl: "rtmp://localhost:1935/live",
      hlsUrl: "http://localhost:8000/live/stream4/index.m3u8",
      currentViewers: 95,
      peakViewers: 140,
      totalViews: 410,
      startedAt: hoursAgo(0.5),
      thumbnailUrl: "https://picsum.photos/seed/live-yoga/640/360",
    },
    {
      title: "Drawing Your OCs Live! — Character Design Session",
      description: "Send me your original characters and I'll redesign them on stream.",
      channelId: channels[5].id,
      streamerId: casey.id,
      status: "LIVE" as const,
      streamKey: streamKey(),
      rtmpUrl: "rtmp://localhost:1935/live",
      hlsUrl: "http://localhost:8000/live/stream5/index.m3u8",
      currentViewers: 215,
      peakViewers: 320,
      totalViews: 975,
      startedAt: hoursAgo(1.5),
      thumbnailUrl: "https://picsum.photos/seed/live-drawing/640/360",
    },
    {
      title: "iPhone vs Pixel: Camera Shootout LIVE",
      description: "Testing both flagships in real-time. You pick the winner!",
      channelId: channels[7].id,
      streamerId: taylor.id,
      status: "LIVE" as const,
      streamKey: streamKey(),
      rtmpUrl: "rtmp://localhost:1935/live",
      hlsUrl: "http://localhost:8000/live/stream6/index.m3u8",
      currentViewers: 567,
      peakViewers: 720,
      totalViews: 3200,
      startedAt: hoursAgo(1.2),
      thumbnailUrl: "https://picsum.photos/seed/live-camera/640/360",
    },
    {
      title: "Travel Vlog: Exploring Bali Markets",
      description: "Walking through the Ubud art market — come explore with me!",
      channelId: channels[1].id,
      streamerId: maya.id,
      status: "LIVE" as const,
      streamKey: streamKey(),
      rtmpUrl: "rtmp://localhost:1935/live",
      hlsUrl: "http://localhost:8000/live/stream7/index.m3u8",
      currentViewers: 310,
      peakViewers: 415,
      totalViews: 1580,
      startedAt: hoursAgo(0.8),
      thumbnailUrl: "https://picsum.photos/seed/live-bali/640/360",
    },
    {
      title: "Pro Scrims — Tournament Prep",
      description: "Warming up for tomorrow's $10K tournament. Strats and callouts.",
      channelId: channels[2].id,
      streamerId: jordan.id,
      status: "LIVE" as const,
      streamKey: streamKey(),
      rtmpUrl: "rtmp://localhost:1935/live",
      hlsUrl: "http://localhost:8000/live/stream8/index.m3u8",
      currentViewers: 1240,
      peakViewers: 1580,
      totalViews: 5600,
      startedAt: hoursAgo(2.5),
      thumbnailUrl: "https://picsum.photos/seed/live-scrims/640/360",
    },

    // ═══ ENDED STREAMS ═══
    {
      title: "Esports Watch Party: Grand Finals",
      description: "Watching the grand finals together with live commentary and analysis.",
      channelId: channels[2].id,
      streamerId: jordan.id,
      status: "ENDED" as const,
      streamKey: streamKey(),
      peakViewers: 2340,
      totalViews: 8900,
      startedAt: hoursAgo(8),
      endedAt: hoursAgo(5),
      duration: 10800,
      thumbnailUrl: "https://picsum.photos/seed/ended-finals/640/360",
    },
    {
      title: "Travel Q&A — Planning Your Southeast Asia Trip",
      description: "Answering your travel questions — visas, budgets, hidden gems.",
      channelId: channels[1].id,
      streamerId: maya.id,
      status: "ENDED" as const,
      streamKey: streamKey(),
      peakViewers: 260,
      totalViews: 1100,
      startedAt: hoursAgo(12),
      endedAt: hoursAgo(10),
      duration: 7200,
      thumbnailUrl: "https://picsum.photos/seed/ended-travel/640/360",
    },
    {
      title: "Unboxing the Framework Laptop 16",
      description: "First look at the modular laptop. Let's see what's inside.",
      channelId: channels[7].id,
      streamerId: taylor.id,
      status: "ENDED" as const,
      streamKey: streamKey(),
      peakViewers: 430,
      totalViews: 2100,
      startedAt: hoursAgo(24),
      endedAt: hoursAgo(22),
      duration: 5400,
      thumbnailUrl: "https://picsum.photos/seed/ended-unbox/640/360",
    },
    {
      title: "12-Hour Coding Marathon: SaaS from Zero",
      description: "Built a complete SaaS app in one stream. Auth, billing, dashboard, deploy.",
      channelId: channels[3].id,
      streamerId: sam.id,
      status: "ENDED" as const,
      streamKey: streamKey(),
      peakViewers: 1850,
      totalViews: 12400,
      startedAt: hoursAgo(36),
      endedAt: hoursAgo(24),
      duration: 43200,
      thumbnailUrl: "https://picsum.photos/seed/ended-marathon/640/360",
    },
    {
      title: "Album Listening Party — New Releases Friday",
      description: "Reacting to this week's biggest album drops. Full breakdowns.",
      channelId: channels[4].id,
      streamerId: riley.id,
      status: "ENDED" as const,
      streamKey: streamKey(),
      peakViewers: 780,
      totalViews: 4200,
      startedAt: hoursAgo(48),
      endedAt: hoursAgo(45),
      duration: 10800,
      thumbnailUrl: "https://picsum.photos/seed/ended-album/640/360",
    },
    {
      title: "30-Day Art Challenge Finale",
      description: "Day 30! Drawing the final piece and looking back at the whole journey.",
      channelId: channels[5].id,
      streamerId: casey.id,
      status: "ENDED" as const,
      streamKey: streamKey(),
      peakViewers: 540,
      totalViews: 3100,
      startedAt: hoursAgo(30),
      endedAt: hoursAgo(27),
      duration: 10800,
      thumbnailUrl: "https://picsum.photos/seed/ended-artchallenge/640/360",
    },
    {
      title: "HIIT + Weights Superset Workout",
      description: "Full body blast — 45 minutes, no excuses. Replay available!",
      channelId: channels[6].id,
      streamerId: morgan.id,
      status: "ENDED" as const,
      streamKey: streamKey(),
      peakViewers: 320,
      totalViews: 1800,
      startedAt: hoursAgo(18),
      endedAt: hoursAgo(17),
      duration: 2700,
      thumbnailUrl: "https://picsum.photos/seed/ended-hiit/640/360",
    },
    {
      title: "Retro Game Night — N64 Classics",
      description: "Goldeneye, Mario Kart, Smash Bros. Pure nostalgia.",
      channelId: channels[0].id,
      streamerId: alex.id,
      status: "ENDED" as const,
      streamKey: streamKey(),
      peakViewers: 920,
      totalViews: 5500,
      startedAt: hoursAgo(48),
      endedAt: hoursAgo(44),
      duration: 14400,
      thumbnailUrl: "https://picsum.photos/seed/ended-retro/640/360",
    },
    {
      title: "Linux Desktop Setup Showcase",
      description: "Showing off my Hyprland + Waybar rice. Dotfiles in chat!",
      channelId: channels[7].id,
      streamerId: taylor.id,
      status: "ENDED" as const,
      streamKey: streamKey(),
      peakViewers: 610,
      totalViews: 3800,
      startedAt: hoursAgo(72),
      endedAt: hoursAgo(70),
      duration: 7200,
      thumbnailUrl: "https://picsum.photos/seed/ended-linux/640/360",
    },
  ];

  const streams = await Promise.all(
    liveStreamData.map((s) => prisma.liveStream.create({ data: s }))
  );
  console.log(`✓ ${streams.length} live streams (${liveStreamData.filter((s) => s.status === "LIVE").length} live, ${liveStreamData.filter((s) => s.status === "ENDED").length} ended)`);

  // ── Stream Keys ────────────────────────────────────────
  const streamKeyData = [
    { key: streamKey(), userId: alex.id, channelId: channels[0].id, label: "OBS Main" },
    { key: streamKey(), userId: maya.id, channelId: channels[1].id, label: "OBS Main" },
    { key: streamKey(), userId: jordan.id, channelId: channels[2].id, label: "OBS Main" },
    { key: streamKey(), userId: sam.id, channelId: channels[3].id, label: "OBS Main" },
    { key: streamKey(), userId: riley.id, channelId: channels[4].id, label: "OBS Main" },
    { key: streamKey(), userId: casey.id, channelId: channels[5].id, label: "OBS Main" },
    { key: streamKey(), userId: morgan.id, channelId: channels[6].id, label: "OBS Main" },
    { key: streamKey(), userId: taylor.id, channelId: channels[7].id, label: "OBS Main" },
  ];

  const keys = await Promise.all(
    streamKeyData.map((sk) =>
      prisma.streamKey.upsert({
        where: { userId_channelId_label: { userId: sk.userId, channelId: sk.channelId, label: sk.label! } },
        update: {},
        create: sk,
      })
    )
  );
  console.log(`✓ ${keys.length} stream keys`);

  // ── Chat Messages (on active streams) ──────────────────
  const chatMessages = [
    // Stream 1 — Gaming
    { streamId: streams[0].id, userId: maya.id, message: "Let's gooo! You got this 🔥" },
    { streamId: streams[0].id, userId: jordan.id, message: "That clutch play was insane" },
    { streamId: streams[0].id, userId: sam.id, message: "What sensitivity are you playing on?" },
    { streamId: streams[0].id, userId: riley.id, message: "GG! Diamond incoming" },
    { streamId: streams[0].id, userId: taylor.id, message: "Can you show your settings?" },
    { streamId: streams[0].id, userId: casey.id, message: "Been watching for an hour, can't stop" },
    // Stream 2 — Coding
    { streamId: streams[1].id, userId: alex.id, message: "Nice architecture choice!" },
    { streamId: streams[1].id, userId: jordan.id, message: "Why Bun over Node for this?" },
    { streamId: streams[1].id, userId: taylor.id, message: "This is cleaner than most tutorials" },
    { streamId: streams[1].id, userId: casey.id, message: "Can you explain the WebSocket auth flow?" },
    { streamId: streams[1].id, userId: morgan.id, message: "Following along, working great so far" },
    // Stream 3 — Music
    { streamId: streams[2].id, userId: alex.id, message: "This mix is perfect for late night coding" },
    { streamId: streams[2].id, userId: maya.id, message: "Track ID please??" },
    { streamId: streams[2].id, userId: sam.id, message: "Vibes are immaculate" },
    { streamId: streams[2].id, userId: morgan.id, message: "Can you play some Solomun?" },
    { streamId: streams[2].id, userId: taylor.id, message: "Added to my favorites, love this channel" },
    // Stream 4 — Fitness
    { streamId: streams[3].id, userId: alex.id, message: "Morning crew checking in!" },
    { streamId: streams[3].id, userId: maya.id, message: "This stretch feels amazing" },
    { streamId: streams[3].id, userId: riley.id, message: "Day 30 of the challenge 💪" },
    // Stream 5 — Art
    { streamId: streams[4].id, userId: jordan.id, message: "Can you draw a cyberpunk samurai?" },
    { streamId: streams[4].id, userId: sam.id, message: "Your line work is so clean" },
    { streamId: streams[4].id, userId: riley.id, message: "What tablet do you use?" },
    { streamId: streams[4].id, userId: morgan.id, message: "This is so satisfying to watch" },
    { streamId: streams[4].id, userId: taylor.id, message: "How long have you been drawing?" },
    // Stream 6 — iPhone vs Pixel
    { streamId: streams[5].id, userId: alex.id, message: "Night mode on the Pixel is unmatched" },
    { streamId: streams[5].id, userId: maya.id, message: "iPhone video stabilization is crazy though" },
    { streamId: streams[5].id, userId: jordan.id, message: "Do the ultrawide comparison next!" },
    { streamId: streams[5].id, userId: sam.id, message: "Pixel colors look more natural to me" },
    { streamId: streams[5].id, userId: casey.id, message: "Can you test portrait mode on both?" },
    // Stream 7 — Bali Markets
    { streamId: streams[6].id, userId: alex.id, message: "That wood carving is beautiful 😍" },
    { streamId: streams[6].id, userId: jordan.id, message: "How much is that painting in USD?" },
    { streamId: streams[6].id, userId: sam.id, message: "The colors in that market are insane" },
    { streamId: streams[6].id, userId: riley.id, message: "I need to visit Bali, this is amazing" },
    { streamId: streams[6].id, userId: morgan.id, message: "Try the coconut ice cream from that stall!" },
    // Stream 8 — Pro Scrims
    { streamId: streams[7].id, userId: maya.id, message: "Your comms are so clean, great IGL" },
    { streamId: streams[7].id, userId: sam.id, message: "That rotate was galaxy brain" },
    { streamId: streams[7].id, userId: riley.id, message: "You guys are winning that tourney for sure" },
    { streamId: streams[7].id, userId: casey.id, message: "What's the prize pool split?" },
    { streamId: streams[7].id, userId: taylor.id, message: "That 3v5 clutch was NASTY" },
  ];

  const msgs = await Promise.all(
    chatMessages.map((msg, i) =>
      prisma.chatMessage.create({
        data: {
          ...msg,
          // stagger timestamps so they appear in order
          createdAt: new Date(now.getTime() - (chatMessages.length - i) * 45_000),
        },
      })
    )
  );
  console.log(`✓ ${msgs.length} chat messages`);

  // ── Notifications ──────────────────────────────────────
  const notificationData = [
    { message: "Welcome to StreamHub! Set up your profile to get started.", type: "INFO" as const, userId: alex.id },
    { message: "Your channel GameZone just hit 3 subscribers!", type: "INFO" as const, userId: alex.id },
    { message: "New subscriber on MayaLive Studio!", type: "INFO" as const, userId: maya.id },
    { message: "Your stream 'Esports Watch Party' had 890 peak viewers!", type: "INFO" as const, userId: jordan.id },
    { message: "BeatLab earned KES 499 from a new subscription.", type: "INFO" as const, userId: riley.id },
    { message: "Your video 'Rust Crash Course' is done processing.", type: "INFO" as const, userId: sam.id },
  ];

  const notifications = await Promise.all(
    notificationData.map((n) => prisma.notification.create({ data: n }))
  );
  console.log(`✓ ${notifications.length} notifications`);

  console.log("\n✅ Seed complete!");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
