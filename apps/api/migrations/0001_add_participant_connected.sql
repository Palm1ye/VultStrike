-- Add connected and connected_at columns to match_participant table
ALTER TABLE "match_participant" ADD COLUMN IF NOT EXISTS "connected" boolean DEFAULT false;
ALTER TABLE "match_participant" ADD COLUMN IF NOT EXISTS "connected_at" timestamp;
