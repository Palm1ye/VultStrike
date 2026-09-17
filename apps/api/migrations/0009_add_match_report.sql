-- Create match report table for player reports surfaced in the admin panel.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS "match_report" (
  "id" serial PRIMARY KEY,
  "match_id" varchar(36) NOT NULL,
  "reporter_user_id" varchar(36) NOT NULL,
  "reported_user_id" varchar(36),
  "reported_handle" varchar(64),
  "reason" varchar(64) NOT NULL,
  "details" varchar(1024),
  "status" varchar(16) DEFAULT 'OPEN',
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "match_report_match_id_idx" ON "match_report" ("match_id");
CREATE INDEX IF NOT EXISTS "match_report_reporter_user_id_idx" ON "match_report" ("reporter_user_id");

