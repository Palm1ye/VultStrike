-- Add score columns to match table
ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "score_alpha" integer DEFAULT 0;
ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "score_bravo" integer DEFAULT 0;
ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "current_round" integer DEFAULT 0;
