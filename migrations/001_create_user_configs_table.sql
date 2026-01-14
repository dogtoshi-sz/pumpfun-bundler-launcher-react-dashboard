-- Migration: Create user_configs table for multi-user support
-- This table stores environment variables per connected wallet (public key)
-- Run this migration in your PostgreSQL database before enabling multi-user mode

CREATE TABLE IF NOT EXISTS user_configs (
  wallet_public_key VARCHAR(44) PRIMARY KEY,
  config JSONB NOT NULL DEFAULT '{}',
  -- Optional: Cache encrypted private key for quick access (if encryption is added later)
  -- private_key_encrypted TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_configs_updated ON user_configs(updated_at);

-- Index for JSONB queries (if needed for searching config values)
CREATE INDEX IF NOT EXISTS idx_user_configs_config ON user_configs USING GIN (config);

-- Add comment for documentation
COMMENT ON TABLE user_configs IS 'Stores per-user environment configuration keyed by wallet public key';
COMMENT ON COLUMN user_configs.wallet_public_key IS 'Solana wallet public key (base58, 32-44 chars)';
COMMENT ON COLUMN user_configs.config IS 'JSONB object containing all environment variables for this user';
COMMENT ON COLUMN user_configs.created_at IS 'Timestamp when user config was first created';
COMMENT ON COLUMN user_configs.updated_at IS 'Timestamp when user config was last updated';
