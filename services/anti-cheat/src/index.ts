import http from "node:http";
import axios from "axios";
import { z } from "zod";

const reportSchema = z.object({
  matchId: z.string(),
  reporterId: z.string(),
  suspectId: z.string(),
  reason: z.string(),
  evidenceUrl: z.string().optional()
});

export async function forwardReport(raw: unknown) {
  const report = reportSchema.parse(raw);
  await axios.post(process.env.REVIEW_QUEUE_URL ?? "http://localhost:7200/reports", report);
  return { ok: true };
}

export async function pollVacStatus(steamIds: string[]) {
  const response = await axios.get("https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/", {
    params: { key: process.env.STEAM_API_KEY, steamids: steamIds.join(",") }
  });
  return response.data;
}

// ── Server ──────────────────────────────────────────────────────────────

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 7200;

  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200).end(JSON.stringify({ status: "ok", service: "anti-cheat" }));
      return;
    }

    if (req.method === "POST" && req.url === "/reports") {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const result = await forwardReport(body);
        res.writeHead(200).end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(400).end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (req.method === "POST" && req.url === "/vac-check") {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const { steamIds } = JSON.parse(Buffer.concat(chunks).toString());
        if (!Array.isArray(steamIds)) {
          res.writeHead(400).end(JSON.stringify({ ok: false, error: "steamIds must be an array" }));
          return;
        }
        const result = await pollVacStatus(steamIds);
        res.writeHead(200).end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(400).end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    res.writeHead(404).end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(PORT, () => {
    console.log(`[anti-cheat] Service listening on http://0.0.0.0:${PORT}`);
    console.log(`[anti-cheat] POST /reports   — forward cheat reports`);
    console.log(`[anti-cheat] POST /vac-check — check VAC status`);
    console.log(`[anti-cheat] GET  /health    — health check`);
  });
}
