-- Add profile customization fields to user table
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "profile_theme" VARCHAR(32) DEFAULT 'default';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "profile_border" VARCHAR(32) DEFAULT 'default';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "profile_avatar" VARCHAR(32) DEFAULT 'default';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "profile_status" VARCHAR(64);
