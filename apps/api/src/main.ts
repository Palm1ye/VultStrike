import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyRawBody from "fastify-raw-body";
import { AppModule } from "./modules/app.module";
import { Logger, LogLevel } from "@nestjs/common";

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const isProd = (process.env.NODE_ENV ?? "development").toLowerCase() === "production";
  const isDev = !isProd;
  const trustProxy = (process.env.TRUST_PROXY ?? String(isProd)).toLowerCase() === "true";
  
  // Parse log level from env
  const logLevels: LogLevel[] = ["error", "warn", "log", "debug", "verbose"];
  const envLogLevel = process.env.LOG_LEVEL?.toLowerCase();
  const activeLogLevels = envLogLevel && logLevels.includes(envLogLevel as LogLevel) 
    ? logLevels.slice(0, logLevels.indexOf(envLogLevel as LogLevel) + 1) as LogLevel[]
    : undefined;
  
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy }), {
    logger: activeLogLevels
  });

  await app.register(fastifyRawBody as any, {
    field: "rawBody",
    global: true,
    encoding: "utf8",
    runFirst: true
  });
  
  await app.register(fastifyCookie as any, {
    secret: process.env.COOKIE_SECRET,
    hook: "onRequest"
  });

  const webOrigin = process.env.WEB_PUBLIC_URL ?? "http://localhost:3000";
  const apiPublicUrl = process.env.API_PUBLIC_URL ?? "http://localhost:4000";
  
  // CORS configuration
  const allowedOrigins = [
    webOrigin,
    apiPublicUrl,
    // Production origins
    "https://vultstrike.com",
    "https://www.vultstrike.com",
    "https://api.vultstrike.com",
    // Development origins
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:4000",
    "http://127.0.0.1:4000"
  ]
    .filter(Boolean)
    .map((origin) => normalizeOrigin(origin));
  
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const normalizedOrigin = normalizeOrigin(origin);
      // Allow configured origins
      if (allowedOrigins.includes(normalizedOrigin)) return cb(null, true);
      // Allow localhost and loopback for development
      if (origin.startsWith("http://localhost:")) return cb(null, true);
      if (origin.startsWith("http://127.0.0.1:")) return cb(null, true);
      // Allow local IP addresses only in development.
      if (isDev && origin.startsWith("http://192.168.")) return cb(null, true);
      if (isDev && origin.startsWith("http://10.")) return cb(null, true);
      // Log rejected origins for debugging
      logger.warn(`[CORS] Rejected origin: ${origin}, allowed: ${allowedOrigins.join(", ")}`);
      return cb(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
  });
  
  const port = Number(process.env.PORT) || 4000;
  const host = "0.0.0.0";
  await app.listen({ port, host });
  logger.log(`VultStrike API server running on http://${host}:${port}`);
  logger.log(`CORS enabled for origins: ${allowedOrigins.join(", ")}`);
}

bootstrap();
