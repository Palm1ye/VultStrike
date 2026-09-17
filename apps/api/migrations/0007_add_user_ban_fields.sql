ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS banned boolean DEFAULT false;

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS ban_reason varchar(256);

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS ban_until timestamp;
