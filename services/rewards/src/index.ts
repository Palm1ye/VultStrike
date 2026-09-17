import http from "node:http";
import { Redis } from "@upstash/redis";
import { z } from "zod";

const redis = new Redis({ url: process.env.UPSTASH_URL ?? "", token: process.env.UPSTASH_TOKEN ?? "" });

const eventSchema = z.object({
  type: z.enum(["match.finished", "streak.achieved", "ticket.resolved"]),
  userId: z.string(),
  payload: z.record(z.any())
});

export async function handleRewardEvent(raw: unknown) {
  const event = eventSchema.parse(raw);
  switch (event.type) {
    case "match.finished":
      return grantMatchRewards(event.userId, event.payload);
    default:
      return { ok: true };
  }
}

async function grantMatchRewards(userId: string, payload: Record<string, unknown>) {
  const xp = 200 + (payload.streak ? Number(payload.streak) * 25 : 0);
  await redis.hincrby(`user:${userId}:stats`, "xp", xp);
  return { ok: true, xp };
}

// ── Server ──────────────────────────────────────────────────────────────

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 7100;

  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200).end(JSON.stringify({ status: "ok", service: "rewards" }));
      return;
    }

    if (req.method === "POST" && req.url === "/events") {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const result = await handleRewardEvent(body);
        res.writeHead(200).end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(400).end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    res.writeHead(404).end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(PORT, () => {
    console.log(`[rewards] Service listening on http://0.0.0.0:${PORT}`);
    console.log(`[rewards] POST /events  — ingest reward events`);
    console.log(`[rewards] GET  /health  — health check`);
  });
}
