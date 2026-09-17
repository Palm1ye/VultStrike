-- Add user_session table for tracking active sessions
CREATE TABLE IF NOT EXISTS user_session (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  user_agent VARCHAR(512),
  ip_address VARCHAR(64),
  country VARCHAR(64),
  city VARCHAR(128),
  last_active_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster lookups by user_id
CREATE INDEX IF NOT EXISTS idx_user_session_user_id ON user_session(user_id);
CREATE INDEX IF NOT EXISTS idx_user_session_last_active ON user_session(last_active_at DESC);
