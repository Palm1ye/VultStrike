import axios from "axios";
import { Kafka, logLevel, type EachMessagePayload } from "kafkajs";
import { z } from "zod";

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const kafka = KAFKA_BROKERS.length
   ? new Kafka({ clientId: "vultstrike-orchestrator", brokers: KAFKA_BROKERS, logLevel: logLevel.INFO })
  : null;

const consumer = kafka ? kafka.consumer({ groupId: "orchestrator" }) : null;
const producer = kafka ? kafka.producer() : null;

const matchSchema = z.object({
  lobbyId: z.string(),
  mode: z.enum(["1v1", "2v2", "3v3"]),
  region: z.string(),
  map: z.string().default("de_mirage")
});

export async function startOrchestrator() {
  if (!consumer || !producer) {
    console.warn(
      "[orchestrator] Kafka disabled (KAFKA_BROKERS is empty). " +
        "Orchestrator will idle; match-created/match-ready events will not be processed."
    );
    // Keep the process alive in dev so `pnpm dev:orchestrator` doesn't crash.
    // (This is intentional: local dev often runs without Kafka/fleet.)
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    setInterval(() => {}, 1 << 30);
    return;
  }

  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: "match-created", fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }: EachMessagePayload) => {
      if (!message.value) return;
      const payload = matchSchema.parse(JSON.parse(message.value.toString()));
      const server = await provisionServer(payload);
      await producer.send({
        topic: "match-ready",
        messages: [{ value: JSON.stringify({ ...payload, server }) }]
      });
    }
  });
}

async function provisionServer(payload: z.infer<typeof matchSchema>) {
  console.info(`[orchestrator] allocating server for ${payload.lobbyId}`);
  // Call the fleet API to provision a new game server
  const response = await axios.post(
    process.env.CS2_FLEET_API ?? "http://localhost:7000/servers",
    payload
  );
  // Expecting response.data to have address, port, token, map
  const { address, port, token, map } = response.data;
  return {
    address: port ? `${address}:${port}` : address,
    token: token ?? "STEAM_GSLT_TOKEN",
    map: map ?? payload.map
  };
}

if (require.main === module) {
  startOrchestrator().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
