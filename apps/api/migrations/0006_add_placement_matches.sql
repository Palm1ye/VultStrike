-- Add placement matches columns to track number of matches played during placement
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "placement_matches_1v1" integer DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "placement_matches_2v2" integer DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "placement_matches_3v3" integer DEFAULT 0;
