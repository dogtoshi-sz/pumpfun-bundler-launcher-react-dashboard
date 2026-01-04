-- Add missing columns for razebot compatibility
-- Run this in your PostgreSQL client

ALTER TABLE site_config 
ADD COLUMN IF NOT EXISTS website_logo_image TEXT;

ALTER TABLE site_config 
ADD COLUMN IF NOT EXISTS theme_name VARCHAR(50);



