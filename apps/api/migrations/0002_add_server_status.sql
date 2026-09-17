-- Add server_status enum and columns to match table
CREATE TYPE "server_status" AS ENUM ('PENDING', 'PULLING_IMAGE', 'STARTING', 'READY', 'FAILED');

ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "server_status" "server_status" DEFAULT 'PENDING';
ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "container_id" varchar(128);
ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "server_error" varchar(256);
