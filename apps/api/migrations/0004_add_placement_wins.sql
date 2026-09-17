-- Add placement wins columns to track wins during placement matches
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "placement_wins_1v1" integer DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "placement_wins_2v2" integer DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "placement_wins_3v3" integer DEFAULT 0;
