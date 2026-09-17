CREATE TYPE "public"."match_status" AS ENUM('PENDING', 'IN_PROGRESS', 'FINISHED');--> statement-breakpoint
CREATE TYPE "public"."queue_mode" AS ENUM('ONE_V_ONE', 'TWO_V_TWO', 'THREE_V_THREE');--> statement-breakpoint
CREATE TYPE "public"."queue_status" AS ENUM('ENQUEUED', 'MATCHED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'MODERATOR', 'USER');--> statement-breakpoint
CREATE TABLE "match" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"lobby_code" varchar(16),
	"mode" "queue_mode" NOT NULL,
	"map" varchar(32),
	"status" "match_status" NOT NULL,
	"server_endpoint" varchar(64),
	"mmr_delta" integer,
	"scoreboard" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "match_participant" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" varchar(36) NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"team" varchar(16),
	"side" varchar(16),
	"ready" boolean,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "queue_ticket" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"mode" "queue_mode" NOT NULL,
	"region" varchar(16),
	"status" "queue_status" NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"handle" varchar(32) NOT NULL,
	"display_name" varchar(64),
	"email" varchar(128),
	"steam_id" varchar(32),
	"trust_score" integer,
	"role" "role" NOT NULL,
	"mmr_1v1" integer,
	"mmr_2v2" integer,
	"mmr_3v3" integer,
	"created_at" timestamp DEFAULT now()
);
