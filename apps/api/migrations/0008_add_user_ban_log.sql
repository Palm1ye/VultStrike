CREATE TABLE IF NOT EXISTS "user_ban_log" (
  "id" serial PRIMARY KEY,
  "user_id" varchar(36) NOT NULL,
  "admin_id" varchar(36),
  "action" varchar(16) NOT NULL,
  "reason" varchar(256),
  "ban_until" timestamp,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "user_ban_log_user_idx" ON "user_ban_log" ("user_id");
CREATE INDEX IF NOT EXISTS "user_ban_log_created_idx" ON "user_ban_log" ("created_at");
