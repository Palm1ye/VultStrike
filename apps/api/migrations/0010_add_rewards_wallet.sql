-- Rewards: credits wallet + drop inventory.
-- Safe to run multiple times.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "credits" integer DEFAULT 0;

CREATE TABLE IF NOT EXISTS "user_drop" (
  "id" serial PRIMARY KEY,
  "user_id" varchar(36) NOT NULL,
  "source" varchar(32) NOT NULL,
  "rarity" varchar(16) NOT NULL,
  "item" varchar(64) NOT NULL,
  "meta" jsonb,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "user_drop_user_id_idx" ON "user_drop" ("user_id");
CREATE INDEX IF NOT EXISTS "user_drop_created_at_idx" ON "user_drop" ("created_at");

